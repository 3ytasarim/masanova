import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";

/**
 * Nazik kapanış (SIGTERM / SIGINT — PM2 reload, deploy, Ctrl+C).
 *
 * Sıra (öncelik küçükten büyüğe):
 *   10  yeni uzun ömürlü bağlantıları reddet (isShuttingDown → SSE / canlı ses 503)
 *   20  açık SSE akışlarını kapat (istemciler EventSource ile yeni sürece yeniden bağlanır)
 *   30  devam eden canlı ses turlarını iptal et + "yarıda kaldı" olarak işaretle (yeniden denemede aynı tur
 *       hemen yeniden sahiplenilir → yinelenen tur yok, 30 sn beklenmez)
 *   80  Redis aboneliklerini bırak ve bağlantıları kapat
 *   90  Prisma bağlantısını kapat
 * Her kanca zaman aşımıyla çalışır; toplam süre `budgetMs`'i aşmaz (dağıtım yeniden başlatması takılmaz).
 * Next.js sunucusu HTTP dinleyicisini kendisi kapatır; bu modül uygulama kaynaklarını temizler.
 */
type Hook = { name: string; priority: number; run: () => Promise<void> | void };
type State = { hooks: Hook[]; shuttingDown: boolean; installed: boolean; done?: Promise<void> };
const KEY = Symbol.for("masanova.shutdown");
function state(): State {
  const g = globalThis as typeof globalThis & { [KEY]?: State };
  g[KEY] ??= { hooks: [], shuttingDown: false, installed: false };
  return g[KEY];
}

export function isShuttingDown(): boolean {
  return state().shuttingDown;
}

export function onShutdown(name: string, priority: number, run: Hook["run"]): void {
  const s = state();
  s.hooks = s.hooks.filter((h) => h.name !== name);
  s.hooks.push({ name, priority, run });
}

async function withTimeout(promise: Promise<void> | void, ms: number): Promise<"ok" | "timeout" | "error"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(() => "ok" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), ms);
      }),
    ]);
  } catch {
    return "error";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Kancaları öncelik sırasıyla çalıştır (tekrar çağrılırsa aynı işi bekler). */
export function runShutdown(reason: string, budgetMs = 8000): Promise<void> {
  const s = state();
  if (s.done) return s.done;
  s.shuttingDown = true;
  metrics.inc("shutdown.signals", 1, reason);
  const started = Date.now();
  s.done = (async () => {
    log.info("shutdown.start", { reason, hooks: s.hooks.length });
    for (const hook of [...s.hooks].sort((a, b) => a.priority - b.priority)) {
      const left = Math.max(100, budgetMs - (Date.now() - started));
      const outcome = await withTimeout(hook.run(), Math.min(left, 3000));
      if (outcome !== "ok") log.warn("shutdown.hook", { hook: hook.name, outcome });
    }
    log.info("shutdown.done", { reason, durationMs: Date.now() - started });
  })();
  return s.done;
}

/**
 * Sinyal dinleyicilerini kur (instrumentation.ts → register, yalnızca Node çalışma zamanı). Next'in kendi işleyicisi
 * de çalışır; bizimki kaynakları kapatır ve bütçe dolunca süreci bitirir (takılan bağlantı yeniden başlatmayı durdurmaz).
 */
export function installSignalHandlers(options: { exitAfter?: boolean; budgetMs?: number } = {}): void {
  const s = state();
  if (s.installed) return;
  s.installed = true;
  const handle = (signal: NodeJS.Signals) => {
    void runShutdown(signal, options.budgetMs).finally(() => {
      if (options.exitAfter !== false) process.exit(0);
    });
  };
  process.once("SIGTERM", handle);
  process.once("SIGINT", handle);
}

/** Yalnızca testler. */
export function resetShutdownForTests(): void {
  const s = state();
  s.hooks = [];
  s.shuttingDown = false;
  s.done = undefined;
}

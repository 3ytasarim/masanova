import "server-only";
import Redis, { type RedisOptions } from "ioredis";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { redisNamespace } from "@/lib/redis/keys";

/**
 * Redis bağlantıları (satıcıdan bağımsız — standart Redis ≥ 7 protokolü; Upstash / ElastiCache / kendi sunucunuz).
 * REDIS_URL boşsa Redis HİÇ kullanılmaz (süreç içi bellek sağlayıcıları; tek süreç için doğru).
 *
 *  - "command": hız sınırı / sağlık / yayın (publish) için tek bağlantı.
 *  - "subscriber": gerçek zamanlı olay aboneliği (abone kipindeki bağlantı başka komut çalıştıramaz).
 * Bağlantılar globalThis'te tekildir (Next'in ayrı rota paketleri ve geliştirme hot-reload'u yeni havuz açmaz).
 * Çevrimdışı kuyruk KAPALI: Redis yokken komutlar hemen hata verir → çağıran açıkça tanımlı yedek davranışa geçer
 * (bkz. src/server/rate-limit). URL / parola hiçbir loga yazılmaz.
 */
type Role = "command" | "subscriber";
type State = { command?: Redis; subscriber?: Redis; closing?: boolean };
const KEY = Symbol.for("masanova.redis");
const state = (): State => {
  const g = globalThis as typeof globalThis & { [KEY]?: State };
  g[KEY] ??= {};
  return g[KEY];
};

/**
 * REDIS_URL çekirdek ortam doğrulamasından BAĞIMSIZ okunur (Redis isteğe bağlıdır; hatalı değer Redis'i kapatır, platformu
 * durdurmaz — sorun getEnvIssues / sağlık çıktısında görünür).
 */
export function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url && (url.startsWith("redis://") || url.startsWith("rediss://")) ? url : null;
}

export function redisConfigured(): boolean {
  return !!redisUrl();
}

export function namespace(): string {
  return redisNamespace(process.env.REDIS_NAMESPACE);
}

export const REDIS_OPTIONS: RedisOptions = {
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  // Bağlantı koparsa 200 ms → … → 2 sn aralıklarla süresiz yeniden dene (abonelikler otomatik yenilenir).
  retryStrategy: (times) => Math.min(times * 200, 2000),
  autoResubscribe: true,
  lazyConnect: false,
};

/** Testler (sahte Redis) ve uygulama için bağlantı fabrikası — olay dinleyicileri metrik / log üretir. */
export function createRedisConnection(url: string, role: Role, options: RedisOptions = {}): Redis {
  const client = new Redis(url, { ...REDIS_OPTIONS, connectionName: `masanova-${role}`, ...options });
  let everReady = false;
  client.on("ready", () => {
    if (everReady) {
      metrics.inc("realtime.reconnects", 1, role);
      log.info("redis.reconnected", { role });
    }
    everReady = true;
  });
  client.on("error", (error: Error) => {
    metrics.inc("redis.errors", 1, role);
    // ioredis hata mesajı host:port içerebilir — kod ve tür yeterli.
    log.warn("redis.error", { role, code: "REDIS_UNAVAILABLE", errorName: error.name, errno: (error as { code?: string }).code ?? null });
  });
  return client;
}

export function getRedis(role: Role): Redis | null {
  const url = redisUrl();
  if (!url) return null;
  const s = state();
  if (s.closing) return null;
  s[role] ??= createRedisConnection(url, role);
  return s[role];
}

/** Komut bağlantısı hazır değilse en fazla `ms` bekle (açılıştaki ilk isteklerin gereksiz yedeğe düşmemesi için). */
export async function waitReady(client: Redis, ms = 500): Promise<boolean> {
  if (client.status === "ready") return true;
  if (client.status === "end" || client.status === "close") return false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.off("ready", onReady);
      resolve(false);
    }, ms);
    const onReady = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.once("ready", onReady);
  });
}

export type RedisHealth = { status: "connected" | "disconnected" | "not_configured"; latencyMs?: number };

export async function redisHealth(): Promise<RedisHealth> {
  const client = getRedis("command");
  if (!client) return { status: "not_configured" };
  const started = Date.now();
  try {
    if (!(await waitReady(client, 1000))) return { status: "disconnected" };
    await Promise.race([client.ping(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000))]);
    return { status: "connected", latencyMs: Date.now() - started };
  } catch {
    return { status: "disconnected" };
  }
}

/** Kapanış: abonelikleri bırak, bağlantıları nazikçe kapat (QUIT), takılırsa kopar. */
export async function closeRedis(timeoutMs = 2000): Promise<void> {
  const s = state();
  s.closing = true;
  await Promise.all(
    (["subscriber", "command"] as const).map(async (role) => {
      const client = s[role];
      if (!client) return;
      s[role] = undefined;
      await Promise.race([client.quit().catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs))]);
      client.disconnect();
    }),
  );
}

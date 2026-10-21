import "server-only";
import { formatSse, SSE_HEARTBEAT, type RealtimeEnvelope } from "@/lib/realtime/events";
import { metrics } from "@/lib/observability/metrics";
import { getRealtimeProvider } from "@/server/realtime/bus";
import { isShuttingDown, onShutdown } from "@/server/lifecycle/shutdown";

/** Bu süreçteki açık SSE akışları (kapanışta hepsi kapatılır; metrik göstergesi). */
const KEY = Symbol.for("masanova.sse.streams");
function openStreams(): Set<() => void> {
  const g = globalThis as typeof globalThis & { [KEY]?: Set<() => void> };
  if (!g[KEY]) {
    g[KEY] = new Set();
    const streams = g[KEY];
    onShutdown("sse.close-all", 20, () => {
      for (const close of [...streams]) close();
    });
  }
  return g[KEY];
}

export function openSseCount(): number {
  return openStreams().size;
}

/**
 * Server-Sent Events yanıtı (tek yönlü sunucu → istemci; WebSocket karmaşıklığı gerekmiyor).
 * - Kanal(lar) çağıran tarafından GÜVENİLİR bağlamdan verilir (oturum / QR doğrulaması sonrası).
 * - 25 sn'de bir yorum satırı (heartbeat) — vekiller bağlantıyı kesmesin; iş olayı değildir.
 * - Her heartbeat'te `stillAuthorized()` yeniden doğrulanır (çıkış yapılan oturum / süresi dolan public erişim kapanır).
 * - İstemci bağlantıyı kapatınca (abort) abonelik ve zamanlayıcılar temizlenir (bellek sızıntısı yok).
 * - `maxLifetimeMs`: uzun ömürlü bağlantılar periyodik olarak kapatılır; istemci yeniden bağlanıp yetkiyi tazeler.
 * - Kapanış (SIGTERM) sırasında yeni akış 503 alır, açık akışlar kapatılır → istemci yeni sürece yeniden bağlanır.
 */
export function createSseResponse(options: {
  request: Request;
  channels: string[];
  filter?: (event: RealtimeEnvelope) => RealtimeEnvelope | null;
  stillAuthorized?: () => Promise<boolean>;
  heartbeatMs?: number;
  maxLifetimeMs?: number;
}): Response {
  const { request, channels } = options;
  if (isShuttingDown()) return new Response(null, { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } });
  const heartbeatMs = options.heartbeatMs ?? 25_000;
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let seq = 0;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const registry = openStreams();
      metrics.gauge("sse.connections", 1);
      metrics.inc("sse.opened");
      const bus = getRealtimeProvider();
      const unsubscribers = channels.map((channel) =>
        bus.subscribe(channel, (event) => {
          const visible = options.filter ? options.filter(event) : event;
          if (visible) send(formatSse(visible, ++seq));
        }),
      );
      const heartbeat = setInterval(async () => {
        if (options.stillAuthorized && !(await options.stillAuthorized().catch(() => false))) return close();
        send(SSE_HEARTBEAT);
      }, heartbeatMs);
      const lifetime = options.maxLifetimeMs ? setTimeout(() => close(), options.maxLifetimeMs) : null;

      function close() {
        if (closed) return;
        closed = true;
        registry.delete(close);
        metrics.gauge("sse.connections", -1);
        metrics.inc("sse.closed");
        clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        for (const off of unsubscribers) off();
        try {
          controller.close();
        } catch {
          /* zaten kapalı */
        }
      }
      cleanup = close;
      registry.add(close);
      request.signal.addEventListener("abort", close, { once: true });
      // İlk yorum: bağlantı açıldı (istemci "canlı" göstergesini yakar). Yeniden bağlanma aralığı önerisi.
      send(`retry: 3000\n: connected\n\n`);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      // Nginx vb. vekillerde tamponlamayı kapat.
      "X-Accel-Buffering": "no",
      "X-Robots-Tag": "noindex",
    },
  });
}

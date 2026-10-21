import type Redis from "ioredis";
import { parseEnvelope, type RealtimeEnvelope } from "@/lib/realtime/events";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { parseRealtimeRedisChannel, realtimeRedisChannel } from "@/lib/redis/keys";

/**
 * Gerçek zamanlı olay sağlayıcıları. Yayınlayan servisler ve SSE uçları yalnızca `RealtimeProvider` arayüzünü bilir.
 *
 *  InMemoryProvider — tek süreç (geliştirme / tek örnek üretim).
 *  RedisProvider    — Redis Pub/Sub: A sürecinde yayınlanan olay, B sürecindeki SSE abonesine ulaşır.
 *    · Her süreç kanal başına TEK Redis aboneliği açar (ilk yerel dinleyicide SUBSCRIBE, sonuncusu gidince UNSUBSCRIBE)
 *      ve gelen mesajı yerel dinleyicilere dağıtır.
 *    · Kanal adı yalnızca sunucunun beyaz listedeki biçimlerinden üretilir (src/lib/redis/keys.ts); ad alanı ön eki ile
 *      ortamlar ayrılır. Gelen mesaj sürüm / tip beyaz listesiyle yeniden doğrulanır (bozuk / yabancı mesaj yok sayılır).
 *    · Redis'e yayın başarısızsa olay en azından AYNI süreçteki abonelere teslim edilir (kademeli bozulma) ve metrik /
 *      log üretilir. İstemciler olayı yalnızca "yeniden çek" sinyali sayar; kaçırılan olay yeniden bağlanınca telafi edilir.
 *    · Bağlantı koparsa ioredis yeniden bağlanır ve abonelikleri kendiliğinden yeniler (autoResubscribe).
 */
export type RealtimeListener = (event: RealtimeEnvelope) => void;

export interface RealtimeProvider {
  readonly name: "memory" | "redis";
  publish(channel: string, event: RealtimeEnvelope): void;
  subscribe(channel: string, listener: RealtimeListener): () => void;
  /** Teşhis: bu süreçte kanal başına yerel abone sayısı. */
  listenerCount(channel: string): number;
  close(): Promise<void>;
}

export class InMemoryProvider implements RealtimeProvider {
  readonly name: "memory" | "redis" = "memory";
  private channels = new Map<string, Set<RealtimeListener>>();

  publish(channel: string, event: RealtimeEnvelope) {
    metrics.inc("realtime.published");
    this.deliver(channel, event);
  }

  /** Yerel dinleyicilere teslim (Redis sağlayıcısı da kullanır). */
  deliver(channel: string, event: RealtimeEnvelope) {
    for (const listener of this.channels.get(channel) ?? []) {
      try {
        listener(event);
        metrics.inc("realtime.delivered");
      } catch (error) {
        log.error("realtime.listener_error", { channelKind: channel.split(":")[0], error });
      }
    }
  }

  subscribe(channel: string, listener: RealtimeListener) {
    const set = this.channels.get(channel) ?? new Set<RealtimeListener>();
    set.add(listener);
    this.channels.set(channel, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.channels.delete(channel);
    };
  }

  listenerCount(channel: string) {
    return this.channels.get(channel)?.size ?? 0;
  }

  channelCount() {
    return this.channels.size;
  }

  async close() {
    this.channels.clear();
  }
}

export class RedisProvider implements RealtimeProvider {
  readonly name = "redis" as const;
  private local = new InMemoryProvider();
  private onMessage = (redisChannel: string, message: string) => {
    const channel = parseRealtimeRedisChannel(this.namespace, redisChannel);
    if (!channel) return;
    const event = parseEnvelope(message);
    if (!event) return;
    this.local.deliver(channel, event);
  };

  constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
    private readonly namespace: string,
  ) {
    subscriber.on("message", this.onMessage);
  }

  publish(channel: string, event: RealtimeEnvelope) {
    const redisChannel = realtimeRedisChannel(this.namespace, channel);
    metrics.inc("realtime.published");
    this.publisher.publish(redisChannel, JSON.stringify(event)).catch((error: unknown) => {
      metrics.inc("realtime.publish_failed");
      log.warn("realtime.publish_failed", { code: "REALTIME_UNAVAILABLE", channelKind: channel.split(":")[0], errorName: error instanceof Error ? error.name : "unknown" });
      // Kademeli bozulma: en azından bu süreçteki abonelere ulaştır.
      this.local.deliver(channel, event);
    });
  }

  subscribe(channel: string, listener: RealtimeListener) {
    const redisChannel = realtimeRedisChannel(this.namespace, channel);
    const first = this.local.listenerCount(channel) === 0;
    const off = this.local.subscribe(channel, listener);
    if (first) {
      this.subscriber.subscribe(redisChannel).catch((error: unknown) => {
        log.warn("realtime.subscribe_failed", { code: "REALTIME_UNAVAILABLE", channelKind: channel.split(":")[0], errorName: error instanceof Error ? error.name : "unknown" });
      });
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      off();
      if (this.local.listenerCount(channel) === 0) this.subscriber.unsubscribe(redisChannel).catch(() => undefined);
    };
  }

  listenerCount(channel: string) {
    return this.local.listenerCount(channel);
  }

  /** Teşhis: bu sürecin açık Redis aboneliği sayısı. */
  channelCount() {
    return this.local.channelCount();
  }

  async close() {
    this.subscriber.off("message", this.onMessage);
    await this.local.close();
  }
}

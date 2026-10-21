import type Redis from "ioredis";
import { createMemoryRateLimiter, type RateLimiter, type RateLimitResult } from "@/lib/security/rate-limit";

/**
 * Hız sınırı arka uçları. Arayüz eşzamansızdır (Redis ağ çağrısı); bellek uygulaması aynı arayüzü sarar.
 *
 * Redis: sabit pencere sayacı TEK atomik işlemde (MULTI/EXEC):
 *   INCR key → PEXPIRE key window NX (yalnızca ilk vuruşta süre koyar) → PTTL key
 * "GET sonra SET" yarışı yoktur: iki süreç aynı anda vursa da INCR sırayla uygulanır ve sayılar tekildir.
 * PEXPIRE … NX için Redis ≥ 7.0 gerekir (bkz. docs/production-checklist.md).
 */
export interface RateLimitBackend {
  readonly name: "redis" | "memory";
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

function result(count: number, limit: number, ttlMs: number): RateLimitResult {
  const allowed = count <= limit;
  return { allowed, remaining: Math.max(0, limit - count), retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)) };
}

export function createRedisBackend(client: Redis): RateLimitBackend {
  return {
    name: "redis",
    async hit(key, limit, windowMs) {
      const replies = await client.multi().incr(key).pexpire(key, windowMs, "NX").pttl(key).exec();
      if (!replies) throw new Error("redis_tx_aborted");
      for (const [error] of replies) if (error) throw error;
      const count = Number(replies[0]![1]);
      let ttl = Number(replies[2]![1]);
      if (ttl < 0) {
        // Savunma: süresiz kalmış anahtar (olmamalı) — pencereyi yeniden koy.
        await client.pexpire(key, windowMs);
        ttl = windowMs;
      }
      return result(count, limit, ttl);
    },
    async reset(key) {
      await client.del(key);
    },
  };
}

/** Süreç içi arka uç: (limit, pencere) başına ayrı sabit pencere sayacı. */
export function createMemoryBackend(now: () => number = Date.now): RateLimitBackend & { clear(): void } {
  const limiters = new Map<string, RateLimiter>();
  const get = (limit: number, windowMs: number) => {
    const id = `${limit}/${windowMs}`;
    let l = limiters.get(id);
    if (!l) {
      l = createMemoryRateLimiter({ limit, windowMs, now });
      limiters.set(id, l);
    }
    return l;
  };
  return {
    name: "memory",
    async hit(key, limit, windowMs) {
      return get(limit, windowMs).hit(key);
    },
    async reset(key) {
      for (const l of limiters.values()) l.reset(key);
    },
    clear() {
      limiters.clear();
    },
  };
}

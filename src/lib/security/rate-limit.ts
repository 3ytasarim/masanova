/**
 * Hız sınırlama arayüzü + tek örnek (in-memory) sabit pencere uygulaması.
 *
 * Bellek içi uygulama tek sunucu örneğinde doğru çalışır; yatay ölçeklemede (birden çok örnek / serverless)
 * aynı arayüzü uygulayan Redis (Upstash) sürümüyle değiştirilmelidir — çağıran kod değişmez.
 */
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export interface RateLimiter {
  /** Bir denemeyi sayar ve sınırın aşılıp aşılmadığını döner. */
  hit(key: string): RateLimitResult;
  /** Başarılı işlemden sonra sayacı sıfırlar (ör. doğru parola). */
  reset(key: string): void;
}

export function createMemoryRateLimiter(options: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function sweep(current: number) {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) if (bucket.resetAt <= current) buckets.delete(key);
  }

  return {
    hit(key) {
      const current = now();
      sweep(current);
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= current) {
        bucket = { count: 0, resetAt: current + options.windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      const allowed = bucket.count <= options.limit;
      return {
        allowed,
        remaining: Math.max(0, options.limit - bucket.count),
        retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.resetAt - current) / 1000),
      };
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}

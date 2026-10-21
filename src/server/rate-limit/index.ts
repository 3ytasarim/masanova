import "server-only";
import type { RateLimitResult } from "@/lib/security/rate-limit";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { getRedis, namespace, waitReady } from "@/lib/redis/client";
import { rateLimitKey } from "@/lib/redis/keys";
import { RATE_LIMIT_POLICIES, type RateLimitPolicyName } from "@/server/rate-limit/policies";
import { createMemoryBackend, createRedisBackend, type RateLimitBackend } from "@/server/rate-limit/providers";

/**
 * Tek, yeniden kullanılabilir hız sınırı mimarisi.
 *   rateLimit(policy, subject)   → { allowed, remaining, retryAfterSeconds, backend }
 *   rateLimitAll([...])          → hepsi sayılır, biri bile aşılırsa reddedilir
 *   resetRateLimit(policy, subj) → başarılı girişten sonra sayaç sıfırlama
 *
 * REDIS_URL varsa paylaşılan Redis (süreçler / sunucular arası doğru). Yoksa süreç içi bellek (tek süreç için doğru —
 * PM2 küme kipinde Redis ZORUNLU). Redis yapılandırılmış ama erişilemiyorsa politika başına tanımlı yedek uygulanır
 * (bkz. policies.ts); sınır hiçbir durumda sessizce kaldırılmaz.
 */
export type LimitOutcome = RateLimitResult & { backend: "redis" | "memory" | "denied" };

const KEY = Symbol.for("masanova.ratelimit");
type State = { memory: ReturnType<typeof createMemoryBackend>; redis?: RateLimitBackend; lastFallbackLog?: number };
function state(): State {
  const g = globalThis as typeof globalThis & { [KEY]?: State };
  g[KEY] ??= { memory: createMemoryBackend() };
  return g[KEY];
}

async function redisBackend(): Promise<RateLimitBackend | null | "unavailable"> {
  const client = getRedis("command");
  if (!client) return null;
  if (!(await waitReady(client))) return "unavailable";
  const s = state();
  s.redis ??= createRedisBackend(client);
  return s.redis;
}

function noteFallback(policy: string, mode: string) {
  metrics.inc("ratelimit.fallback", 1, policy);
  const s = state();
  const now = Date.now();
  if (!s.lastFallbackLog || now - s.lastFallbackLog > 30_000) {
    s.lastFallbackLog = now;
    log.warn("ratelimit.fallback", { code: "RATE_LIMIT_FALLBACK", policy, mode });
  }
}

export async function rateLimit(policy: RateLimitPolicyName, subject: string): Promise<LimitOutcome> {
  const p = RATE_LIMIT_POLICIES[policy];
  const key = rateLimitKey(namespace(), policy, subject);
  const redis = await redisBackend();
  let outcome: LimitOutcome;
  if (redis && redis !== "unavailable") {
    try {
      outcome = { ...(await redis.hit(key, p.limit, p.windowMs)), backend: "redis" };
    } catch {
      outcome = await fallback(policy, key);
    }
  } else if (redis === "unavailable") {
    outcome = await fallback(policy, key);
  } else {
    outcome = { ...(await state().memory.hit(key, p.limit, p.windowMs)), backend: "memory" };
  }
  if (!outcome.allowed) metrics.inc("ratelimit.limited", 1, policy);
  return outcome;
}

async function fallback(policy: RateLimitPolicyName, key: string): Promise<LimitOutcome> {
  const p = RATE_LIMIT_POLICIES[policy];
  noteFallback(policy, p.onBackendFailure);
  if (p.onBackendFailure === "deny") return { allowed: false, remaining: 0, retryAfterSeconds: 30, backend: "denied" };
  return { ...(await state().memory.hit(key, p.limit, p.windowMs)), backend: "memory" };
}

/** Birden çok politikayı birlikte uygula (hepsi sayılır — mevcut davranışla aynı). */
export async function rateLimitAll(checks: readonly [RateLimitPolicyName, string][]): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const results = await Promise.all(checks.map(([policy, subject]) => rateLimit(policy, subject)));
  const blocked = results.filter((r) => !r.allowed);
  return { allowed: blocked.length === 0, retryAfterSeconds: Math.max(0, ...blocked.map((r) => r.retryAfterSeconds)) };
}

export async function resetRateLimit(policy: RateLimitPolicyName, subject: string): Promise<void> {
  const key = rateLimitKey(namespace(), policy, subject);
  await state().memory.reset(key);
  const redis = await redisBackend();
  if (redis && redis !== "unavailable") await redis.reset(key).catch(() => undefined);
}

/**
 * YALNIZCA testler: süreç içi sayaçları ve önbelleğe alınmış Redis arka ucunu sıfırla. HTTP üzerinden açılmaz;
 * tarayıcı test paketleri izolasyonu her paket için TAZE sunucu süreciyle sağlar (scripts/regression.mjs).
 */
export function resetRateLimitStateForTests(): void {
  const s = state();
  s.memory.clear();
  s.redis = undefined;
}

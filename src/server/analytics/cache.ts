import "server-only";
import { createHash } from "node:crypto";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { getRedis, namespace, waitReady } from "@/lib/redis/client";

/**
 * Kısa ömürlü analitik önbelleği (varsayılan 45 sn). Anahtar: kiracı + şube + dönem başı / sonu + saat dilimi + para
 * birimi + bölüm — kiracılar asla çakışmaz (anahtar özetlenir, iç kimlik Redis'te ham görünmez).
 * REDIS_URL varsa paylaşılan Redis (süreçler arası), yoksa / erişilemezse süreç içi bellek (en fazla 500 kayıt).
 * Önbellek hatası analitiği bozmaz: doğrudan hesaplanır. Canlı operasyon ekranları (KDS / servis panosu) bu önbelleği
 * KULLANMAZ.
 */
export const ANALYTICS_CACHE_TTL_MS = 45_000;

type Entry = { at: number; value: unknown };
const KEY = Symbol.for("masanova.analytics.cache");
function memory(): Map<string, Entry> {
  const g = globalThis as typeof globalThis & { [KEY]?: Map<string, Entry> };
  g[KEY] ??= new Map();
  return g[KEY];
}

export function analyticsCacheKey(parts: { tenantId: string; branchId: string | null; start: Date; end: Date; timeZone: string; currency: string; section: string }): string {
  const raw = [parts.tenantId, parts.branchId ?? "*", parts.start.toISOString(), parts.end.toISOString(), parts.timeZone, parts.currency, parts.section].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export async function cached<T>(key: string, section: string, compute: () => Promise<T>, ttlMs = ANALYTICS_CACHE_TTL_MS): Promise<{ value: T; cachedAt: number; hit: boolean }> {
  const now = Date.now();
  const mem = memory();
  const local = mem.get(key);
  if (local && now - local.at < ttlMs) {
    metrics.inc("analytics.cache_hit", 1, section);
    return { value: local.value as T, cachedAt: local.at, hit: true };
  }
  const redis = getRedis("command");
  const redisKey = `mn:${namespace()}:an:${key}`;
  if (redis && (await waitReady(redis, 200))) {
    try {
      const raw = await redis.get(redisKey);
      if (raw) {
        const entry = JSON.parse(raw) as Entry;
        mem.set(key, entry);
        metrics.inc("analytics.cache_hit", 1, section);
        return { value: entry.value as T, cachedAt: entry.at, hit: true };
      }
    } catch {
      /* önbellek hatası → hesapla */
    }
  }
  metrics.inc("analytics.cache_miss", 1, section);
  const value = await compute();
  const entry: Entry = { at: Date.now(), value };
  mem.set(key, entry);
  if (mem.size > 500) mem.delete(mem.keys().next().value!);
  if (redis && redis.status === "ready") {
    redis.set(redisKey, JSON.stringify(entry), "PX", ttlMs).catch((error: unknown) => log.debug("analytics.cache_write_failed", { errorName: error instanceof Error ? error.name : "unknown" }));
  }
  return { value, cachedAt: entry.at, hit: false };
}

/** Önbelleği verilen değerle doldurur (ör. "Analizi Yenile" sonrası taze sonuç normal anahtara da yazılır). */
export function primeCache<T>(key: string, value: T, ttlMs = ANALYTICS_CACHE_TTL_MS): void {
  const entry: Entry = { at: Date.now(), value };
  memory().set(key, entry);
  const redis = getRedis("command");
  const redisKey = `mn:${namespace()}:an:${key}`;
  if (redis && redis.status === "ready") {
    redis.set(redisKey, JSON.stringify(entry), "PX", ttlMs).catch((error: unknown) => log.debug("analytics.cache_write_failed", { errorName: error instanceof Error ? error.name : "unknown" }));
  }
}

/** Yalnızca testler. */
export function clearAnalyticsCacheForTests(): void {
  memory().clear();
}

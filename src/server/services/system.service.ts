import "server-only";
import { prisma } from "@/lib/db/prisma";
import { getEnvIssues, getServerEnv } from "@/lib/env";
import { diagnoseEnv, summarizeEnv } from "@/lib/env-diagnostics";
import { log } from "@/lib/observability/logger";
import { redisHealth, type RedisHealth } from "@/lib/redis/client";
import { getRealtimeProvider } from "@/server/realtime/bus";
import { getProviders } from "@/server/services/ai/config";
import { probeWritable } from "@/server/media/storage/probe";
import { resolveUploadRoot } from "@/server/media/storage/root";
import { releaseId, resolveAppEnv, type AppEnv } from "@/lib/runtime-profile";

export type DatabaseHealth = { status: "connected"; latencyMs: number } | { status: "disconnected" };

const DB_TIMEOUT_MS = 3_000;

/** `SELECT 1` ile veritabanı erişilebilirliği. Hata ayrıntısı (bağlantı dizesi vb.) dışarı verilmez. */
export async function checkDatabase(): Promise<DatabaseHealth> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
      }),
    ]);
    return { status: "connected", latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    log.error("health.database", { code: "DATABASE_UNAVAILABLE", errorName: error instanceof Error ? error.name : "unknown" });
    return { status: "disconnected" };
  } finally {
    clearTimeout(timer);
  }
}

export type SystemHealth = {
  status: "ok" | "degraded" | "down";
  database: DatabaseHealth["status"];
  databaseLatencyMs?: number;
  redis: RedisHealth["status"];
  realtime: "memory" | "redis";
  aiConfigured: boolean;
  /** Yükleme kökü yazılabilir mi (yol verilmez). */
  storage: "writable" | "unwritable";
  /** Dağıtım profili ve kısa sürüm kimliği (sır değil). */
  appEnv: AppEnv;
  release: string | null;
  /** Yapılandırma uyarıları — yalnızca değişken ADLARI (değer / host / URL asla). */
  configWarnings: string[];
};

/**
 * Sağlık: veritabanı (zorunlu), Redis (yapılandırılmışsa), gerçek zamanlı sağlayıcı, AI yapılandırması.
 *   down     → veritabanı yok (503; yük dengeleyici trafiği kesmeli)
 *   degraded → çekirdek çalışıyor ama Redis yapılandırılmış ve erişilemiyor (200; olaylar süreç içine, hız sınırı
 *              politikadaki yedeğe düşer)
 *   ok       → hepsi yolunda
 * Kimlik bilgisi, host, iç URL, anahtar ya da sürüm ayrıntısı dönmez.
 */
export async function systemHealth(): Promise<SystemHealth> {
  const env = getServerEnv();
  const [database, redis, writable] = await Promise.all([checkDatabase(), redisHealth(), probeWritable(resolveUploadRoot(env.UPLOAD_ROOT)).catch(() => false)]);
  const summary = summarizeEnv(diagnoseEnv(process.env), { production: resolveAppEnv() === "production", aiProvider: env.AI_PROVIDER });
  const providers = getProviders();
  const status = database.status !== "connected" ? "down" : redis.status === "disconnected" ? "degraded" : "ok";
  return {
    status,
    database: database.status,
    ...(database.status === "connected" ? { databaseLatencyMs: database.latencyMs } : {}),
    redis: redis.status,
    realtime: getRealtimeProvider().name,
    aiConfigured: !!providers.ai && !!providers.stt,
    storage: writable ? "writable" : "unwritable",
    appEnv: resolveAppEnv(),
    release: releaseId(),
    configWarnings: [...summary.warnings, ...getEnvIssues().map((name) => `${name}: geçersiz`)],
  };
}

export type Readiness = { ready: boolean; checks: { database: boolean; redis: boolean; storage: boolean } };

/**
 * Hazırlık (yük dengeleyici / dağıtım geçişi): ÇEKİRDEK bağımlılıklar — veritabanı, (yapılandırılmışsa) Redis, yazılabilir
 * yükleme kökü. AI / ödeme gibi isteğe bağlı özellik kesintileri restoranı "hazır değil" YAPMAZ.
 */
export async function systemReadiness(): Promise<Readiness> {
  const h = await systemHealth();
  const checks = { database: h.database === "connected", redis: h.redis !== "disconnected", storage: h.storage === "writable" };
  return { ready: checks.database && checks.redis && checks.storage, checks };
}

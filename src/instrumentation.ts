/**
 * Sunucu başlangıcında bir kez çalışır (yalnızca Node çalışma zamanı):
 *  1. Çekirdek ortam değişkenleri doğrulanır — hatalıysa uygulama ilk istekte değil, açılışta anlaşılır hatayla durur.
 *     AI / Redis yapılandırması eksik ya da hatalıysa platform YİNE açılır; yalnızca ilgili özellik kullanılamaz.
 *  2. Açılış tanılaması loglanır (yalnızca değişken ADLARI ve durumları — değer asla).
 *  3. Nazik kapanış kancaları + SIGTERM / SIGINT dinleyicileri kurulur (bkz. src/server/lifecycle/shutdown.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getServerEnv, getEnvIssues } = await import("@/lib/env");
  const env = getServerEnv();
  const { diagnoseEnv, summarizeEnv } = await import("@/lib/env-diagnostics");
  const { log } = await import("@/lib/observability/logger");
  const summary = summarizeEnv(diagnoseEnv(process.env), { production: (await import("@/lib/runtime-profile")).resolveAppEnv() === "production", aiProvider: env.AI_PROVIDER });
  // Sprint 21: üretim açılış denetimleri (APP_ENV=production'da çekirdek hata → süreç BAŞLAMAZ).
  const { startupChecks } = await import("@/lib/startup-checks");
  const { probeWritable } = await import("@/server/media/storage/probe");
  const { resolveUploadRoot } = await import("@/server/media/storage/root");
  const { releaseId } = await import("@/lib/runtime-profile");
  let uploadWritable: boolean | null = null;
  if (process.env.UPLOAD_ROOT) {
    try {
      uploadWritable = await probeWritable(resolveUploadRoot(process.env.UPLOAD_ROOT));
    } catch {
      uploadWritable = false;
    }
  }
  const checks = startupChecks({ env: process.env, uploadWritable });
  log.info("startup", {
    appEnv: checks.appEnv,
    release: releaseId(),
    aiConfigured: summary.aiConfigured,
    redisConfigured: summary.redisConfigured,
    warnings: [...summary.warnings, ...getEnvIssues().map((n) => `${n}: geçersiz`), ...checks.warnings],
  });
  if (checks.fatal.length) {
    log.error("startup.fatal", { appEnv: checks.appEnv, problems: checks.fatal });
    throw new Error(`Üretim açılış denetimi başarısız: ${checks.fatal.join(" · ")}`);
  }

  const { onShutdown, installSignalHandlers } = await import("@/server/lifecycle/shutdown");
  const { closeRealtimeProvider } = await import("@/server/realtime/bus");
  const { closeRedis } = await import("@/lib/redis/client");
  const { prisma } = await import("@/lib/db/prisma");
  onShutdown("realtime.provider", 70, () => closeRealtimeProvider());
  onShutdown("redis", 80, () => closeRedis());
  onShutdown("prisma", 90, () => prisma.$disconnect());
  // NEXT_MANUAL_SIG_HANDLE=true iken sinyali yalnızca biz yönetiriz (önerilen üretim ayarı): kaynaklar sırayla
  // kapanır, sonra süreç biter. Aksi halde Next'in kendi işleyicisi de çalışır; kancalarımız yine tetiklenir.
  installSignalHandlers({ exitAfter: true, budgetMs: 8000 });
}

/** İstek hatası kancası: yapılandırılmış, kırpılmış log (yığın izi / mesaj istemciye gitmez). */
export async function onRequestError(error: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routeType: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("@/lib/observability/logger");
  const id = request.headers["x-request-id"];
  log.error("request.error", {
    requestId: typeof id === "string" ? id : null,
    method: request.method,
    route: request.path.replace(/\/(q|t)\/[A-Za-z0-9_-]{16,}/g, "/$1/<qr>"),
    routeType: context.routeType,
    code: "INTERNAL_ERROR",
    errorName: error instanceof Error ? error.name : "unknown",
    digest: error && typeof error === "object" && "digest" in error ? String((error as { digest: unknown }).digest) : null,
  });
}

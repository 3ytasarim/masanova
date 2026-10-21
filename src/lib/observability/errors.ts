/**
 * Kararlı iç hata kodları — loglar, metrikler ve (gerektiğinde) güvenli hata yanıtları için. Kod sözleşmedir: anlamı
 * değişmez, yeni durum yeni kod alır. Yığın izi / altyapı ayrıntısı herkese açık yanıta ASLA konmaz.
 */
export const ERROR_CODES = [
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_ERROR",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_STT_FAILED",
  "AI_TTS_FAILED",
  "AI_RATE_LIMITED",
  "REALTIME_UNAVAILABLE",
  "REDIS_UNAVAILABLE",
  "RATE_LIMIT_FALLBACK",
  "ORDER_CONFLICT",
  "ORDER_REJECTED",
  "SERVICE_REQUEST_DUPLICATE",
  "TENANT_ACCESS_DENIED",
  "SSRF_BLOCKED",
  "BODY_TOO_LARGE",
  "REQUEST_TIMEOUT",
  "DATABASE_UNAVAILABLE",
  "SHUTTING_DOWN",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Sağlayıcı hata nedenini (openai.ts ProviderError.message) kararlı koda eşle. */
export function providerErrorCode(reason: string | undefined): ErrorCode {
  if (reason === "timeout") return "AI_PROVIDER_TIMEOUT";
  if (reason === "network" || reason === "unavailable" || reason === "provider_unavailable") return "AI_PROVIDER_UNAVAILABLE";
  if (reason === "stt_failed") return "AI_STT_FAILED";
  if (reason === "tts_failed" || reason === "tts_unavailable") return "AI_TTS_FAILED";
  return "AI_PROVIDER_ERROR";
}

/**
 * Ortam değişkeni sınıflandırması ve açılış tanılaması (saf). Çıktı YALNIZCA ad + durum içerir; değer, uzunluk ya da
 * önek ASLA yazılmaz.
 *
 *   core        — platformun açılması için zorunlu (yoksa süreç başlamaz)
 *   ai          — sesli AI için gerekli (yoksa yalnızca AI kullanılamaz; menü / sipariş / mutfak çalışır)
 *   redis       — isteğe bağlı; çok süreçli / çok sunuculu üretimde gerçek zamanlı ve hız sınırı için GEREKLİ
 *   production  — üretimde ayarlanmalı (yoksa uyarı)
 *   optional    — ince ayar
 */
export type EnvClass = "core" | "ai" | "redis" | "production" | "optional";
export type EnvSpec = { name: string; class: EnvClass; secret: boolean; check?: (value: string) => boolean; note: string };

/** Görsel adres öneki: "/" ile başlayan yol ("/media") ya da sorgu / parça içermeyen https adresi. */
export function isUploadBaseUrl(value: string): boolean {
  return /^\/[A-Za-z0-9/_-]*$/.test(value) || /^https:\/\/[^\s?#]+$/.test(value);
}

const isUrl = (v: string) => {
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
};
const isPg = (v: string) => v.startsWith("postgresql://") || v.startsWith("postgres://");

export const ENV_SPECS: readonly EnvSpec[] = [
  { name: "DATABASE_URL", class: "core", secret: true, check: isPg, note: "Neon pooled (çalışma zamanı)" },
  { name: "DIRECT_URL", class: "core", secret: true, check: isPg, note: "Neon doğrudan (migration)" },
  { name: "QR_TOKEN_SECRET", class: "core", secret: true, check: (v) => v.length >= 32, note: "QR HMAC sırrı, ≥ 32 karakter" },
  { name: "NEXT_PUBLIC_APP_URL", class: "core", secret: false, check: isUrl, note: "platform origin (derlemeye gömülür)" },
  { name: "NEXT_PUBLIC_ROOT_DOMAIN", class: "core", secret: false, note: "kiracı alt alan kökü (derlemeye gömülür)" },
  { name: "APP_ENV", class: "production", secret: false, check: (v) => ["development", "test", "staging", "production"].includes(v), note: "dağıtım profili (NODE_ENV standart kalır)" },
  { name: "QR_ENTRY_ORIGIN", class: "production", secret: false, check: isUrl, note: "basılı QR'ların kararlı origin'i" },
  { name: "AI_PROVIDER", class: "ai", secret: false, check: (v) => v === "openai" || v === "mock", note: "openai | mock" },
  { name: "AI_API_KEY", class: "ai", secret: true, check: (v) => v.length >= 20, note: "AI sağlayıcı anahtarı" },
  { name: "AI_MODEL", class: "optional", secret: false, note: "varsayılan gpt-4.1-mini" },
  { name: "VOICE_STT_PROVIDER", class: "ai", secret: false, check: (v) => v === "openai" || v === "mock", note: "openai | mock" },
  { name: "VOICE_TTS_PROVIDER", class: "ai", secret: false, check: (v) => v === "openai" || v === "mock", note: "openai | mock" },
  { name: "VOICE_STT_API_KEY", class: "optional", secret: true, note: "boşsa AI_API_KEY" },
  { name: "VOICE_TTS_API_KEY", class: "optional", secret: true, note: "boşsa AI_API_KEY" },
  { name: "VOICE_REALTIME", class: "optional", secret: false, check: (v) => v === "on" || v === "off", note: "canlı ses aç / kapa" },
  { name: "REDIS_URL", class: "redis", secret: true, check: (v) => v.startsWith("redis://") || v.startsWith("rediss://"), note: "paylaşılan durum (Redis ≥ 7)" },
  { name: "REDIS_NAMESPACE", class: "optional", secret: false, check: (v) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(v), note: "ortam ayırıcı" },
  { name: "CONTACT_VERIFICATION_PROVIDER", class: "optional", secret: false, check: (v) => v === "mock" && process.env.NODE_ENV !== "production", note: "boş = doğrulama kapalı; mock yalnızca test" },
  { name: "PAYMENT_PROVIDER", class: "optional", secret: false, check: (v) => v === "mock", note: "boş = online ödeme kapalı; mock = TEST (gerçek para yok)" },
  { name: "PAYMENT_WEBHOOK_SECRET", class: "optional", secret: true, check: (v) => v.length >= 24, note: "webhook imza sırrı (gerçek sağlayıcıda zorunlu)" },
  { name: "UPLOAD_ROOT", class: "production", secret: false, check: (v) => v.startsWith("/") || /^[A-Za-z]:[\\/]/.test(v), note: "yüklenen görseller (mutlak yol, uygulama dışı)" },
  { name: "UPLOAD_PUBLIC_BASE_URL", class: "optional", secret: false, check: isUploadBaseUrl, note: "varsayılan /media" },
  { name: "RELEASE_ID", class: "optional", secret: false, note: "sağlıkta kısa sürüm kimliği (ya da GIT_SHA)" },
  { name: "LOG_LEVEL", class: "optional", secret: false, check: (v) => ["debug", "info", "warn", "error"].includes(v), note: "varsayılan info" },
];

export type EnvStatus = "ok" | "missing" | "invalid";
export type EnvDiagnosis = { name: string; class: EnvClass; status: EnvStatus };

export function diagnoseEnv(env: Record<string, string | undefined>): EnvDiagnosis[] {
  return ENV_SPECS.map((spec) => {
    const value = env[spec.name];
    if (!value) return { name: spec.name, class: spec.class, status: "missing" };
    return { name: spec.name, class: spec.class, status: spec.check && !spec.check(value) ? "invalid" : "ok" };
  });
}

export type EnvSummary = { coreOk: boolean; aiConfigured: boolean; redisConfigured: boolean; warnings: string[] };

/** Özet: hangi özellik kullanılabilir, hangi uyarılar (yalnızca ad). */
export function summarizeEnv(diagnoses: readonly EnvDiagnosis[], options: { production: boolean; aiProvider?: string }): EnvSummary {
  const by = new Map(diagnoses.map((d) => [d.name, d.status]));
  const core = diagnoses.filter((d) => d.class === "core");
  // Üretim profilinde "mock" yok sayılır (src/lib/runtime-profile.ts) → AI yapılandırılmamış sayılır.
  const mock = options.aiProvider === "mock" && !options.production;
  const aiProvider = by.get("AI_PROVIDER") === "ok" && (mock || by.get("AI_API_KEY") === "ok");
  const warnings: string[] = [];
  for (const d of diagnoses) if (d.status === "invalid") warnings.push(`${d.name}: geçersiz`);
  if (options.production) {
    for (const d of diagnoses) if (d.class === "production" && d.status === "missing") warnings.push(`${d.name}: üretimde ayarlanmalı`);
    if (by.get("REDIS_URL") !== "ok") warnings.push("REDIS_URL: yok — yalnızca TEK süreçte doğru (PM2 küme kipinde gerekli)");
  }
  if (by.get("AI_PROVIDER") === "ok" && !mock && by.get("AI_API_KEY") !== "ok") warnings.push("AI_API_KEY: AI_PROVIDER ayarlı ama anahtar yok — AI kullanılamaz");
  return { coreOk: core.every((d) => d.status === "ok"), aiConfigured: aiProvider, redisConfigured: by.get("REDIS_URL") === "ok", warnings };
}

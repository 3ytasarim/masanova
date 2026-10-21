import { resolveAppEnv, type AppEnv } from "@/lib/runtime-profile";

/**
 * Üretim açılış denetimleri (SAF; G/Ç çağıran tarafından verilir). Çıktı YALNIZCA değişken adı + durum; değer asla.
 *
 *   fatal    → çekirdek hata: süreç BAŞLAMAZ (veri kaybı / yanlış davranış riski)
 *   warnings → isteğe bağlı özellik kapatıldı / dikkat
 *
 * Yalnızca APP_ENV=production'da fatal üretir; diğer profillerde aynı bulgular uyarıdır.
 */
export type StartupInput = {
  env: Record<string, string | undefined>;
  /** UPLOAD_ROOT yazılabilir mi (çağıran dener). null = denenmedi. */
  uploadWritable: boolean | null;
};
export type StartupReport = { appEnv: AppEnv; fatal: string[]; warnings: string[] };

const hostnamePattern = /^(localhost|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+)(:\d{2,5})?$/i;

/** PM2 küme kipi ya da açık çoklu örnek. PM2, uygulama ayarlarını (exec_mode, instances) ortama yansıtır. */
export function isMultiProcess(env: Record<string, string | undefined>): boolean {
  if (env.exec_mode === "cluster_mode") return true;
  const n = Number(env.instances ?? env.APP_INSTANCES ?? "1");
  return Number.isFinite(n) && n > 1;
}

export function startupChecks(input: StartupInput): StartupReport {
  const { env } = input;
  const appEnv = resolveAppEnv(env);
  const production = appEnv === "production";
  const fatal: string[] = [];
  const warnings: string[] = [];
  const core = (msg: string) => (production ? fatal : warnings).push(msg);

  if (!env.QR_TOKEN_SECRET || env.QR_TOKEN_SECRET.length < 32) core("QR_TOKEN_SECRET: eksik ya da kısa (≥ 32)");
  const root = env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";
  if (!root || !hostnamePattern.test(root)) core("NEXT_PUBLIC_ROOT_DOMAIN: geçersiz");
  else if (production && /^localhost(:\d+)?$/i.test(root)) warnings.push("NEXT_PUBLIC_ROOT_DOMAIN: üretimde localhost");
  if (production && !env.QR_ENTRY_ORIGIN) warnings.push("QR_ENTRY_ORIGIN: ayarlı değil — basılı QR'lar NEXT_PUBLIC_APP_URL'ye bağlanır (sonradan DEĞİŞTİRİLEMEZ)");

  const uploadRoot = env.UPLOAD_ROOT ?? "";
  if (!uploadRoot) core("UPLOAD_ROOT: ayarlı değil — yüklemeler kaynak klasörüne yazılır ve dağıtımda kaybolur");
  else if (!(uploadRoot.startsWith("/") || /^[A-Za-z]:[\\/]/.test(uploadRoot))) core("UPLOAD_ROOT: mutlak yol olmalı");
  else if (input.uploadWritable === false) core("UPLOAD_ROOT: yazılamıyor");

  if (isMultiProcess(env) && !env.REDIS_URL) core("REDIS_URL: çok süreçli (PM2 küme) çalışmada ZORUNLU — gerçek zamanlı olaylar ve hız sınırları süreçler arası paylaşılmaz");

  if (production) {
    const mocks = ["AI_PROVIDER", "VOICE_STT_PROVIDER", "VOICE_TTS_PROVIDER", "PAYMENT_PROVIDER", "CONTACT_VERIFICATION_PROVIDER"].filter((k) => env[k] === "mock");
    for (const k of mocks) warnings.push(`${k}: "mock" üretimde YOK SAYILDI — ilgili özellik kapalı (yalnızca APP_ENV=staging / test)`);
    if (env.AI_PROVIDER === "openai" && !env.AI_API_KEY) warnings.push("AI_API_KEY: yok — sesli AI / Danışman açıklaması kapalı");
    if (!env.PAYMENT_PROVIDER || env.PAYMENT_PROVIDER === "mock") warnings.push("PAYMENT_PROVIDER: gerçek sağlayıcı yok — online ödeme kapalı");
  }
  return { appEnv, fatal, warnings };
}

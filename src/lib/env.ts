import "server-only";
import { z } from "zod";
import { publicEnv } from "@/lib/env.public";
import { isUploadBaseUrl } from "@/lib/env-diagnostics";

/**
 * Sunucu ortam değişkenleri. Yalnızca sunucuda import edilebilir ("server-only" bunu derleme anında garanti eder),
 * böylece DATABASE_URL gibi sırlar istemci paketine asla giremez.
 *
 * Doğrulama ilk erişimde yapılır ve hata mesajı değerleri DEĞİL yalnızca hatalı değişken adlarını içerir.
 * Sınıflandırma ve açılış tanılaması: src/lib/env-diagnostics.ts.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "zorunlu")
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), "postgresql:// ile başlamalı"),
  DIRECT_URL: z
    .string()
    .min(1, "zorunlu")
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), "postgresql:// ile başlamalı"),
  /** Masa QR adreslerini türeten HMAC sırrı (bkz. src/lib/tables/qr-token.ts). */
  QR_TOKEN_SECRET: z.string().min(32, "en az 32 karakter olmalı"),
  /** Basılı QR'ların kodladığı kararlı giriş origin'i (ör. https://go.masanovai.com). Boşsa NEXT_PUBLIC_APP_URL. */
  QR_ENTRY_ORIGIN: z.union([z.literal(""), z.url()]).optional(),
});

const optionalEnum = <T extends [string, ...string[]]>(values: T) => z.enum(values).optional().or(z.literal("").transform(() => undefined));

/**
 * İsteğe bağlı bölümler (AI / ses / Redis / gözlemlenebilirlik) ALAN ALAN ve HOŞGÖRÜLÜ doğrulanır: hatalı bir AI ayarı
 * restoran platformunu (menü / sipariş / mutfak) DURDURMAZ — o alan "yok" sayılır, sorun getEnvIssues() ile
 * sağlık / tanılama çıktısına (yalnızca ad, değer asla) yansır ve ilgili özellik kullanılamaz olur.
 */
const optionalSchema = z.object({
  /**
   * AI / ses sağlayıcıları (Sprint 9) — hepsi isteğe bağlı ve YALNIZCA sunucuda. Sağlayıcı boşsa asistan "yapılandırılmamış"
   * sayılır (müşteriye gösterilmez). "mock" yalnızca geliştirme / otomatik test içindir (gerçek yanıt üretmez).
   */
  AI_PROVIDER: optionalEnum(["openai", "mock"]),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  VOICE_STT_PROVIDER: optionalEnum(["openai", "mock"]),
  VOICE_STT_API_KEY: z.string().optional(),
  VOICE_STT_MODEL: z.string().optional(),
  VOICE_TTS_PROVIDER: optionalEnum(["openai", "mock"]),
  VOICE_TTS_API_KEY: z.string().optional(),
  VOICE_TTS_MODEL: z.string().optional(),
  VOICE_TTS_VOICE_TR: z.string().optional(),
  VOICE_TTS_VOICE_EN: z.string().optional(),
  VOICE_TTS_VOICE_DE: z.string().optional(),
  VOICE_TTS_VOICE_AR: z.string().optional(),
  VOICE_TTS_VOICE_RU: z.string().optional(),
  /** Canlı (akışlı) ses: "off" ise yalnızca bas-konuş (Sprint 9) kullanılır. Boş = açık (sağlayıcılar yapılandırılmışsa). */
  VOICE_REALTIME: optionalEnum(["on", "off"]),
  /** Sesten sese canlı garson (OpenAI Realtime): model ve ses. Boş = gpt-realtime / marin. */
  VOICE_REALTIME_MODEL: z.string().optional(),
  VOICE_REALTIME_VOICE: z.string().optional(),
  /** Paylaşılan durum (gerçek zamanlı olay yolu + hız sınırı). Boşsa süreç içi bellek (yalnızca tek süreçte doğru). */
  REDIS_URL: z
    .string()
    .refine((v) => v === "" || v.startsWith("redis://") || v.startsWith("rediss://"), "redis:// ya da rediss:// ile başlamalı")
    .optional(),
  /** Aynı Redis'i paylaşan ortamları ayırır (ör. prod / staging / test koşusu). */
  REDIS_NAMESPACE: z.string().max(32).optional(),
  LOG_LEVEL: optionalEnum(["debug", "info", "warn", "error"]),
  /**
   * Yüklenen görsellerin kök klasörü (Sprint 13). Kaynak kodun DIŞINDA olmalı (üretim: /var/lib/masanova/uploads) —
   * yeniden dağıtım yüklemeleri silmez. Boşsa geliştirme varsayılanı ./storage/uploads (git'e girmez).
   */
  UPLOAD_ROOT: z.string().max(500).optional(),
  /**
   * Müşteri iletişim doğrulaması (Sprint 16). Boş = KAPALI: SMS / e-posta gönderilmez, bilgiler "doğrulanmamış" kaydedilir
   * ve hiçbir hesapla birleştirilmez. "mock" yalnızca test / geliştirme içindir (üretimde reddedilir); kod
   * CONTACT_VERIFICATION_MOCK_CODE (6 hane) ile sabitlenir. Gerçek sağlayıcı ileride eklenecek.
   */
  CONTACT_VERIFICATION_PROVIDER: optionalEnum(["mock"]),
  /**
   * Online ödeme sağlayıcısı (Sprint 19). Boş = online ödeme KAPALI. "mock" = TEST sağlayıcısı (gerçek para çekilmez).
   * Gerçek sağlayıcı adaptörü henüz yok. Sırlar yalnızca sunucuda.
   */
  PAYMENT_PROVIDER: optionalEnum(["mock"]),
  PAYMENT_API_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
  PAYMENT_PUBLIC_KEY: z.string().optional(),
  CONTACT_VERIFICATION_MOCK_CODE: z.string().regex(/^[0-9]{6}$/).optional().or(z.literal("").transform(() => undefined)),
  /**
   * Görsellerin tarayıcıya sunulduğu adres öneki. Boşsa "/media" (uygulama sunar; Nginx doğrudan da sunabilir).
   * CDN / ayrı alan için https adresi. Disk yolu tarayıcıya asla gitmez.
   */
  UPLOAD_PUBLIC_BASE_URL: z
    .string()
    .refine((v) => v === "" || isUploadBaseUrl(v), "/ ile başlayan yol ya da https:// adresi olmalı")
    .optional(),
});

export type ServerEnv = z.infer<typeof serverSchema> & z.infer<typeof optionalSchema> & typeof publicEnv;

let cached: ServerEnv | undefined;
let issues: string[] = [];

function parseOptional(source: NodeJS.ProcessEnv): { data: z.infer<typeof optionalSchema>; problems: string[] } {
  const data: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const [key, schema] of Object.entries(optionalSchema.shape)) {
    const r = (schema as z.ZodType).safeParse(source[key]);
    if (r.success) data[key] = r.data;
    else problems.push(key);
  }
  return { data: data as z.infer<typeof optionalSchema>, problems };
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Geçersiz sunucu ortam değişkenleri → ${problems}. .env.example dosyasına bakın.`);
  }
  const optional = parseOptional(process.env);
  issues = optional.problems;
  cached = { ...parsed.data, ...optional.data, ...publicEnv };
  return cached;
}

/** İsteğe bağlı alanlarda bulunan sorunlar — yalnızca değişken ADLARI (değer yok). */
export function getEnvIssues(): readonly string[] {
  getServerEnv();
  return issues;
}

export const isProduction = process.env.NODE_ENV === "production";

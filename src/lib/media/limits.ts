/**
 * Görsel yükleme kuralları — TEK kaynak (sunucu doğrular; panel aynı değerleri ipucu ve ön kontrol için kullanır).
 * Önerilen boyutlar ZORUNLU DEĞİLDİR: daha küçük / farklı oranlı görsel kabul edilir, gösterimde ortalanarak kırpılır
 * (logo hariç: logo asla kırpılmaz, sığdırılır).
 */
export const MEDIA_KINDS = ["PRODUCT", "CATEGORY", "HERO", "LOGO"] as const;
export type MediaKindKey = (typeof MEDIA_KINDS)[number];

/** Kabul edilen kaynak biçimleri. SVG bu sürümde KABUL EDİLMEZ (güvenli temizleme garanti edilemiyor). GIF yok (animasyon). */
export const ACCEPTED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIME)[number];
export const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_MIME.join(",");

const MB = 1024 * 1024;

export type MediaKindRule = {
  /** Kaynak dosya üst sınırı (bayt). */
  maxBytes: number;
  recommended: { width: number; height: number; ratio: string };
  /** Panelde gösterilen kısa not. */
  note: string;
};

export const MEDIA_RULES: Record<MediaKindKey, MediaKindRule> = {
  PRODUCT: { maxBytes: 10 * MB, recommended: { width: 1600, height: 1200, ratio: "4:3" }, note: "Masaüstünde 16:9'a yakın kırpılabilir — ürünü ortada tutun." },
  CATEGORY: { maxBytes: 10 * MB, recommended: { width: 1500, height: 500, ratio: "3:1" }, note: "Ortadan kırpılarak gösterilir." },
  HERO: { maxBytes: 15 * MB, recommended: { width: 1920, height: 640, ratio: "3:1" }, note: "Geniş ekranda kenarlar kırpılabilir — önemli kısmı ortada tutun." },
  LOGO: { maxBytes: 5 * MB, recommended: { width: 512, height: 512, ratio: "1:1" }, note: "Şeffaf arka planlı PNG / WebP önerilir; kırpılmaz, sığdırılır." },
};

/** Ürün başına görsel sınırı (harici + yüklenen). */
export const MAX_PRODUCT_IMAGES = 10;

/** Kod çözülmüş piksel üst sınırı (görüntü bombası koruması): 40 MP — ör. 8000 × 5000. */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Tek kenar üst sınırı. */
export const MAX_INPUT_DIMENSION = 12_000;
/** İstek gövdesi için çok parçalı form ek payı (alan adları, sınırlar). */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
/** Her türün en büyüğü — istek gövdesi okunurken mutlak üst sınır. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(MEDIA_RULES).map((r) => r.maxBytes));

export const MEDIA_ERROR_MESSAGES = {
  unsupported: "Desteklenmeyen dosya. JPEG, PNG ya da WebP görsel yükleyin.",
  too_large: "Dosya çok büyük.",
  dimensions: "Görsel boyutu çok büyük (en fazla 40 megapiksel).",
  animated: "Hareketli görseller desteklenmiyor. Tek kareli bir görsel yükleyin.",
  processing_failed: "Görsel işlenemedi. Başka bir dosya deneyin.",
  not_found: "Kayıt bulunamadı.",
  limit: "Bu ürün için görsel sınırına ulaşıldı.",
  storage_limit: "Paketinizin görsel depolama limitine ulaşıldı. Kullanılmayan görselleri kaldırın ya da paketinizi yükseltin.",
  failed: "Yükleme başarısız oldu. Lütfen tekrar deneyin.",
} as const;
export type MediaErrorCode = keyof typeof MEDIA_ERROR_MESSAGES;

export function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / MB) * 10) / 10} MB`;
}

export function tooLargeMessage(kind: MediaKindKey): string {
  return `${MEDIA_ERROR_MESSAGES.too_large} En fazla ${formatMegabytes(MEDIA_RULES[kind].maxBytes)}.`;
}

export function isMediaKind(value: unknown): value is MediaKindKey {
  return typeof value === "string" && (MEDIA_KINDS as readonly string[]).includes(value);
}

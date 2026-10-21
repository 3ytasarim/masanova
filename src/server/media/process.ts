import "server-only";
import sharp, { type Metadata } from "sharp";
import { MAX_INPUT_DIMENSION, MAX_INPUT_PIXELS, type MediaErrorCode, type MediaKindKey } from "@/lib/media/limits";
import { sniffImageMime } from "@/lib/media/sniff";

/**
 * Sunucu tarafı görsel işleme (sharp / libvips).
 *
 * Güvenlik:
 * - Biçim imzadan (sihirli baytlar) belirlenir VE çözülen biçimle eşleşmelidir; uzantı / Content-Type'a güvenilmez.
 * - Görüntü bombası: başlıktan okunan boyut tek kenarda ≤ 12.000 px ve toplam ≤ 40 MP; ayrıca sharp'ın
 *   limitInputPixels sınırı kod çözme sırasında da uygulanır.
 * - Hareketli görsel (çok sayfalı WebP / APNG) REDDEDİLİR — animasyon dizisi işlenmez. GIF / SVG / HEIC kabul edilmez.
 * Gizlilik: EXIF yönü uygulanır (rotate) ve TÜM meta veri (EXIF / GPS / XMP / IPTC / metin parçaları) atılır —
 * sharp çıktıya meta veri yazmaz (withMetadata çağrılmaz). Renk profili sRGB'ye dönüştürülür.
 * Kaynak asla saklanmaz; yalnızca yeniden kodlanmış çıktılar yazılır (çok biçimli / gömülü yük taşıyan dosya kalmaz).
 */
sharp.cache(false);

type Fit = "inside" | "cover";
type RenditionSpec = { name: string; width: number; height: number; fit: Fit; format: "webp" | "png" };

/** Tür başına çıktılar. "display" panel / menüde varsayılan gösterim. Küçük kaynak BÜYÜTÜLMEZ. */
export const RENDITIONS: Record<MediaKindKey, { display: string; specs: RenditionSpec[] }> = {
  // Ürün: oran korunur (kırpma yok), uzun kenar sınırı.
  PRODUCT: {
    display: "md",
    specs: [
      { name: "lg", width: 1600, height: 1600, fit: "inside", format: "webp" },
      { name: "md", width: 900, height: 900, fit: "inside", format: "webp" },
      { name: "sm", width: 400, height: 400, fit: "inside", format: "webp" },
    ],
  },
  // Kategori: optimize ana kopya (kırpılmamış) + ortadan kırpılmış gösterim çıktıları.
  CATEGORY: {
    display: "lg",
    specs: [
      { name: "orig", width: 3000, height: 3000, fit: "inside", format: "webp" },
      { name: "lg", width: 1500, height: 500, fit: "cover", format: "webp" },
      { name: "sm", width: 750, height: 250, fit: "cover", format: "webp" },
    ],
  },
  HERO: {
    display: "lg",
    specs: [
      { name: "orig", width: 3840, height: 3840, fit: "inside", format: "webp" },
      { name: "lg", width: 1920, height: 640, fit: "cover", format: "webp" },
      { name: "md", width: 960, height: 320, fit: "cover", format: "webp" },
    ],
  },
  // Logo: asla kırpılmaz (contain), şeffaflık korunur; PNG çıktı etiket PDF'i içindir (pdf-lib WebP gömmez).
  LOGO: {
    display: "md",
    specs: [
      { name: "orig", width: 1024, height: 1024, fit: "inside", format: "webp" },
      { name: "md", width: 512, height: 512, fit: "inside", format: "webp" },
      { name: "png", width: 512, height: 512, fit: "inside", format: "png" },
    ],
  },
};

export type ProcessedRendition = { name: string; width: number; height: number; bytes: number; format: "webp" | "png"; contentType: string; data: Buffer };
export type ProcessedImage = { sourceMime: string; width: number; height: number; renditions: ProcessedRendition[] };
export type ProcessResult = { ok: true; image: ProcessedImage } | { ok: false; error: Extract<MediaErrorCode, "unsupported" | "dimensions" | "animated" | "processing_failed"> };

const SHARP_FORMAT: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

function open(input: Buffer) {
  // failOn "error": bozuk / kesik dosya reddedilir; animated:false yalnızca ilk kare (zaten çok kareli reddedilir).
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false });
}

export async function processImage(input: Buffer, kind: MediaKindKey): Promise<ProcessResult> {
  const sniffed = sniffImageMime(input);
  if (!sniffed) return { ok: false, error: "unsupported" };

  let meta: Metadata;
  try {
    meta = await open(input).metadata();
  } catch (error) {
    // sharp başlıktaki boyutu limitInputPixels ile karşılaştırır: bomba kod çözülmeden reddedilir.
    return { ok: false, error: isPixelLimit(error) ? "dimensions" : "processing_failed" };
  }
  if (meta.format !== SHARP_FORMAT[sniffed]) return { ok: false, error: "unsupported" };
  if (!meta.width || !meta.height) return { ok: false, error: "processing_failed" };
  if (meta.width > MAX_INPUT_DIMENSION || meta.height > MAX_INPUT_DIMENSION || meta.width * meta.height > MAX_INPUT_PIXELS) {
    return { ok: false, error: "dimensions" };
  }
  if ((meta.pages ?? 1) > 1) return { ok: false, error: "animated" };

  const renditions: ProcessedRendition[] = [];
  try {
    for (const spec of RENDITIONS[kind].specs) {
      let pipeline = open(input)
        .rotate() // EXIF yönü
        .resize({ width: spec.width, height: spec.height, fit: spec.fit, position: "centre", withoutEnlargement: true })
        .toColourspace("srgb");
      pipeline =
        spec.format === "png"
          ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
          : pipeline.webp(kind === "LOGO" ? { quality: 90, alphaQuality: 100, effort: 4 } : { quality: 82, alphaQuality: 90, effort: 4 });
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      renditions.push({
        name: spec.name,
        width: info.width,
        height: info.height,
        bytes: info.size,
        format: spec.format,
        contentType: spec.format === "png" ? "image/png" : "image/webp",
        data,
      });
    }
  } catch (error) {
    if (isPixelLimit(error)) return { ok: false, error: "dimensions" };
    return { ok: false, error: "processing_failed" };
  }
  // Yön uygulandıktan sonraki boyut (90° döndürülmüş fotoğrafta genişlik / yükseklik yer değiştirir).
  const oriented = meta.orientation && meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  return { ok: true, image: { sourceMime: sniffed, ...oriented, renditions } };
}

function isPixelLimit(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

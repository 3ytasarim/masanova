import { isValidStorageKey } from "@/server/media/keys";
import { getImageStorage } from "@/server/media/storage";

/**
 * Yüklenen görsellerin sunumu — GET /media/tenants/<k>/<tür>/<id>/<çıktı>.webp
 *
 * - Anahtar katı biçim denetiminden geçer (yol geçişi "..", ters bölü, mutlak yol imkânsız); dosya sistemi yolu yanıtta yok.
 * - Adresler SÜRÜMLÜDÜR (her yükleme / değiştirme yeni rastgele anahtar) → 1 yıl immutable önbellek güvenli.
 * - Görseller herkese açıktır (QR menüde gösterilir); anahtar 128 bit rastgele olduğundan listelenemez / tahmin edilemez.
 * - Üretimde Nginx bu yolu doğrudan diskten sunabilir (docs/production-checklist.md); bu rota yedek / geliştirme yoludur.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Bulunamadı", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await params;
  const key = segments.join("/");
  if (!isValidStorageKey(key)) return NOT_FOUND();
  const object = await getImageStorage()
    .get(key)
    .catch(() => null);
  if (!object) return NOT_FOUND();
  return new Response(new Uint8Array(object.data), {
    headers: {
      "Content-Type": object.contentType,
      "Content-Length": String(object.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Görsel yanıtı belge olarak açılsa bile betik çalıştıramaz.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}

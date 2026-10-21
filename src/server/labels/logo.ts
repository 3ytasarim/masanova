import "server-only";
import { isPublicAddress } from "@/lib/security/ip";
import { safeFetch } from "@/server/security/safe-fetch";
import type { LogoImage } from "@/server/labels/layout";
import { renditionKey } from "@/server/media/keys";
import { getImageStorage } from "@/server/media/storage";
import { parseRenditions, type MediaAssetRef } from "@/server/media/urls";

/**
 * Etikete gömülecek kiracı logosu — sunucu tarafında indirilir (SSRF korumalı).
 * - safeFetch (src/server/security/safe-fetch.ts): yalnızca https:443, özel / yerel / meta veri adresleri reddedilir,
 *   bağlantı DOĞRULANAN adrese sabitlenir (DNS rebinding kapalı), yönlendirme izlenmez.
 * - 4 sn zaman aşımı, en fazla 2 MB, yalnızca PNG / JPEG (içerik imzasıyla doğrulanır).
 * - Başarılı sonuçlar 10 dk bellekte tutulur (aynı A4 sayfası için onlarca etiket tek indirme).
 */

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 4000;
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; image: LogoImage | null }>();

export type LogoResult = { image: LogoImage | null; failed: boolean };

export async function loadLogo(url: string | null | undefined): Promise<LogoResult> {
  if (!url) return { image: null, failed: false };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return { image: hit.image, failed: hit.image === null };
  const image = await fetchLogo(url).catch(() => null);
  cache.set(url, { at: Date.now(), image });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return { image, failed: image === null };
}

/**
 * Yüklenen logo: PNG çıktısı (pdf-lib WebP gömmez) depodan okunur. Anahtar kayıttan gelir ve sağlayıcıda katı biçim
 * denetiminden geçer; istemci girdisi yok.
 */
export async function loadManagedLogo(asset: MediaAssetRef): Promise<LogoResult> {
  const png = parseRenditions(asset.renditions).find((r) => r.format === "png");
  if (!png || asset.storageProvider !== "local") return { image: null, failed: true };
  const object = await getImageStorage()
    .get(renditionKey(asset.storageKey, png.name, png.format))
    .catch(() => null);
  const image = object ? decodeImage(object.data) : null;
  return { image, failed: image === null };
}

/** Geriye uyumluluk: özel / yerel adres mi (bkz. src/lib/security/ip.ts). */
export function isPrivateAddress(address: string): boolean {
  return !isPublicAddress(address);
}

async function fetchLogo(raw: string): Promise<LogoImage | null> {
  const response = await safeFetch(raw, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, accept: "image/png,image/jpeg" });
  if (response.status !== 200) return null;
  return decodeImage(response.body);
}

/** PNG / JPEG imzası ve piksel boyutu (Content-Type'a güvenilmez). */
export function decodeImage(data: Buffer): LogoImage | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString("ascii", 12, 16) === "IHDR") {
    return { data, mime: "image/png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1]!;
      const length = data.readUInt16BE(offset + 2);
      // SOF0–SOF15 (DHT/JPG/DAC hariç)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { data, mime: "image/jpeg", height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

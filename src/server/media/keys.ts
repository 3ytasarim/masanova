import { createHmac, randomBytes } from "node:crypto";
import type { MediaKindKey } from "@/lib/media/limits";

/**
 * Depolama anahtarları — YALNIZCA sunucuda üretilir; istemciden gelen yol / dosya adı asla kullanılmaz.
 *
 *   tenants/<kiracı-anahtarı>/<tür-klasörü>/<varlık-kimliği>/<çıktı>.<uzantı>
 *
 * - kiracı-anahtarı: HMAC-SHA256(sır, kiracı kimliği) — veritabanı kimliğini açığa çıkarmaz, tahmin edilemez.
 * - varlık-kimliği: 128 bit rastgele (base64url) — çakışma pratikte imkânsız; her yükleme / değiştirme YENİ anahtar.
 * - Orijinal dosya adı, kullanıcı e-postası, yerel yol hiçbir yerde kullanılmaz.
 */
export const KIND_FOLDERS: Record<MediaKindKey, string> = { LOGO: "logo", HERO: "hero", CATEGORY: "categories", PRODUCT: "products" };

const SEGMENT = "[A-Za-z0-9_-]{16,64}";
const FOLDER = "(?:logo|hero|categories|products)";
/** Varlık öneki: tenants/<k>/<klasör>/<id> */
export const ASSET_PREFIX_RE = new RegExp(`^tenants/${SEGMENT}/${FOLDER}/${SEGMENT}$`);
/** Çıktı anahtarı: <önek>/<ad>.<uzantı> */
export const STORAGE_KEY_RE = new RegExp(`^tenants/${SEGMENT}/${FOLDER}/${SEGMENT}/[a-z0-9]{1,16}\\.(?:webp|png|jpg)$`);

export function isValidStorageKey(key: string): boolean {
  return typeof key === "string" && key.length <= 256 && STORAGE_KEY_RE.test(key);
}

export function isValidAssetPrefix(prefix: string): boolean {
  return typeof prefix === "string" && prefix.length <= 200 && ASSET_PREFIX_RE.test(prefix);
}

/** Kiracının depolama klasör anahtarı (deterministik; sır değişirse yeni yüklemeler yeni klasöre gider — eskiler kayıtlı tam anahtarla çalışır). */
export function tenantStorageKey(tenantId: string, secret: string): string {
  return createHmac("sha256", secret).update(`masanova:media-tenant:v1:${tenantId}`).digest("base64url").slice(0, 22);
}

export function newAssetPrefix(tenantId: string, kind: MediaKindKey, secret: string): string {
  return `tenants/${tenantStorageKey(tenantId, secret)}/${KIND_FOLDERS[kind]}/${randomBytes(16).toString("base64url")}`;
}

export function renditionKey(prefix: string, name: string, format: "webp" | "png" | "jpg"): string {
  return `${prefix}/${name}.${format}`;
}

/** Önek bu kiracıya mı ait? (silme / okuma öncesi savunma katmanı; asıl yetki veritabanı satırının tenantId'si.) */
export function prefixBelongsToTenant(prefix: string, tenantId: string, secret: string): boolean {
  return isValidAssetPrefix(prefix) && prefix.startsWith(`tenants/${tenantStorageKey(tenantId, secret)}/`);
}

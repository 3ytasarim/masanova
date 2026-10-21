import "server-only";
import type { Prisma } from "@prisma/client";
import { resolveImageUrl } from "@/lib/storage";
import { renditionKey } from "@/server/media/keys";
import { RENDITIONS } from "@/server/media/process";
import { getImageStorage } from "@/server/media/storage";
import type { MediaKindKey } from "@/lib/media/limits";

/**
 * Görsel adresi çözümü — TEK yer. Öncelik: yüklenen (yönetilen) varlık → harici https adresi (Sprint 3–5 kayıtları,
 * geriye uyumlu) → yok. Adresler sürümlüdür (her yükleme yeni anahtar) — tarayıcı önbelleği bayatlamaz.
 */
export type MediaRendition = { name: string; width: number; height: number; bytes: number; format: "webp" | "png" };
export type MediaAssetRef = { storageProvider: string; storageKey: string; kind: MediaKindKey | string; renditions: Prisma.JsonValue };
export type ResolvedImage = { url: string; srcSet: string | null; width: number | null; height: number | null };

/** Prisma select parçası — referans veren her sorgu bunu kullanır. */
export const MEDIA_ASSET_SELECT = { storageProvider: true, storageKey: true, kind: true, renditions: true } as const;

export function parseRenditions(value: Prisma.JsonValue): MediaRendition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((r) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return [];
    const { name, width, height, bytes, format } = r as Record<string, unknown>;
    if (typeof name !== "string" || typeof width !== "number" || typeof height !== "number" || (format !== "webp" && format !== "png")) return [];
    return [{ name, width, height, bytes: typeof bytes === "number" ? bytes : 0, format }];
  });
}

function providerFor(id: string) {
  // Bugün tek yükleme sağlayıcısı yerel disk; S3 eklendiğinde burada seçilir (kayıt kendi sağlayıcısını taşır).
  return id === "local" ? getImageStorage() : null;
}

export function renditionUrl(asset: MediaAssetRef, name: string): string | null {
  const provider = providerFor(asset.storageProvider);
  const rendition = parseRenditions(asset.renditions).find((r) => r.name === name);
  if (!provider || !rendition) return null;
  return provider.getPublicUrl(renditionKey(asset.storageKey, rendition.name, rendition.format));
}

/** Varsayılan gösterim çıktısı + (ürün için) srcset. */
export function resolveAsset(asset: MediaAssetRef): ResolvedImage | null {
  const kind = asset.kind as MediaKindKey;
  const plan = RENDITIONS[kind];
  const provider = providerFor(asset.storageProvider);
  if (!plan || !provider) return null;
  const renditions = parseRenditions(asset.renditions);
  const display = renditions.find((r) => r.name === plan.display);
  if (!display) return null;
  const webp = renditions.filter((r) => r.format === "webp" && r.name !== "orig");
  const srcSet =
    webp.length > 1
      ? [...new Map(webp.map((r) => [r.width, r])).values()]
          .sort((a, b) => a.width - b.width)
          .map((r) => `${provider.getPublicUrl(renditionKey(asset.storageKey, r.name, r.format))} ${r.width}w`)
          .join(", ")
      : null;
  return { url: provider.getPublicUrl(renditionKey(asset.storageKey, display.name, display.format)), srcSet, width: display.width, height: display.height };
}

/** Yönetilen varlık varsa onu, yoksa harici adresi (doğrulanmış https) döndürür. */
export function resolveImage(asset: MediaAssetRef | null | undefined, externalUrl: string | null | undefined): ResolvedImage | null {
  if (asset) {
    const resolved = resolveAsset(asset);
    if (resolved) return resolved;
  }
  const url = externalUrl ? resolveImageUrl("external", externalUrl) : null;
  return url ? { url, srcSet: null, width: null, height: null } : null;
}

/** Ürün görseli satırı: storageProvider "media" ise varlık, değilse harici anahtar. */
export function resolveProductImage(image: { storageProvider: string; storageKey: string; mediaAsset?: MediaAssetRef | null }): ResolvedImage | null {
  if (image.storageProvider === "media") return image.mediaAsset ? resolveAsset(image.mediaAsset) : null;
  const url = resolveImageUrl(image.storageProvider, image.storageKey);
  return url ? { url, srcSet: null, width: null, height: null } : null;
}

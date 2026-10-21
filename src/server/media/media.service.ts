import "server-only";
import type { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { log } from "@/lib/observability/logger";
import { MAX_PRODUCT_IMAGES as MAX_IMAGES, MEDIA_RULES, type MediaErrorCode } from "@/lib/media/limits";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { buildAuditRow } from "@/server/services/audit.service";
import { newAssetPrefix, prefixBelongsToTenant, renditionKey } from "@/server/media/keys";
import { processImage } from "@/server/media/process";
import { getImageStorage } from "@/server/media/storage";
import { parseRenditions, resolveAsset, type ResolvedImage } from "@/server/media/urls";
import { assertWithinLimit, EntitlementDeniedError } from "@/server/billing/entitlements";

/**
 * Görsel yükleme / değiştirme / kaldırma.
 *
 * Aktör her zaman requireTenantUser({ write: true }) sonucundan kurulur: kiracı OTURUMDAN gelir (istemciden gelen
 * tenantId / yol / dosya adı kullanılmaz), destek modu zaten reddedilmiştir. Hedef (ürün / kategori / görsel) her
 * sorguda tenantId ile süzülür — başka kiracının kaydı "bulunamadı" olur.
 *
 * Sıra (veri kaybı yok):
 *   1. yeni görsel işlenir ve depoya yazılır
 *   2. veritabanı transaction'ı: varlık + referans + denetim kaydı (+ artık referanssız eski varlık satırı)
 *   3. commit SONRASI eski dosyalar silinir
 * Transaction başarısızsa yeni dosyalar silinir (yetim kalmaz) ve eski görsel olduğu gibi kalır. Commit sonrası dosya
 * silme başarısız olursa iş akışı bozulmaz; kalan dosyalar `npm run media:cleanup` ile temizlenir.
 */
export type MediaActor = { userId: string; scope: TenantScope; meta: RequestMeta };

export type UploadTarget =
  | { kind: "PRODUCT"; productId: string; replaceImageId?: string | null; altText?: string | null }
  | { kind: "CATEGORY"; categoryId: string }
  | { kind: "HERO" }
  | { kind: "LOGO" };

export type RemoveTarget = { kind: "PRODUCT"; productId: string; imageId: string } | { kind: "CATEGORY"; categoryId: string } | { kind: "HERO" } | { kind: "LOGO" };

export type MediaResult<T> = { ok: true; data: T } | { ok: false; error: MediaErrorCode };

/** Yalnızca testler: commit'ten hemen önce hata enjekte etmek için (başarısız değiştirmede eski görselin korunduğunu kanıtlar). */
export type MediaHooks = { beforeCommit?: () => void | Promise<void> };

type OldAsset = { id: string; storageKey: string; renditions: Prisma.JsonValue };

const ASSET_FIELDS = { id: true, storageKey: true, renditions: true } as const;

function secret(): string {
  return getServerEnv().QR_TOKEN_SECRET;
}

/** Varlığa kaç kayıt bağlı? (silme yalnızca 0 iken; FK da referanslı varlığın silinmesini engeller.) */
async function referenceCount(tx: Prisma.TransactionClient, tenantId: string, assetId: string): Promise<number> {
  const [images, categories, heroes, logos] = await Promise.all([
    tx.productImage.count({ where: { tenantId, mediaAssetId: assetId } }),
    tx.menuCategory.count({ where: { tenantId, imageAssetId: assetId } }),
    tx.publicMenuSettings.count({ where: { tenantId, heroAssetId: assetId } }),
    tx.tenantSettings.count({ where: { tenantId, logoAssetId: assetId } }),
  ]);
  return images + categories + heroes + logos;
}

/** Referanssız kaldıysa varlık satırını siler ve dosyaları commit sonrası silinmek üzere döndürür. */
async function releaseAsset(tx: Prisma.TransactionClient, tenantId: string, assetId: string | null): Promise<OldAsset | null> {
  if (!assetId) return null;
  if ((await referenceCount(tx, tenantId, assetId)) > 0) return null;
  const asset = await tx.mediaAsset.findFirst({ where: { id: assetId, tenantId }, select: ASSET_FIELDS });
  if (!asset) return null;
  await tx.mediaAsset.deleteMany({ where: { id: asset.id, tenantId } });
  return asset;
}

/** Commit sonrası dosya silme — yalnızca bu kiracının önekindeki anahtarlar; hata iş akışını bozmaz. */
export async function deleteAssetFiles(tenantId: string, asset: OldAsset): Promise<void> {
  if (!prefixBelongsToTenant(asset.storageKey, tenantId, secret())) {
    log.error("media.delete_refused", { reason: "prefix_tenant_mismatch" });
    return;
  }
  const storage = getImageStorage();
  for (const r of parseRenditions(asset.renditions)) {
    await storage.delete(renditionKey(asset.storageKey, r.name, r.format)).catch((error: unknown) => {
      log.warn("media.delete_failed", { error: error instanceof Error ? error.name : "unknown" });
    });
  }
}

async function targetExists(actor: MediaActor, target: UploadTarget): Promise<MediaErrorCode | null> {
  const tenantId = actor.scope.tenantId;
  if (target.kind === "PRODUCT") {
    const product = await prisma.product.findFirst({ where: { id: target.productId, tenantId, archivedAt: null }, select: { id: true } });
    if (!product) return "not_found";
    if (target.replaceImageId) {
      const image = await prisma.productImage.findFirst({ where: { id: target.replaceImageId, productId: target.productId, tenantId }, select: { id: true } });
      return image ? null : "not_found";
    }
    return (await prisma.productImage.count({ where: { productId: target.productId, tenantId } })) >= MAX_IMAGES ? "limit" : null;
  }
  if (target.kind === "CATEGORY") {
    return (await prisma.menuCategory.findFirst({ where: { id: target.categoryId, tenantId }, select: { id: true } })) ? null : "not_found";
  }
  return null;
}

export type UploadOutcome = { assetId: string; image: ResolvedImage | null; replaced: boolean };

export async function uploadMedia(actor: MediaActor, target: UploadTarget, file: Buffer, hooks: MediaHooks = {}): Promise<MediaResult<UploadOutcome>> {
  const tenantId = actor.scope.tenantId;
  if (file.length === 0) return { ok: false, error: "unsupported" };
  if (file.length > MEDIA_RULES[target.kind].maxBytes) return { ok: false, error: "too_large" };
  const missing = await targetExists(actor, target);
  if (missing) return { ok: false, error: missing };

  const processed = await processImage(file, target.kind);
  if (!processed.ok) return { ok: false, error: processed.error };
  const { image } = processed;

  // 1) Depoya yaz (yeni, tahmin edilemez anahtar). Yarıda kalırsa yazılanlar silinir.
  const storage = getImageStorage();
  const prefix = newAssetPrefix(tenantId, target.kind, secret());
  const written: string[] = [];
  try {
    for (const r of image.renditions) {
      const key = renditionKey(prefix, r.name, r.format);
      await storage.put(key, r.data, { contentType: r.contentType });
      written.push(key);
    }
  } catch (error) {
    log.error("media.store_failed", { error: error instanceof Error ? error.name : "unknown" });
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    return { ok: false, error: "failed" };
  }

  const renditions = image.renditions.map(({ name, width, height, bytes, format }) => ({ name, width, height, bytes, format }));
  const totalBytes = renditions.reduce((s, r) => s + r.bytes, 0);
  const main = image.renditions[0]!;

  // 2) Veritabanı: varlık + referans + denetim (+ eski varlık satırı) tek transaction.
  let old: OldAsset | null = null;
  let replaced = false;
  let assetId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await assertWithinLimit(tx, tenantId, "maxMediaBytes", async () => Number((await tx.mediaAsset.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0), totalBytes);
      const asset = await tx.mediaAsset.create({
        data: {
          tenantId,
          kind: target.kind,
          storageProvider: storage.id,
          storageKey: prefix,
          mimeType: main.contentType,
          width: main.width,
          height: main.height,
          sizeBytes: totalBytes,
          renditions,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      let previousAssetId: string | null = null;
      let hadPrevious = false;
      let entity: { entity: "Product" | "MenuCategory" | "PublicMenuSettings" | "Tenant"; entityId: string };

      if (target.kind === "PRODUCT") {
        entity = { entity: "Product", entityId: target.productId };
        if (target.replaceImageId) {
          const current = await tx.productImage.findFirst({ where: { id: target.replaceImageId, productId: target.productId, tenantId } });
          if (!current) throw new MediaTargetGone();
          previousAssetId = current.mediaAssetId;
          hadPrevious = true;
          await tx.productImage.updateMany({
            where: { id: current.id, tenantId },
            data: { storageProvider: "media", storageKey: asset.id, mediaAssetId: asset.id },
          });
        } else {
          const existing = await tx.productImage.findMany({ where: { productId: target.productId, tenantId }, select: { sortOrder: true } });
          if (existing.length >= MAX_IMAGES) throw new MediaLimitReached();
          await tx.productImage.create({
            data: {
              tenantId,
              productId: target.productId,
              storageProvider: "media",
              storageKey: asset.id,
              mediaAssetId: asset.id,
              altText: target.altText?.trim() || null,
              isPrimary: existing.length === 0,
              sortOrder: Math.max(0, ...existing.map((i) => i.sortOrder)) + 10,
            },
          });
        }
      } else if (target.kind === "CATEGORY") {
        entity = { entity: "MenuCategory", entityId: target.categoryId };
        const current = await tx.menuCategory.findFirst({ where: { id: target.categoryId, tenantId }, select: { imageAssetId: true, imageUrl: true } });
        if (!current) throw new MediaTargetGone();
        previousAssetId = current.imageAssetId;
        hadPrevious = !!(current.imageAssetId || current.imageUrl);
        // Yükleme harici adresin YERİNE geçer (kullanıcının açık isteği); eski kayıtlar kendiliğinden dönüştürülmez.
        await tx.menuCategory.updateMany({ where: { id: target.categoryId, tenantId }, data: { imageAssetId: asset.id, imageUrl: null } });
      } else if (target.kind === "HERO") {
        entity = { entity: "PublicMenuSettings", entityId: tenantId };
        const current = await tx.publicMenuSettings.findUnique({ where: { tenantId }, select: { heroAssetId: true, heroImageUrl: true } });
        previousAssetId = current?.heroAssetId ?? null;
        hadPrevious = !!(current?.heroAssetId || current?.heroImageUrl);
        await tx.publicMenuSettings.upsert({
          where: { tenantId },
          update: { heroAssetId: asset.id, heroImageUrl: null },
          create: { tenantId, heroAssetId: asset.id },
        });
      } else {
        entity = { entity: "Tenant", entityId: tenantId };
        const current = await tx.tenantSettings.findUnique({ where: { tenantId }, select: { logoAssetId: true, logoUrl: true } });
        previousAssetId = current?.logoAssetId ?? null;
        hadPrevious = !!(current?.logoAssetId || current?.logoUrl);
        await tx.tenantSettings.upsert({ where: { tenantId }, update: { logoAssetId: asset.id, logoUrl: null }, create: { tenantId, logoAssetId: asset.id } });
      }

      const released = await releaseAsset(tx, tenantId, previousAssetId);
      await tx.auditLog.create({
        data: buildAuditRow(
          {
            action: hadPrevious ? "MEDIA_REPLACED" : "MEDIA_UPLOADED",
            entity: "MediaAsset",
            entityId: asset.id,
            tenantId,
            userId: actor.userId,
            metadata: { kind: target.kind, mime: main.contentType, sourceMime: image.sourceMime, bytes: totalBytes, sourceBytes: file.length, width: image.width, height: image.height, target: entity.entity },
          },
          actor.meta,
        ),
      });
      await hooks.beforeCommit?.();
      return { assetId: asset.id, released, replaced: hadPrevious };
    });
    assetId = result.assetId;
    old = result.released;
    replaced = result.replaced;
  } catch (error) {
    // Transaction geri alındı: eski görsel değişmedi; yeni dosyalar yetim kalmasın.
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    if (error instanceof MediaTargetGone) return { ok: false, error: "not_found" };
    if (error instanceof MediaLimitReached) return { ok: false, error: "limit" };
    if (error instanceof EntitlementDeniedError) return { ok: false, error: "storage_limit" };
    log.error("media.db_failed", { error: error instanceof Error ? error.name : "unknown" });
    return { ok: false, error: "failed" };
  }

  // 3) Commit sonrası eski dosyalar.
  if (old) await deleteAssetFiles(tenantId, old);
  return { ok: true, data: { assetId, image: resolveAsset({ storageProvider: storage.id, storageKey: prefix, kind: target.kind, renditions }), replaced } };
}

export async function removeMedia(actor: MediaActor, target: RemoveTarget): Promise<MediaResult<{ removed: boolean }>> {
  const tenantId = actor.scope.tenantId;
  let old: OldAsset | null = null;
  try {
    const removed = await prisma.$transaction(async (tx) => {
      let previousAssetId: string | null = null;
      let had = false;
      let entityId: string = tenantId;
      if (target.kind === "PRODUCT") {
        entityId = target.productId;
        const product = await tx.product.findFirst({ where: { id: target.productId, tenantId, archivedAt: null }, select: { id: true } });
        const images = product ? await tx.productImage.findMany({ where: { productId: target.productId, tenantId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }) : [];
        const image = images.find((i) => i.id === target.imageId);
        if (!image) throw new MediaTargetGone();
        previousAssetId = image.mediaAssetId;
        had = true;
        await tx.productImage.deleteMany({ where: { id: image.id, tenantId } });
        const next = images.find((i) => i.id !== image.id);
        if (image.isPrimary && next) await tx.productImage.updateMany({ where: { id: next.id, tenantId }, data: { isPrimary: true } });
      } else if (target.kind === "CATEGORY") {
        entityId = target.categoryId;
        const current = await tx.menuCategory.findFirst({ where: { id: target.categoryId, tenantId }, select: { imageAssetId: true, imageUrl: true } });
        if (!current) throw new MediaTargetGone();
        previousAssetId = current.imageAssetId;
        had = !!(current.imageAssetId || current.imageUrl);
        await tx.menuCategory.updateMany({ where: { id: target.categoryId, tenantId }, data: { imageAssetId: null, imageUrl: null } });
      } else if (target.kind === "HERO") {
        const current = await tx.publicMenuSettings.findUnique({ where: { tenantId }, select: { heroAssetId: true, heroImageUrl: true } });
        previousAssetId = current?.heroAssetId ?? null;
        had = !!(current?.heroAssetId || current?.heroImageUrl);
        if (current) await tx.publicMenuSettings.update({ where: { tenantId }, data: { heroAssetId: null, heroImageUrl: null } });
      } else {
        const current = await tx.tenantSettings.findUnique({ where: { tenantId }, select: { logoAssetId: true, logoUrl: true } });
        previousAssetId = current?.logoAssetId ?? null;
        had = !!(current?.logoAssetId || current?.logoUrl);
        if (current) await tx.tenantSettings.update({ where: { tenantId }, data: { logoAssetId: null, logoUrl: null } });
      }
      old = await releaseAsset(tx, tenantId, previousAssetId);
      if (had) {
        await tx.auditLog.create({
          data: buildAuditRow(
            { action: "MEDIA_DELETED", entity: "MediaAsset", entityId: previousAssetId ?? entityId, tenantId, userId: actor.userId, metadata: { kind: target.kind, managed: !!previousAssetId } },
            actor.meta,
          ),
        });
      }
      return had;
    });
    if (old) await deleteAssetFiles(tenantId, old);
    return { ok: true, data: { removed } };
  } catch (error) {
    if (error instanceof MediaTargetGone) return { ok: false, error: "not_found" };
    log.error("media.remove_failed", { error: error instanceof Error ? error.name : "unknown" });
    return { ok: false, error: "failed" };
  }
}

/** Gelecekteki kota için: kiracının yüklediği görsellerin toplam boyutu ve sayısı. */
export async function getTenantMediaUsage(scope: TenantScope): Promise<{ bytes: number; count: number }> {
  const agg = await prisma.mediaAsset.aggregate({ where: { tenantId: scope.tenantId }, _sum: { sizeBytes: true }, _count: { _all: true } });
  return { bytes: agg._sum.sizeBytes ?? 0, count: agg._count._all };
}

class MediaTargetGone extends Error {}
class MediaLimitReached extends Error {}

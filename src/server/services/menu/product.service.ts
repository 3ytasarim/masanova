import "server-only";
import type { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { MAX_PRODUCT_IMAGES, MEDIA_ERROR_MESSAGES } from "@/lib/media/limits";
import { ACTIVE_IMAGE_PROVIDER } from "@/lib/storage";
import { removeMedia } from "@/server/media/media.service";
import type { ProductContentInput, ProductCreateInput, ProductGeneralInput } from "@/lib/validation/menu";
import { type BULK_PRODUCT_OPS } from "@/lib/validation/menu";
import { getMenuLocaleConfig, isUniqueViolation, menuAudit, planTranslations, swapOrders, type MenuActor } from "@/server/services/menu/menu-common";
import { assertWithinLimit, EntitlementDeniedError } from "@/server/billing/entitlements";
import { deniedResult } from "@/server/billing/action-gate";

/**
 * Ürün yönetimi. Kural: her sorgu `tenantId: actor.scope.tenantId` içerir; ilişkili kayıtların (kategori,
 * malzeme, alerjen, etiket) sahipliği yazmadan önce doğrulanır ve bileşik FK'ler veritabanında ikinci
 * savunma hattıdır. Ürün fiziksel olarak silinmez (archivedAt).
 */

const SLUG_TAKEN = { slug: "Bu kısa ad başka bir üründe kullanılıyor." };
const MAX_IMAGES = MAX_PRODUCT_IMAGES;

function activeProduct(actor: MenuActor, productId: string) {
  return prisma.product.findFirst({ where: { id: productId, tenantId: actor.scope.tenantId, archivedAt: null } });
}

async function categoryInScope(actor: MenuActor, categoryId: string) {
  return !!(await prisma.menuCategory.findFirst({ where: { id: categoryId, tenantId: actor.scope.tenantId }, select: { id: true } }));
}

export async function createProduct(actor: MenuActor, input: ProductCreateInput): Promise<ActionResult<{ id: string }>> {
  if (!(await categoryInScope(actor, input.categoryId))) return { ok: false, error: "Kategori bulunamadı.", fieldErrors: { categoryId: "Kategori bulunamadı." } };
  const { currency } = await getMenuLocaleConfig(actor.scope);
  const last = await prisma.product.findFirst({
    where: { tenantId: actor.scope.tenantId, categoryId: input.categoryId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  try {
    const product = await prisma.$transaction(async (tx) => {
      await assertWithinLimit(tx, actor.scope.tenantId, "maxMenuProducts", () => tx.product.count({ where: { tenantId: actor.scope.tenantId, archivedAt: null } }));
      const created = await tx.product.create({
        data: {
          tenantId: actor.scope.tenantId,
          categoryId: input.categoryId,
          name: input.name,
          slug: input.slug,
          shortDescription: input.shortDescription,
          basePriceMinor: input.basePrice,
          currency,
          sortOrder: (last?.sortOrder ?? 0) + 10,
        },
        select: { id: true },
      });
      await tx.auditLog.create({ data: menuAudit(actor, { action: "PRODUCT_CREATED", entity: "Product", entityId: created.id, metadata: { name: input.name, slug: input.slug, basePriceMinor: input.basePrice, currency } }) });
      return created;
    });
    return { ok: true, data: product, message: "Ürün oluşturuldu." };
  } catch (error) {
    if (error instanceof EntitlementDeniedError) return deniedResult(error);
    if (isUniqueViolation(error)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
    throw error;
  }
}

export async function updateProductGeneral(actor: MenuActor, productId: string, input: ProductGeneralInput): Promise<ActionResult> {
  const existing = await activeProduct(actor, productId);
  if (!existing) return { ok: false, error: "Ürün bulunamadı." };
  if (!(await categoryInScope(actor, input.categoryId))) return { ok: false, error: "Kategori bulunamadı.", fieldErrors: { categoryId: "Kategori bulunamadı." } };

  const categoryChanged = existing.categoryId !== input.categoryId;
  try {
    await prisma.$transaction(async (tx) => {
      const last = categoryChanged
        ? await tx.product.findFirst({ where: { tenantId: actor.scope.tenantId, categoryId: input.categoryId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
        : null;
      await tx.product.updateMany({
        where: { id: productId, tenantId: actor.scope.tenantId },
        data: {
          name: input.name,
          slug: input.slug,
          categoryId: input.categoryId,
          shortDescription: input.shortDescription,
          description: input.description,
          sku: input.sku,
          preparationMinutes: input.preparationMinutes,
          featured: input.featured,
          active: input.active,
          soldOut: input.soldOut,
          ...(categoryChanged ? { sortOrder: (last?.sortOrder ?? 0) + 10 } : {}),
        },
      });
      const rows: Prisma.AuditLogCreateManyInput[] = [
        menuAudit(actor, { action: "PRODUCT_UPDATED", entity: "Product", entityId: productId, metadata: { section: "general", name: input.name, slug: input.slug, categoryId: input.categoryId } }),
      ];
      if (existing.active !== input.active) rows.push(menuAudit(actor, { action: "PRODUCT_STATUS_CHANGED", entity: "Product", entityId: productId, metadata: { active: input.active } }));
      if (existing.soldOut !== input.soldOut) rows.push(menuAudit(actor, { action: "PRODUCT_SOLD_OUT_CHANGED", entity: "Product", entityId: productId, metadata: { soldOut: input.soldOut } }));
      await tx.auditLog.createMany({ data: rows });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
    throw error;
  }
  return { ok: true, data: undefined, message: "Ürün kaydedildi." };
}

export async function updateProductPricing(actor: MenuActor, productId: string, input: { basePrice: number; currency: string }): Promise<ActionResult> {
  const existing = await activeProduct(actor, productId);
  if (!existing) return { ok: false, error: "Ürün bulunamadı." };
  await prisma.$transaction([
    prisma.product.updateMany({ where: { id: productId, tenantId: actor.scope.tenantId }, data: { basePriceMinor: input.basePrice, currency: input.currency } }),
    prisma.auditLog.create({
      data: menuAudit(actor, {
        action: "PRODUCT_UPDATED",
        entity: "Product",
        entityId: productId,
        metadata: { section: "pricing", from: existing.basePriceMinor, to: input.basePrice, currency: input.currency },
      }),
    }),
  ]);
  return { ok: true, data: undefined, message: "Fiyat kaydedildi." };
}

/**
 * Malzeme / alerjen / diyet etiketi / besin değeri. Kimliklerin sahipliği önce doğrulanır:
 * malzeme → yalnızca bu kiracının; alerjen/etiket → platform standardı (tenantId null) veya bu kiracının.
 */
export async function updateProductContent(actor: MenuActor, productId: string, input: ProductContentInput): Promise<ActionResult> {
  if (!(await activeProduct(actor, productId))) return { ok: false, error: "Ürün bulunamadı." };
  const tenantId = actor.scope.tenantId;
  const [ingredients, allergens, tags] = await Promise.all([
    prisma.ingredient.count({ where: { id: { in: input.ingredientIds }, tenantId } }),
    prisma.allergen.count({ where: { id: { in: input.allergenIds }, OR: [{ tenantId: null }, { tenantId }] } }),
    prisma.dietaryTag.count({ where: { id: { in: input.dietaryTagIds }, OR: [{ tenantId: null }, { tenantId }] } }),
  ]);
  if (ingredients !== new Set(input.ingredientIds).size) return { ok: false, error: "Geçersiz malzeme seçimi." };
  if (allergens !== new Set(input.allergenIds).size) return { ok: false, error: "Geçersiz alerjen seçimi." };
  if (tags !== new Set(input.dietaryTagIds).size) return { ok: false, error: "Geçersiz etiket seçimi." };

  await replaceProductContentTx(actor, productId, input);
  return { ok: true, data: undefined, message: "İçerik ve alerjen bilgisi kaydedildi." };
}

/**
 * İçerik ilişkilerini tek transaction'da değiştirir (sil + ekle). Bir ekleme başarısız olursa silme de
 * geri alınır — ürün asla "alerjensiz" ara duruma düşmez. (Testler geri almayı doğrudan doğrular.)
 */
export async function replaceProductContentTx(actor: MenuActor, productId: string, input: ProductContentInput): Promise<void> {
  const tenantId = actor.scope.tenantId;
  const unique = (ids: string[]) => [...new Set(ids)];
  await prisma.$transaction(async (tx) => {
    await tx.productIngredient.deleteMany({ where: { productId, tenantId } });
    await tx.productAllergen.deleteMany({ where: { productId, tenantId } });
    await tx.productDietaryTag.deleteMany({ where: { productId, tenantId } });
    if (input.ingredientIds.length) {
      await tx.productIngredient.createMany({ data: unique(input.ingredientIds).map((ingredientId, i) => ({ tenantId, productId, ingredientId, sortOrder: (i + 1) * 10 })) });
    }
    if (input.allergenIds.length) await tx.productAllergen.createMany({ data: unique(input.allergenIds).map((allergenId) => ({ tenantId, productId, allergenId })) });
    if (input.dietaryTagIds.length) await tx.productDietaryTag.createMany({ data: unique(input.dietaryTagIds).map((dietaryTagId) => ({ tenantId, productId, dietaryTagId })) });
    const updated = await tx.product.updateMany({
      where: { id: productId, tenantId, archivedAt: null },
      data: {
        calories: input.calories,
        proteinGrams: input.proteinGrams,
        carbohydrateGrams: input.carbohydrateGrams,
        fatGrams: input.fatGrams,
        allergensConfirmedAt: input.allergensConfirmed || input.allergenIds.length > 0 ? new Date() : null,
      },
    });
    if (updated.count !== 1) throw new Error("product_not_found");
    await tx.auditLog.create({
      data: menuAudit(actor, {
        action: "PRODUCT_UPDATED",
        entity: "Product",
        entityId: productId,
        metadata: { section: "content", ingredients: input.ingredientIds.length, allergens: input.allergenIds, dietaryTags: input.dietaryTagIds },
      }),
    });
  });
}

export async function saveProductTranslations(
  actor: MenuActor,
  productId: string,
  input: Partial<Record<string, Record<"name" | "shortDescription" | "description", string | null>>>,
): Promise<ActionResult> {
  if (!(await activeProduct(actor, productId))) return { ok: false, error: "Ürün bulunamadı." };
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  const plan = planTranslations(input, translatable, "name");
  const tenantId = actor.scope.tenantId;
  await prisma.$transaction(async (tx) => {
    if (plan.deletes.length) await tx.productTranslation.deleteMany({ where: { productId, tenantId, locale: { in: plan.deletes } } });
    for (const t of plan.upserts) {
      const data = { name: t.values.name!, shortDescription: t.values.shortDescription, description: t.values.description };
      await tx.productTranslation.upsert({
        where: { productId_locale: { productId, locale: t.locale } },
        update: data,
        create: { ...data, tenantId, productId, locale: t.locale },
      });
    }
    await tx.auditLog.create({
      data: menuAudit(actor, { action: "PRODUCT_UPDATED", entity: "Product", entityId: productId, metadata: { section: "translations", saved: plan.upserts.map((t) => t.locale), removed: plan.deletes } }),
    });
  });
  return { ok: true, data: undefined, message: "Çeviriler kaydedildi." };
}

// ─── Hızlı işaretler / arşiv / toplu ───────────────────────────────────────

export async function setProductFlag(actor: MenuActor, productId: string, field: "active" | "soldOut" | "featured", value: boolean): Promise<ActionResult> {
  const result = await prisma.product.updateMany({ where: { id: productId, tenantId: actor.scope.tenantId, archivedAt: null }, data: { [field]: value } });
  if (result.count !== 1) return { ok: false, error: "Ürün bulunamadı." };
  const action = field === "active" ? "PRODUCT_STATUS_CHANGED" : field === "soldOut" ? "PRODUCT_SOLD_OUT_CHANGED" : "PRODUCT_UPDATED";
  await prisma.auditLog.create({ data: menuAudit(actor, { action, entity: "Product", entityId: productId, metadata: { [field]: value } }) });
  const messages = {
    active: value ? "Ürün aktif." : "Ürün pasif.",
    soldOut: value ? "Ürün tükendi olarak işaretlendi." : "Ürün yeniden satışta.",
    featured: value ? "Ürün öne çıkarıldı." : "Öne çıkarma kaldırıldı.",
  };
  return { ok: true, data: undefined, message: messages[field] };
}

/** Arşiv: ürün listelerden ve gelecekteki menüden kalkar, kayıt ve ilişkileri korunur (geçmiş siparişler için). */
export async function setProductArchived(actor: MenuActor, productId: string, archived: boolean): Promise<ActionResult> {
  const result = await prisma.product.updateMany({
    where: { id: productId, tenantId: actor.scope.tenantId, archivedAt: archived ? null : { not: null } },
    data: { archivedAt: archived ? new Date() : null, ...(archived ? { featured: false } : {}) },
  });
  if (result.count !== 1) return { ok: false, error: "Ürün bulunamadı." };
  await prisma.auditLog.create({ data: menuAudit(actor, { action: archived ? "PRODUCT_ARCHIVED" : "PRODUCT_RESTORED", entity: "Product", entityId: productId }) });
  return { ok: true, data: undefined, message: archived ? "Ürün arşivlendi." : "Ürün arşivden çıkarıldı." };
}

const BULK_DATA: Record<(typeof BULK_PRODUCT_OPS)[number], Prisma.ProductUpdateManyMutationInput> = {
  activate: { active: true },
  deactivate: { active: false },
  sold_out: { soldOut: true },
  clear_sold_out: { soldOut: false },
  feature: { featured: true },
  unfeature: { featured: false },
};

/** Toplu işlem: yalnızca bu kiracının arşivlenmemiş ürünlerine uygulanır; yabancı id'ler sessizce eşleşmez. */
export async function bulkUpdateProducts(actor: MenuActor, op: (typeof BULK_PRODUCT_OPS)[number], ids: string[]): Promise<ActionResult<{ count: number }>> {
  const unique = [...new Set(ids)];
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.updateMany({ where: { id: { in: unique }, tenantId: actor.scope.tenantId, archivedAt: null }, data: BULK_DATA[op] });
    await tx.auditLog.create({ data: menuAudit(actor, { action: "PRODUCT_BULK_UPDATED", entity: "Product", metadata: { op, requested: unique.length, updated: updated.count, ids: unique.slice(0, 100) } }) });
    return updated;
  });
  return { ok: true, data: { count: result.count }, message: `${result.count} ürün güncellendi.` };
}

/** Kategori içindeki menü sırası (komşuyla takas). */
export async function moveProduct(actor: MenuActor, productId: string, direction: "up" | "down"): Promise<ActionResult> {
  const product = await activeProduct(actor, productId);
  if (!product) return { ok: false, error: "Ürün bulunamadı." };
  const siblings = await prisma.product.findMany({
    where: { tenantId: actor.scope.tenantId, categoryId: product.categoryId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const orders = swapOrders(siblings, productId, direction);
  if (!orders) return { ok: true, data: undefined };
  await prisma.$transaction(orders.map((o) => prisma.product.updateMany({ where: { id: o.id, tenantId: actor.scope.tenantId }, data: { sortOrder: o.sortOrder } })));
  return { ok: true, data: undefined };
}

// ─── Görseller ──────────────────────────────────────────────────────────────

export async function addProductImage(actor: MenuActor, productId: string, input: { url: string; altText: string | null }): Promise<ActionResult> {
  if (!(await activeProduct(actor, productId))) return { ok: false, error: "Ürün bulunamadı." };
  const tenantId = actor.scope.tenantId;
  const existing = await prisma.productImage.findMany({ where: { productId, tenantId }, select: { sortOrder: true } });
  if (existing.length >= MAX_IMAGES) return { ok: false, error: `Bir ürüne en fazla ${MAX_IMAGES} görsel eklenebilir.` };
  await prisma.$transaction([
    prisma.productImage.create({
      data: {
        tenantId,
        productId,
        storageProvider: ACTIVE_IMAGE_PROVIDER,
        storageKey: input.url,
        altText: input.altText,
        isPrimary: existing.length === 0,
        sortOrder: Math.max(0, ...existing.map((i) => i.sortOrder)) + 10,
      },
    }),
    prisma.auditLog.create({ data: menuAudit(actor, { action: "PRODUCT_UPDATED", entity: "Product", entityId: productId, metadata: { section: "images", added: 1 } }) }),
  ]);
  return { ok: true, data: undefined, message: "Görsel eklendi." };
}

export async function updateProductImage(
  actor: MenuActor,
  productId: string,
  imageId: string,
  op: { kind: "primary" } | { kind: "remove" } | { kind: "move"; direction: "up" | "down" } | { kind: "alt"; altText: string | null },
): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const images = await prisma.productImage.findMany({ where: { productId, tenantId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const image = images.find((i) => i.id === imageId);
  if (!image || !(await activeProduct(actor, productId))) return { ok: false, error: "Görsel bulunamadı." };

  if (op.kind === "primary") {
    await prisma.$transaction([
      prisma.productImage.updateMany({ where: { productId, tenantId }, data: { isPrimary: false } }),
      prisma.productImage.updateMany({ where: { id: imageId, productId, tenantId }, data: { isPrimary: true } }),
    ]);
    return { ok: true, data: undefined, message: "Ana görsel güncellendi." };
  }
  if (op.kind === "alt") {
    await prisma.productImage.updateMany({ where: { id: imageId, productId, tenantId }, data: { altText: op.altText } });
    return { ok: true, data: undefined, message: "Alternatif metin kaydedildi." };
  }
  if (op.kind === "move") {
    const orders = swapOrders(images, imageId, op.direction);
    if (orders) await prisma.$transaction(orders.map((o) => prisma.productImage.updateMany({ where: { id: o.id, productId, tenantId }, data: { sortOrder: o.sortOrder } })));
    return { ok: true, data: undefined };
  }
  // Yüklenen görsel: referans + (artık kullanılmıyorsa) varlık ve dosyaları birlikte kaldırılır.
  if (image.mediaAssetId) {
    const removed = await removeMedia(actor, { kind: "PRODUCT", productId, imageId });
    return removed.ok ? { ok: true, data: undefined, message: "Görsel kaldırıldı." } : { ok: false, error: MEDIA_ERROR_MESSAGES[removed.error] };
  }
  // Harici görsel referansı silinebilir (görselin kendisi harici); ana görsel silinirse sıradaki ana olur.
  const next = images.find((i) => i.id !== imageId);
  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { id: imageId, productId, tenantId } }),
    ...(image.isPrimary && next ? [prisma.productImage.updateMany({ where: { id: next.id, productId, tenantId }, data: { isPrimary: true } })] : []),
    prisma.auditLog.create({ data: menuAudit(actor, { action: "PRODUCT_UPDATED", entity: "Product", entityId: productId, metadata: { section: "images", removed: 1 } }) }),
  ]);
  return { ok: true, data: undefined, message: "Görsel kaldırıldı." };
}

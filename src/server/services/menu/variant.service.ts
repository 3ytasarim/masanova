import "server-only";
import type { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import type { VariantInput } from "@/lib/validation/menu";
import { getMenuLocaleConfig, isUniqueViolation, menuAudit, planTranslations, swapOrders, type MenuActor } from "@/server/services/menu/menu-common";

/**
 * Varyantlar (Tek / Çift, Küçük / Orta / Büyük). Kural: arşivlenmemiş varyant varsa TAM OLARAK BİRİ
 * varsayılandır. Her mutasyon aynı transaction'da `normalizeDefault` ile bu değişmezi korur.
 * Varyant fiziksel silinmez (archivedAt) — gelecekteki sipariş satırları ona referans verebilir.
 */

const NAME_TAKEN = { name: "Bu üründe aynı adlı bir varyant var." };

async function normalizeDefault(tx: Prisma.TransactionClient, tenantId: string, productId: string, preferredId?: string) {
  const variants = await tx.productVariant.findMany({
    where: { productId, tenantId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, isDefault: true, active: true },
  });
  if (variants.length === 0) return;
  const chosen =
    variants.find((v) => v.id === preferredId) ??
    variants.find((v) => v.isDefault) ??
    variants.find((v) => v.active) ??
    variants[0]!;
  await tx.productVariant.updateMany({ where: { productId, tenantId, id: { not: chosen.id } }, data: { isDefault: false } });
  await tx.productVariant.updateMany({ where: { id: chosen.id, productId, tenantId }, data: { isDefault: true } });
}

async function productInScope(actor: MenuActor, productId: string) {
  return !!(await prisma.product.findFirst({ where: { id: productId, tenantId: actor.scope.tenantId, archivedAt: null }, select: { id: true } }));
}

async function saveVariantTranslations(tx: Prisma.TransactionClient, actor: MenuActor, variantId: string, input: VariantInput, translatable: string[]) {
  const plan = planTranslations(input.translations, translatable, "name");
  const tenantId = actor.scope.tenantId;
  if (plan.deletes.length) await tx.productVariantTranslation.deleteMany({ where: { variantId, tenantId, locale: { in: plan.deletes } } });
  for (const t of plan.upserts) {
    await tx.productVariantTranslation.upsert({
      where: { variantId_locale: { variantId, locale: t.locale } },
      update: { name: t.values.name! },
      create: { tenantId, variantId, locale: t.locale, name: t.values.name! },
    });
  }
}

export async function createVariant(actor: MenuActor, productId: string, input: VariantInput): Promise<ActionResult<{ id: string }>> {
  if (!(await productInScope(actor, productId))) return { ok: false, error: "Ürün bulunamadı." };
  const tenantId = actor.scope.tenantId;
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  try {
    const variant = await prisma.$transaction(async (tx) => {
      const last = await tx.productVariant.findFirst({ where: { productId, tenantId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      const created = await tx.productVariant.create({
        data: { tenantId, productId, name: input.name, sku: input.sku, priceMinor: input.price, active: input.active, isDefault: false, sortOrder: (last?.sortOrder ?? 0) + 10 },
        select: { id: true },
      });
      await saveVariantTranslations(tx, actor, created.id, input, translatable);
      await normalizeDefault(tx, tenantId, productId, input.isDefault ? created.id : undefined);
      await tx.auditLog.create({ data: menuAudit(actor, { action: "VARIANT_CREATED", entity: "ProductVariant", entityId: created.id, metadata: { productId, name: input.name, priceMinor: input.price } }) });
      return created;
    });
    return { ok: true, data: variant, message: "Varyant eklendi." };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Varyant adı kullanımda.", fieldErrors: NAME_TAKEN };
    throw error;
  }
}

export async function updateVariant(actor: MenuActor, productId: string, variantId: string, input: VariantInput): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  // Varyant hem bu kiracıya hem URL'deki ürüne ait olmalı (başka ürünün varyantı bu üründen düzenlenemez).
  const existing = await prisma.productVariant.findFirst({ where: { id: variantId, productId, tenantId, archivedAt: null } });
  if (!existing || !(await productInScope(actor, productId))) return { ok: false, error: "Varyant bulunamadı." };
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.updateMany({
        where: { id: variantId, productId, tenantId },
        data: { name: input.name, sku: input.sku, priceMinor: input.price, active: input.active, ...(input.isDefault ? {} : { isDefault: false }) },
      });
      await saveVariantTranslations(tx, actor, variantId, input, translatable);
      await normalizeDefault(tx, tenantId, productId, input.isDefault ? variantId : undefined);
      await tx.auditLog.create({
        data: menuAudit(actor, { action: "VARIANT_UPDATED", entity: "ProductVariant", entityId: variantId, metadata: { productId, name: input.name, priceMinor: input.price, active: input.active } }),
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Varyant adı kullanımda.", fieldErrors: NAME_TAKEN };
    throw error;
  }
  return { ok: true, data: undefined, message: "Varyant kaydedildi." };
}

export async function archiveVariant(actor: MenuActor, productId: string, variantId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const done = await prisma.$transaction(async (tx) => {
    const result = await tx.productVariant.updateMany({ where: { id: variantId, productId, tenantId, archivedAt: null }, data: { archivedAt: new Date(), isDefault: false } });
    if (result.count !== 1) return false;
    await normalizeDefault(tx, tenantId, productId);
    await tx.auditLog.create({ data: menuAudit(actor, { action: "VARIANT_UPDATED", entity: "ProductVariant", entityId: variantId, metadata: { productId, archived: true } }) });
    return true;
  });
  return done ? { ok: true, data: undefined, message: "Varyant arşivlendi." } : { ok: false, error: "Varyant bulunamadı." };
}

export async function moveVariant(actor: MenuActor, productId: string, variantId: string, direction: "up" | "down"): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const variants = await prisma.productVariant.findMany({ where: { productId, tenantId, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
  if (!variants.some((v) => v.id === variantId)) return { ok: false, error: "Varyant bulunamadı." };
  const orders = swapOrders(variants, variantId, direction);
  if (orders) await prisma.$transaction(orders.map((o) => prisma.productVariant.updateMany({ where: { id: o.id, productId, tenantId }, data: { sortOrder: o.sortOrder } })));
  return { ok: true, data: undefined };
}

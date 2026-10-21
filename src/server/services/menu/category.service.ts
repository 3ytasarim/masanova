import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { HIERARCHY_MESSAGES, validateCategoryParent } from "@/lib/menu/rules";
import type { CategoryInput } from "@/lib/validation/menu";
import { getMenuLocaleConfig, isUniqueViolation, menuAudit, planTranslations, swapOrders, type MenuActor } from "@/server/services/menu/menu-common";

/**
 * Kategori yönetimi. Hiyerarşi en fazla bir seviye; üst kategori yalnızca aynı kiracının kategorileri
 * arasından seçilebilir (başka kiracının kategorisi `nodes` listesinde olmadığından reddedilir; ayrıca
 * bileşik FK yoktur çünkü parentId isteğe bağlıdır — bu kural yalnızca burada uygulanır ve testlidir).
 */

const SLUG_TAKEN = { slug: "Bu kısa ad başka bir kategoride kullanılıyor." };

async function tenantNodes(actor: MenuActor) {
  return prisma.menuCategory.findMany({ where: { tenantId: actor.scope.tenantId }, select: { id: true, parentId: true } });
}

export async function createCategory(actor: MenuActor, input: CategoryInput): Promise<ActionResult<{ id: string }>> {
  const nodes = await tenantNodes(actor);
  const hierarchyError = validateCategoryParent(null, input.parentId, nodes);
  if (hierarchyError) return { ok: false, error: HIERARCHY_MESSAGES[hierarchyError], fieldErrors: { parentId: HIERARCHY_MESSAGES[hierarchyError] } };
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  const plan = planTranslations(input.translations, translatable, "name");
  const last = await prisma.menuCategory.findFirst({
    where: { tenantId: actor.scope.tenantId, parentId: input.parentId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  try {
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.menuCategory.create({
        data: {
          tenantId: actor.scope.tenantId,
          parentId: input.parentId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          imageUrl: input.imageUrl,
          active: input.active,
          featured: input.featured,
          sortOrder: (last?.sortOrder ?? 0) + 10,
        },
        select: { id: true },
      });
      if (plan.upserts.length) {
        await tx.menuCategoryTranslation.createMany({
          data: plan.upserts.map((t) => ({ tenantId: actor.scope.tenantId, categoryId: created.id, locale: t.locale, name: t.values.name!, description: t.values.description })),
        });
      }
      await tx.auditLog.create({ data: menuAudit(actor, { action: "CATEGORY_CREATED", entity: "MenuCategory", entityId: created.id, metadata: { name: input.name, slug: input.slug, parentId: input.parentId } }) });
      return created;
    });
    return { ok: true, data: category, message: "Kategori oluşturuldu." };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
    throw error;
  }
}

export async function updateCategory(actor: MenuActor, categoryId: string, input: CategoryInput): Promise<ActionResult> {
  const existing = await prisma.menuCategory.findFirst({ where: { id: categoryId, tenantId: actor.scope.tenantId } });
  if (!existing) return { ok: false, error: "Kategori bulunamadı." };
  const hierarchyError = validateCategoryParent(categoryId, input.parentId, await tenantNodes(actor));
  if (hierarchyError) return { ok: false, error: HIERARCHY_MESSAGES[hierarchyError], fieldErrors: { parentId: HIERARCHY_MESSAGES[hierarchyError] } };
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  const plan = planTranslations(input.translations, translatable, "name");

  try {
    await prisma.$transaction(async (tx) => {
      const parentChanged = existing.parentId !== input.parentId;
      const last = parentChanged
        ? await tx.menuCategory.findFirst({ where: { tenantId: actor.scope.tenantId, parentId: input.parentId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
        : null;
      const updated = await tx.menuCategory.updateMany({
        where: { id: categoryId, tenantId: actor.scope.tenantId },
        data: {
          parentId: input.parentId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          imageUrl: input.imageUrl,
          active: input.active,
          featured: input.featured,
          ...(parentChanged ? { sortOrder: (last?.sortOrder ?? 0) + 10 } : {}),
        },
      });
      if (updated.count !== 1) throw new Error("category_not_found");
      if (plan.deletes.length) {
        await tx.menuCategoryTranslation.deleteMany({ where: { categoryId, tenantId: actor.scope.tenantId, locale: { in: plan.deletes } } });
      }
      for (const t of plan.upserts) {
        await tx.menuCategoryTranslation.upsert({
          where: { categoryId_locale: { categoryId, locale: t.locale } },
          update: { name: t.values.name!, description: t.values.description },
          create: { tenantId: actor.scope.tenantId, categoryId, locale: t.locale, name: t.values.name!, description: t.values.description },
        });
      }
      await tx.auditLog.create({ data: menuAudit(actor, { action: "CATEGORY_UPDATED", entity: "MenuCategory", entityId: categoryId, metadata: { name: input.name, slug: input.slug, parentId: input.parentId, translations: plan.upserts.map((t) => t.locale) } }) });
      if (existing.active !== input.active) {
        await tx.auditLog.create({ data: menuAudit(actor, { action: "CATEGORY_STATUS_CHANGED", entity: "MenuCategory", entityId: categoryId, metadata: { active: input.active } }) });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
    throw error;
  }
  return { ok: true, data: undefined, message: "Kategori kaydedildi." };
}

export async function setCategoryFlag(actor: MenuActor, categoryId: string, field: "active" | "featured", value: boolean): Promise<ActionResult> {
  const result = await prisma.menuCategory.updateMany({ where: { id: categoryId, tenantId: actor.scope.tenantId }, data: { [field]: value } });
  if (result.count !== 1) return { ok: false, error: "Kategori bulunamadı." };
  await prisma.auditLog.create({
    data: menuAudit(actor, { action: field === "active" ? "CATEGORY_STATUS_CHANGED" : "CATEGORY_UPDATED", entity: "MenuCategory", entityId: categoryId, metadata: { [field]: value } }),
  });
  const label = field === "active" ? (value ? "Kategori aktif." : "Kategori pasif.") : value ? "Kategori öne çıkarıldı." : "Öne çıkarma kaldırıldı.";
  return { ok: true, data: undefined, message: label };
}

/** Aynı üst kategori altındaki komşuyla yer değiştirir (denetim kaydı üretmez — önemsiz sıralama). */
export async function moveCategory(actor: MenuActor, categoryId: string, direction: "up" | "down"): Promise<ActionResult> {
  const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, tenantId: actor.scope.tenantId }, select: { parentId: true } });
  if (!category) return { ok: false, error: "Kategori bulunamadı." };
  const siblings = await prisma.menuCategory.findMany({
    where: { tenantId: actor.scope.tenantId, parentId: category.parentId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const orders = swapOrders(siblings, categoryId, direction);
  if (!orders) return { ok: true, data: undefined };
  await prisma.$transaction(
    orders.map((o) => prisma.menuCategory.updateMany({ where: { id: o.id, tenantId: actor.scope.tenantId }, data: { sortOrder: o.sortOrder } })),
  );
  return { ok: true, data: undefined };
}

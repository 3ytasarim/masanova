import "server-only";
import type { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import type { ModifierGroupInput, ModifierInput } from "@/lib/validation/menu";
import { getMenuLocaleConfig, isUniqueViolation, menuAudit, planTranslations, swapOrders, type MenuActor } from "@/server/services/menu/menu-common";

/**
 * Ekstra grupları (yeniden kullanılabilir) ve ekstralar. Ürüne bağlama ProductModifierGroup ile yapılır;
 * ürün ve grup aynı kiracıya ait olmalıdır (servis doğrular + bileşik FK veritabanında zorlar).
 */

async function groupInScope(actor: MenuActor, groupId: string) {
  return prisma.modifierGroup.findFirst({ where: { id: groupId, tenantId: actor.scope.tenantId, archivedAt: null } });
}

async function saveGroupTranslations(tx: Prisma.TransactionClient, actor: MenuActor, groupId: string, translations: ModifierGroupInput["translations"], translatable: string[]) {
  const plan = planTranslations(translations, translatable, "name");
  const tenantId = actor.scope.tenantId;
  if (plan.deletes.length) await tx.modifierGroupTranslation.deleteMany({ where: { modifierGroupId: groupId, tenantId, locale: { in: plan.deletes } } });
  for (const t of plan.upserts) {
    await tx.modifierGroupTranslation.upsert({
      where: { modifierGroupId_locale: { modifierGroupId: groupId, locale: t.locale } },
      update: { name: t.values.name! },
      create: { tenantId, modifierGroupId: groupId, locale: t.locale, name: t.values.name! },
    });
  }
}

async function saveModifierTranslations(tx: Prisma.TransactionClient, actor: MenuActor, modifierId: string, translations: ModifierInput["translations"], translatable: string[]) {
  const plan = planTranslations(translations, translatable, "name");
  const tenantId = actor.scope.tenantId;
  if (plan.deletes.length) await tx.modifierTranslation.deleteMany({ where: { modifierId, tenantId, locale: { in: plan.deletes } } });
  for (const t of plan.upserts) {
    await tx.modifierTranslation.upsert({
      where: { modifierId_locale: { modifierId, locale: t.locale } },
      update: { name: t.values.name! },
      create: { tenantId, modifierId, locale: t.locale, name: t.values.name! },
    });
  }
}

const GROUP_NAME_TAKEN = { name: "Bu adla bir ekstra grubu zaten var." };
const MODIFIER_NAME_TAKEN = { name: "Bu grupta aynı adlı bir ekstra var." };

export async function createModifierGroup(actor: MenuActor, input: ModifierGroupInput): Promise<ActionResult<{ id: string }>> {
  const tenantId = actor.scope.tenantId;
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  try {
    const group = await prisma.$transaction(async (tx) => {
      const last = await tx.modifierGroup.findFirst({ where: { tenantId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      const created = await tx.modifierGroup.create({
        data: { tenantId, name: input.name, required: input.required, minSelect: input.minSelect, maxSelect: input.maxSelect, active: input.active, sortOrder: (last?.sortOrder ?? 0) + 10 },
        select: { id: true },
      });
      await saveGroupTranslations(tx, actor, created.id, input.translations, translatable);
      await tx.auditLog.create({
        data: menuAudit(actor, { action: "MODIFIER_GROUP_CREATED", entity: "ModifierGroup", entityId: created.id, metadata: { name: input.name, required: input.required, minSelect: input.minSelect, maxSelect: input.maxSelect } }),
      });
      return created;
    });
    return { ok: true, data: group, message: "Ekstra grubu oluşturuldu." };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Grup adı kullanımda.", fieldErrors: GROUP_NAME_TAKEN };
    throw error;
  }
}

export async function updateModifierGroup(actor: MenuActor, groupId: string, input: ModifierGroupInput): Promise<ActionResult> {
  if (!(await groupInScope(actor, groupId))) return { ok: false, error: "Ekstra grubu bulunamadı." };
  const tenantId = actor.scope.tenantId;
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.modifierGroup.updateMany({
        where: { id: groupId, tenantId },
        data: { name: input.name, required: input.required, minSelect: input.minSelect, maxSelect: input.maxSelect, active: input.active },
      });
      await saveGroupTranslations(tx, actor, groupId, input.translations, translatable);
      await tx.auditLog.create({
        data: menuAudit(actor, { action: "MODIFIER_GROUP_UPDATED", entity: "ModifierGroup", entityId: groupId, metadata: { name: input.name, required: input.required, minSelect: input.minSelect, maxSelect: input.maxSelect, active: input.active } }),
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Grup adı kullanımda.", fieldErrors: GROUP_NAME_TAKEN };
    throw error;
  }
  return { ok: true, data: undefined, message: "Ekstra grubu kaydedildi." };
}

export async function archiveModifierGroup(actor: MenuActor, groupId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const result = await prisma.modifierGroup.updateMany({ where: { id: groupId, tenantId, archivedAt: null }, data: { archivedAt: new Date(), active: false } });
  if (result.count !== 1) return { ok: false, error: "Ekstra grubu bulunamadı." };
  await prisma.auditLog.create({ data: menuAudit(actor, { action: "MODIFIER_GROUP_UPDATED", entity: "ModifierGroup", entityId: groupId, metadata: { archived: true } }) });
  return { ok: true, data: undefined, message: "Ekstra grubu arşivlendi." };
}

export async function createModifier(actor: MenuActor, groupId: string, input: ModifierInput): Promise<ActionResult<{ id: string }>> {
  if (!(await groupInScope(actor, groupId))) return { ok: false, error: "Ekstra grubu bulunamadı." };
  const tenantId = actor.scope.tenantId;
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  try {
    const modifier = await prisma.$transaction(async (tx) => {
      const last = await tx.modifier.findFirst({ where: { modifierGroupId: groupId, tenantId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      const created = await tx.modifier.create({
        data: { tenantId, modifierGroupId: groupId, name: input.name, priceDeltaMinor: input.priceDelta, active: input.active, sortOrder: (last?.sortOrder ?? 0) + 10 },
        select: { id: true },
      });
      await saveModifierTranslations(tx, actor, created.id, input.translations, translatable);
      await tx.auditLog.create({ data: menuAudit(actor, { action: "MODIFIER_CREATED", entity: "Modifier", entityId: created.id, metadata: { groupId, name: input.name, priceDeltaMinor: input.priceDelta } }) });
      return created;
    });
    return { ok: true, data: modifier, message: "Ekstra eklendi." };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Ekstra adı kullanımda.", fieldErrors: MODIFIER_NAME_TAKEN };
    throw error;
  }
}

export async function updateModifier(actor: MenuActor, groupId: string, modifierId: string, input: ModifierInput): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const existing = await prisma.modifier.findFirst({ where: { id: modifierId, modifierGroupId: groupId, tenantId, archivedAt: null } });
  if (!existing) return { ok: false, error: "Ekstra bulunamadı." };
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.modifier.updateMany({ where: { id: modifierId, modifierGroupId: groupId, tenantId }, data: { name: input.name, priceDeltaMinor: input.priceDelta, active: input.active } });
      await saveModifierTranslations(tx, actor, modifierId, input.translations, translatable);
      await tx.auditLog.create({
        data: menuAudit(actor, { action: "MODIFIER_UPDATED", entity: "Modifier", entityId: modifierId, metadata: { groupId, name: input.name, from: existing.priceDeltaMinor, to: input.priceDelta, active: input.active } }),
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Ekstra adı kullanımda.", fieldErrors: MODIFIER_NAME_TAKEN };
    throw error;
  }
  return { ok: true, data: undefined, message: "Ekstra kaydedildi." };
}

export async function archiveModifier(actor: MenuActor, groupId: string, modifierId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const result = await prisma.modifier.updateMany({ where: { id: modifierId, modifierGroupId: groupId, tenantId, archivedAt: null }, data: { archivedAt: new Date(), active: false } });
  if (result.count !== 1) return { ok: false, error: "Ekstra bulunamadı." };
  await prisma.auditLog.create({ data: menuAudit(actor, { action: "MODIFIER_UPDATED", entity: "Modifier", entityId: modifierId, metadata: { groupId, archived: true } }) });
  return { ok: true, data: undefined, message: "Ekstra arşivlendi." };
}

export async function moveModifier(actor: MenuActor, groupId: string, modifierId: string, direction: "up" | "down"): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const modifiers = await prisma.modifier.findMany({ where: { modifierGroupId: groupId, tenantId, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
  if (!modifiers.some((m) => m.id === modifierId)) return { ok: false, error: "Ekstra bulunamadı." };
  const orders = swapOrders(modifiers, modifierId, direction);
  if (orders) await prisma.$transaction(orders.map((o) => prisma.modifier.updateMany({ where: { id: o.id, modifierGroupId: groupId, tenantId }, data: { sortOrder: o.sortOrder } })));
  return { ok: true, data: undefined };
}

// ─── Ürün ↔ grup bağlantıları ──────────────────────────────────────────────

export async function attachModifierGroup(actor: MenuActor, productId: string, groupId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const [product, group] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, tenantId, archivedAt: null }, select: { id: true } }),
    groupInScope(actor, groupId),
  ]);
  if (!product || !group) return { ok: false, error: "Ürün veya ekstra grubu bulunamadı." };
  const last = await prisma.productModifierGroup.findFirst({ where: { productId, tenantId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  try {
    await prisma.$transaction([
      prisma.productModifierGroup.create({ data: { tenantId, productId, modifierGroupId: groupId, sortOrder: (last?.sortOrder ?? 0) + 10 } }),
      prisma.auditLog.create({ data: menuAudit(actor, { action: "PRODUCT_UPDATED", entity: "Product", entityId: productId, metadata: { section: "modifiers", attached: groupId } }) }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: true, data: undefined, message: "Grup zaten bağlı." };
    throw error;
  }
  return { ok: true, data: undefined, message: `“${group.name}” ürüne bağlandı.` };
}

export async function detachModifierGroup(actor: MenuActor, productId: string, groupId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const result = await prisma.productModifierGroup.deleteMany({ where: { productId, modifierGroupId: groupId, tenantId } });
  if (result.count !== 1) return { ok: false, error: "Bağlantı bulunamadı." };
  await prisma.auditLog.create({ data: menuAudit(actor, { action: "PRODUCT_UPDATED", entity: "Product", entityId: productId, metadata: { section: "modifiers", detached: groupId } }) });
  return { ok: true, data: undefined, message: "Grup üründen ayrıldı." };
}

export async function moveProductModifierGroup(actor: MenuActor, productId: string, groupId: string, direction: "up" | "down"): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const links = await prisma.productModifierGroup.findMany({ where: { productId, tenantId }, orderBy: { sortOrder: "asc" }, select: { id: true, modifierGroupId: true } });
  const link = links.find((l) => l.modifierGroupId === groupId);
  if (!link) return { ok: false, error: "Bağlantı bulunamadı." };
  const orders = swapOrders(links, link.id, direction);
  if (orders) await prisma.$transaction(orders.map((o) => prisma.productModifierGroup.updateMany({ where: { id: o.id, productId, tenantId }, data: { sortOrder: o.sortOrder } })));
  return { ok: true, data: undefined };
}

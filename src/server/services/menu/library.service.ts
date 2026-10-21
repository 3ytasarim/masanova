import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { slugify } from "@/lib/utils/slugify";
import type { LibraryItemInput } from "@/lib/validation/menu";
import { getMenuLocaleConfig, isUniqueViolation, menuAudit, planTranslations, type MenuActor } from "@/server/services/menu/menu-common";

/**
 * Menü kütüphanesi: malzemeler (kiracıya özel), işletmeye özel alerjen ve diyet etiketleri.
 * Platform standart alerjen/etiketleri (tenantId null) salt okunurdur — bir kiracı onları değiştiremez
 * (değişiklik tüm kiracıları etkilerdi). Kiracı kendi kayıtlarını ekler/düzenler/pasifleştirir.
 */
export type LibraryKind = "ingredient" | "allergen" | "dietaryTag";

const ENTITY = { ingredient: "Ingredient", allergen: "Allergen", dietaryTag: "DietaryTag" } as const;
const NAME_TAKEN = { name: "Bu adla bir kayıt zaten var." };

/** İşletmeye özel alerjen/etiket kodu: "custom_" + ad'dan türetilmiş kısa ad (platform kodlarıyla çakışmaz). */
function customCode(name: string): string {
  return `custom_${slugify(name, 50).replace(/-/g, "_") || "item"}`;
}

export async function createLibraryItem(actor: MenuActor, kind: LibraryKind, input: LibraryItemInput): Promise<ActionResult<{ id: string }>> {
  const tenantId = actor.scope.tenantId;
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  const plan = planTranslations(input.translations, translatable, "name");
  try {
    const created = await prisma.$transaction(async (tx) => {
      let id: string;
      if (kind === "ingredient") {
        id = (await tx.ingredient.create({ data: { tenantId, name: input.name, active: input.active }, select: { id: true } })).id;
        if (plan.upserts.length) await tx.ingredientTranslation.createMany({ data: plan.upserts.map((t) => ({ tenantId, ingredientId: id, locale: t.locale, name: t.values.name! })) });
      } else if (kind === "allergen") {
        id = (await tx.allergen.create({ data: { tenantId, code: customCode(input.name), name: input.name, active: input.active }, select: { id: true } })).id;
        if (plan.upserts.length) await tx.allergenTranslation.createMany({ data: plan.upserts.map((t) => ({ tenantId, allergenId: id, locale: t.locale, name: t.values.name! })) });
      } else {
        id = (await tx.dietaryTag.create({ data: { tenantId, code: customCode(input.name), name: input.name, active: input.active }, select: { id: true } })).id;
        if (plan.upserts.length) await tx.dietaryTagTranslation.createMany({ data: plan.upserts.map((t) => ({ tenantId, dietaryTagId: id, locale: t.locale, name: t.values.name! })) });
      }
      await tx.auditLog.create({ data: menuAudit(actor, { action: "MENU_LIBRARY_UPDATED", entity: ENTITY[kind], entityId: id, metadata: { created: true, name: input.name } }) });
      return { id };
    });
    return { ok: true, data: created, message: "Kayıt eklendi." };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Ad kullanımda.", fieldErrors: NAME_TAKEN };
    throw error;
  }
}

export async function updateLibraryItem(actor: MenuActor, kind: LibraryKind, id: string, input: LibraryItemInput): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const { translatable } = await getMenuLocaleConfig(actor.scope);
  const plan = planTranslations(input.translations, translatable, "name");
  try {
    const found = await prisma.$transaction(async (tx) => {
      // Yalnızca bu kiracının kaydı (platform kayıtları tenantId null olduğundan burada eşleşmez → salt okunur).
      if (kind === "ingredient") {
        const r = await tx.ingredient.updateMany({ where: { id, tenantId }, data: { name: input.name, active: input.active } });
        if (r.count !== 1) return false;
        if (plan.deletes.length) await tx.ingredientTranslation.deleteMany({ where: { ingredientId: id, tenantId, locale: { in: plan.deletes } } });
        for (const t of plan.upserts) {
          await tx.ingredientTranslation.upsert({ where: { ingredientId_locale: { ingredientId: id, locale: t.locale } }, update: { name: t.values.name! }, create: { tenantId, ingredientId: id, locale: t.locale, name: t.values.name! } });
        }
      } else if (kind === "allergen") {
        const r = await tx.allergen.updateMany({ where: { id, tenantId }, data: { name: input.name, active: input.active } });
        if (r.count !== 1) return false;
        if (plan.deletes.length) await tx.allergenTranslation.deleteMany({ where: { allergenId: id, tenantId, locale: { in: plan.deletes } } });
        for (const t of plan.upserts) {
          await tx.allergenTranslation.upsert({ where: { allergenId_locale: { allergenId: id, locale: t.locale } }, update: { name: t.values.name! }, create: { tenantId, allergenId: id, locale: t.locale, name: t.values.name! } });
        }
      } else {
        const r = await tx.dietaryTag.updateMany({ where: { id, tenantId }, data: { name: input.name, active: input.active } });
        if (r.count !== 1) return false;
        if (plan.deletes.length) await tx.dietaryTagTranslation.deleteMany({ where: { dietaryTagId: id, tenantId, locale: { in: plan.deletes } } });
        for (const t of plan.upserts) {
          await tx.dietaryTagTranslation.upsert({ where: { dietaryTagId_locale: { dietaryTagId: id, locale: t.locale } }, update: { name: t.values.name! }, create: { tenantId, dietaryTagId: id, locale: t.locale, name: t.values.name! } });
        }
      }
      await tx.auditLog.create({ data: menuAudit(actor, { action: "MENU_LIBRARY_UPDATED", entity: ENTITY[kind], entityId: id, metadata: { name: input.name, active: input.active } }) });
      return true;
    });
    if (!found) return { ok: false, error: "Kayıt bulunamadı veya düzenlenemez (platform kaydı)." };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "Ad kullanımda.", fieldErrors: NAME_TAKEN };
    throw error;
  }
  return { ok: true, data: undefined, message: "Kayıt güncellendi." };
}

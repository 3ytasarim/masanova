"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MENU_LOCALES } from "@/config/menu";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { setFlash } from "@/lib/flash";
import { getRequestMeta } from "@/lib/security/request-meta";
import {
  branchOverrideSchema,
  bulkProductSchema,
  categorySchema,
  libraryItemSchema,
  menuIdSchema,
  modifierGroupSchema,
  modifierSchema,
  productContentSchema,
  productCreateSchema,
  productGeneralSchema,
  productImageSchema,
  productPricingSchema,
  productTranslationsSchema,
  variantSchema,
} from "@/lib/validation/menu";
import { saveBranchOverride } from "@/server/services/menu/branch-override.service";
import { createCategory, moveCategory, setCategoryFlag, updateCategory } from "@/server/services/menu/category.service";
import { createLibraryItem, updateLibraryItem, type LibraryKind } from "@/server/services/menu/library.service";
import type { MenuActor } from "@/server/services/menu/menu-common";
import {
  archiveModifier,
  archiveModifierGroup,
  attachModifierGroup,
  createModifier,
  createModifierGroup,
  detachModifierGroup,
  moveModifier,
  moveProductModifierGroup,
  updateModifier,
  updateModifierGroup,
} from "@/server/services/menu/modifier.service";
import {
  addProductImage,
  bulkUpdateProducts,
  createProduct,
  moveProduct,
  saveProductTranslations,
  setProductArchived,
  setProductFlag,
  updateProductContent,
  updateProductGeneral,
  updateProductImage,
  updateProductPricing,
} from "@/server/services/menu/product.service";
import { archiveVariant, createVariant, moveVariant, updateVariant } from "@/server/services/menu/variant.service";
import { invalidatePublicMenu } from "@/server/services/public-menu/public-menu-cache";

/**
 * Menü eylemleri. Her eylem: requireTenantUser({ permission: "menu.manage", write: true }) — yalnızca
 * İşletme Sahibi / Şube Müdürü; destek modunda (salt okunur) ve operasyon rollerinde reddedilir.
 * Kiracı her zaman oturumdan; form/bağlı argümanlardaki kimlikler yalnızca kapsam İÇİNDE aranır.
 */
type FormState = ActionResult | null;

async function menuActor(): Promise<MenuActor> {
  const ctx = await requireTenantUser({ permission: "menu.manage", write: true });
  return { userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() };
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";
const ids = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");

/** Çeviri alanları: t.<locale>.<field> (ör. t.en.name). Yalnızca desteklenen diller okunur. */
function translationsFrom(fd: FormData, fields: readonly string[]) {
  const out: Record<string, Record<string, string>> = {};
  for (const locale of MENU_LOCALES) {
    const values: Record<string, string> = {};
    let present = false;
    for (const field of fields) {
      const v = fd.get(`t.${locale}.${field}`);
      if (typeof v === "string") {
        values[field] = v;
        present = true;
      }
    }
    if (present) out[locale] = values;
  }
  return out;
}

/** Panel sayfalarını yeniler ve kiracının public QR menü önbelleğini geçersiz kılar (değişiklik müşteriye hemen yansır). */
function done(actor: MenuActor, result: ActionResult, ...paths: string[]): ActionResult {
  for (const p of paths.length ? paths : ["/panel/menu"]) revalidatePath(p, "layout");
  if (result.ok) invalidatePublicMenu(actor.scope.tenantId);
  return result;
}

const idOrFail = (value: string | null) => (value === null ? null : menuIdSchema.safeParse(value));

// ─── Kategoriler ────────────────────────────────────────────────────────────

export async function saveCategoryAction(categoryId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const idCheck = idOrFail(categoryId);
  if (idCheck && !idCheck.success) return { ok: false, error: "Kategori bulunamadı." };
  const parsed = categorySchema.safeParse({
    name: str(fd, "name"),
    slug: str(fd, "slug"),
    parentId: str(fd, "parentId"),
    description: str(fd, "description"),
    imageUrl: str(fd, "imageUrl"),
    active: bool(fd, "active"),
    featured: bool(fd, "featured"),
    translations: translationsFrom(fd, ["name", "description"]),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = categoryId ? await updateCategory(actor, categoryId, parsed.data) : await createCategory(actor, parsed.data);
  return done(actor, result.ok ? { ok: true, data: undefined, message: result.message } : result);
}

export async function categoryQuickAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = z
    .object({ id: menuIdSchema, op: z.enum(["active", "featured", "up", "down"]), value: z.enum(["true", "false"]).optional() })
    .safeParse({ id: str(fd, "id"), op: str(fd, "op"), value: str(fd, "value") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz işlem.");
  const { id, op, value } = parsed.data;
  const result = op === "up" || op === "down" ? await moveCategory(actor, id, op) : await setCategoryFlag(actor, id, op, value === "true");
  return done(actor, result);
}

// ─── Ürünler ────────────────────────────────────────────────────────────────

export async function createProductAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = productCreateSchema.safeParse({
    name: str(fd, "name"),
    slug: str(fd, "slug"),
    categoryId: str(fd, "categoryId"),
    shortDescription: str(fd, "shortDescription"),
    basePrice: str(fd, "basePrice"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await createProduct(actor, parsed.data);
  if (!result.ok) return result;
  revalidatePath("/panel/menu", "layout");
  await setFlash("Ürün oluşturuldu. Şimdi varyant, ekstra, içerik ve çevirileri ekleyebilirsiniz.");
  redirect(`/panel/menu/urunler/${result.data.id}`);
}

export async function updateProductGeneralAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = productGeneralSchema.safeParse({
    name: str(fd, "name"),
    slug: str(fd, "slug"),
    categoryId: str(fd, "categoryId"),
    shortDescription: str(fd, "shortDescription"),
    description: str(fd, "description"),
    sku: str(fd, "sku"),
    preparationMinutes: str(fd, "preparationMinutes"),
    featured: bool(fd, "featured"),
    active: bool(fd, "active"),
    soldOut: bool(fd, "soldOut"),
  });
  if (!parsed.success) return invalid(parsed.error);
  return done(actor, await updateProductGeneral(actor, productId, parsed.data));
}

export async function updateProductPricingAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = productPricingSchema.safeParse({ basePrice: str(fd, "basePrice"), currency: str(fd, "currency") });
  if (!parsed.success) return invalid(parsed.error);
  return done(actor, await updateProductPricing(actor, productId, parsed.data));
}

export async function updateProductContentAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = productContentSchema.safeParse({
    ingredientIds: ids(fd, "ingredientIds"),
    allergenIds: ids(fd, "allergenIds"),
    dietaryTagIds: ids(fd, "dietaryTagIds"),
    allergensConfirmed: bool(fd, "allergensConfirmed"),
    calories: str(fd, "calories"),
    proteinGrams: str(fd, "proteinGrams"),
    carbohydrateGrams: str(fd, "carbohydrateGrams"),
    fatGrams: str(fd, "fatGrams"),
  });
  if (!parsed.success) return invalid(parsed.error);
  return done(actor, await updateProductContent(actor, productId, parsed.data));
}

export async function saveProductTranslationsAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = productTranslationsSchema.safeParse(translationsFrom(fd, ["name", "shortDescription", "description"]));
  if (!parsed.success) return invalid(parsed.error);
  return done(actor, await saveProductTranslations(actor, productId, parsed.data));
}

export async function productImageAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const op = str(fd, "op");
  if (op === "add") {
    const parsed = productImageSchema.safeParse({ url: str(fd, "url") ?? "", altText: str(fd, "altText") });
    if (!parsed.success) return invalid(parsed.error);
    return done(actor, await addProductImage(actor, productId, { url: parsed.data.url, altText: parsed.data.altText }));
  }
  const imageId = menuIdSchema.safeParse(str(fd, "imageId"));
  if (!imageId.success) return { ok: false, error: "Görsel bulunamadı." };
  if (op === "primary" || op === "remove") return done(actor, await updateProductImage(actor, productId, imageId.data, { kind: op }));
  if (op === "up" || op === "down") return done(actor, await updateProductImage(actor, productId, imageId.data, { kind: "move", direction: op }));
  if (op === "alt") {
    const alt = z.string().trim().max(160, "En fazla 160 karakter.").safeParse(str(fd, "altText") ?? "");
    if (!alt.success) return invalid(alt.error);
    return done(actor, await updateProductImage(actor, productId, imageId.data, { kind: "alt", altText: alt.data || null }));
  }
  return { ok: false, error: "Geçersiz işlem." };
}

/** Listeden / editörden hızlı işaret: aktif, tükendi, öne çıkan. */
export async function productQuickAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = z
    .object({ id: menuIdSchema, op: z.enum(["active", "soldOut", "featured", "archive", "restore", "up", "down"]), value: z.enum(["true", "false"]).optional() })
    .safeParse({ id: str(fd, "id"), op: str(fd, "op"), value: str(fd, "value") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz işlem.");
  const { id, op, value } = parsed.data;
  if (op === "archive" || op === "restore") return done(actor, await setProductArchived(actor, id, op === "archive"));
  if (op === "up" || op === "down") return done(actor, await moveProduct(actor, id, op));
  return done(actor, await setProductFlag(actor, id, op, value === "true"));
}

export async function bulkProductAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = bulkProductSchema.safeParse({ op: str(fd, "op"), ids: ids(fd, "ids") });
  if (!parsed.success) return invalid(parsed.error, parsed.error.issues[0]?.message ?? "Geçersiz işlem.");
  const result = await bulkUpdateProducts(actor, parsed.data.op, parsed.data.ids);
  return done(actor, result.ok ? { ok: true, data: undefined, message: result.message } : result);
}

// ─── Varyantlar ─────────────────────────────────────────────────────────────

export async function saveVariantAction(productId: string, variantId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = variantSchema.safeParse({
    name: str(fd, "name"),
    sku: str(fd, "sku"),
    price: str(fd, "price"),
    active: bool(fd, "active"),
    isDefault: bool(fd, "isDefault"),
    translations: translationsFrom(fd, ["name"]),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = variantId ? await updateVariant(actor, productId, variantId, parsed.data) : await createVariant(actor, productId, parsed.data);
  return done(actor, result.ok ? { ok: true, data: undefined, message: result.message } : result);
}

export async function variantQuickAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = z.object({ variantId: menuIdSchema, op: z.enum(["archive", "up", "down"]) }).safeParse({ variantId: str(fd, "variantId"), op: str(fd, "op") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz işlem.");
  const { variantId, op } = parsed.data;
  return done(actor, op === "archive" ? await archiveVariant(actor, productId, variantId) : await moveVariant(actor, productId, variantId, op));
}

// ─── Ekstralar ──────────────────────────────────────────────────────────────

export async function saveModifierGroupAction(groupId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = modifierGroupSchema.safeParse({
    name: str(fd, "name"),
    required: bool(fd, "required"),
    minSelect: str(fd, "minSelect"),
    maxSelect: str(fd, "maxSelect"),
    active: bool(fd, "active"),
    translations: translationsFrom(fd, ["name"]),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = groupId ? await updateModifierGroup(actor, groupId, parsed.data) : await createModifierGroup(actor, parsed.data);
  return done(actor, result.ok ? { ok: true, data: undefined, message: result.message } : result);
}

export async function modifierGroupQuickAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const groupId = menuIdSchema.safeParse(str(fd, "groupId"));
  if (!groupId.success || str(fd, "op") !== "archive") return { ok: false, error: "Geçersiz işlem." };
  return done(actor, await archiveModifierGroup(actor, groupId.data));
}

export async function saveModifierAction(groupId: string, modifierId: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = modifierSchema.safeParse({
    name: str(fd, "name"),
    priceDelta: str(fd, "priceDelta") || "0",
    active: bool(fd, "active"),
    translations: translationsFrom(fd, ["name"]),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = modifierId ? await updateModifier(actor, groupId, modifierId, parsed.data) : await createModifier(actor, groupId, parsed.data);
  return done(actor, result.ok ? { ok: true, data: undefined, message: result.message } : result);
}

export async function modifierQuickAction(groupId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = z.object({ modifierId: menuIdSchema, op: z.enum(["archive", "up", "down"]) }).safeParse({ modifierId: str(fd, "modifierId"), op: str(fd, "op") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz işlem.");
  const { modifierId, op } = parsed.data;
  return done(actor, op === "archive" ? await archiveModifier(actor, groupId, modifierId) : await moveModifier(actor, groupId, modifierId, op));
}

export async function productModifierGroupAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = z.object({ groupId: menuIdSchema, op: z.enum(["attach", "detach", "up", "down"]) }).safeParse({ groupId: str(fd, "groupId"), op: str(fd, "op") });
  if (!parsed.success) return invalid(parsed.error, "Bir ekstra grubu seçin.");
  const { groupId, op } = parsed.data;
  const result =
    op === "attach"
      ? await attachModifierGroup(actor, productId, groupId)
      : op === "detach"
        ? await detachModifierGroup(actor, productId, groupId)
        : await moveProductModifierGroup(actor, productId, groupId, op);
  return done(actor, result);
}

// ─── Kütüphane ──────────────────────────────────────────────────────────────

export async function saveLibraryItemAction(kind: LibraryKind, id: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const parsed = libraryItemSchema.safeParse({ name: str(fd, "name"), active: bool(fd, "active"), translations: translationsFrom(fd, ["name"]) });
  if (!parsed.success) return invalid(parsed.error);
  const result = id ? await updateLibraryItem(actor, kind, id, parsed.data) : await createLibraryItem(actor, kind, parsed.data);
  return done(actor, result.ok ? { ok: true, data: undefined, message: result.message } : result);
}

// ─── Şube ayarları ──────────────────────────────────────────────────────────

export async function saveBranchOverrideAction(productId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await menuActor();
  const variantPrices: Record<string, string> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("variantPrice.") && typeof value === "string") variantPrices[key.slice("variantPrice.".length)] = value;
  }
  const parsed = branchOverrideSchema.safeParse({
    branchId: str(fd, "branchId"),
    available: str(fd, "available"),
    soldOut: str(fd, "soldOut"),
    price: str(fd, "price"),
    variantPrices,
  });
  if (!parsed.success) return invalid(parsed.error);
  return done(actor, await saveBranchOverride(actor, productId, parsed.data));
}

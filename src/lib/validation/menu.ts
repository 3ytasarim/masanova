import { z } from "zod";
import { MENU_LOCALES } from "@/config/menu";
import { MAX_PRICE_MINOR, parsePriceToMinor } from "@/lib/menu/money";
import { validateModifierGroupRules } from "@/lib/menu/rules";
import { externalUrlProvider } from "@/lib/storage/external-url-provider";
import { slugSchema } from "@/lib/validation/schemas";
import { currencySchema } from "@/lib/validation/tenant";

/**
 * Menü şemaları. tenantId hiçbir şemada yoktur; kimlikler yalnızca biçim olarak doğrulanır, sahiplik
 * sunucuda kapsamlı sorgu + bileşik yabancı anahtarla denetlenir.
 */

export const menuIdSchema = z.string().trim().regex(/^[a-z0-9_]{1,40}$/i, "Geçersiz kimlik.");
const optionalId = z
  .union([z.literal(""), menuIdSchema])
  .optional()
  .transform((v) => (v ? v : null));

export const menuNameSchema = z.string({ error: "Gerekli." }).trim().min(1, "Gerekli.").max(120, "En fazla 120 karakter.");
export const menuSlugSchema = slugSchema.refine((v) => v.length <= 80, "En fazla 80 karakter.");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${max} karakter.`)
    .optional()
    .transform((v) => (v ? v : null));

/** "89,90" → 8990 (kuruş). */
export const priceSchema = z
  .string({ error: "Fiyat gerekli." })
  .transform((v, ctx) => {
    const minor = parsePriceToMinor(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: "Geçerli bir fiyat girin (ör. 89,90)." });
      return z.NEVER;
    }
    return minor;
  });

/** Boş → null (miras alır). */
export const optionalPriceSchema = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const minor = parsePriceToMinor(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: "Geçerli bir fiyat girin (ör. 89,90)." });
      return z.NEVER;
    }
    return minor;
  });

const optionalInt = (min: number, max: number, label: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const n = Number(v.trim());
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} ${min}–${max} arasında tam sayı olmalı.` });
        return z.NEVER;
      }
      return n;
    });

export const imageUrlSchema = z.string().transform((v, ctx) => {
  const result = externalUrlProvider.validateKey(v);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  }
  return result.key;
});

const optionalImageUrl = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const result = externalUrlProvider.validateKey(v);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error });
      return z.NEVER;
    }
    return result.key;
  });

// ─── Çeviriler ──────────────────────────────────────────────────────────────

export const menuLocaleSchema = z.enum(MENU_LOCALES, { error: "Desteklenmeyen dil." });

/** { en: { name, description }, de: {...} } — boş değerler "çeviri yok" demektir (satır silinir). */
const translationField = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Çok uzun.")
    .optional()
    .transform((v) => (v ? v : null));

export function translationsSchema<const F extends readonly string[]>(fields: F, limits: Partial<Record<F[number], number>> = {}) {
  const shape = {} as Record<F[number], ReturnType<typeof translationField>>;
  for (const field of fields as readonly F[number][]) shape[field] = translationField(limits[field] ?? 120);
  return z.partialRecord(menuLocaleSchema, z.object(shape)).default({});
}

// ─── Kategori ───────────────────────────────────────────────────────────────

export const categorySchema = z.object({
  name: menuNameSchema,
  slug: menuSlugSchema,
  parentId: optionalId,
  description: optionalText(500),
  imageUrl: optionalImageUrl,
  active: z.boolean(),
  featured: z.boolean(),
  translations: translationsSchema(["name", "description"] as const, { description: 500 }),
});
export type CategoryInput = z.output<typeof categorySchema>;

// ─── Ürün ───────────────────────────────────────────────────────────────────

export const productCreateSchema = z.object({
  name: menuNameSchema,
  slug: menuSlugSchema,
  categoryId: menuIdSchema,
  shortDescription: optionalText(280),
  basePrice: priceSchema,
});
export type ProductCreateInput = z.output<typeof productCreateSchema>;

export const productGeneralSchema = z.object({
  name: menuNameSchema,
  slug: menuSlugSchema,
  categoryId: menuIdSchema,
  shortDescription: optionalText(280),
  description: optionalText(4000),
  sku: optionalText(64),
  preparationMinutes: optionalInt(0, 600, "Hazırlık süresi"),
  featured: z.boolean(),
  active: z.boolean(),
  soldOut: z.boolean(),
});
export type ProductGeneralInput = z.output<typeof productGeneralSchema>;

export const productPricingSchema = z.object({ basePrice: priceSchema, currency: currencySchema });

export const productContentSchema = z.object({
  ingredientIds: z.array(menuIdSchema).max(100),
  allergenIds: z.array(menuIdSchema).max(40),
  dietaryTagIds: z.array(menuIdSchema).max(40),
  allergensConfirmed: z.boolean(),
  calories: optionalInt(0, 10_000, "Kalori"),
  proteinGrams: optionalInt(0, 2_000, "Protein"),
  carbohydrateGrams: optionalInt(0, 2_000, "Karbonhidrat"),
  fatGrams: optionalInt(0, 2_000, "Yağ"),
});
export type ProductContentInput = z.output<typeof productContentSchema>;

export const productTranslationsSchema = translationsSchema(["name", "shortDescription", "description"] as const, {
  shortDescription: 280,
  description: 4000,
});

export const productImageSchema = z.object({ url: imageUrlSchema, altText: optionalText(160) });

// ─── Varyant ────────────────────────────────────────────────────────────────

export const variantSchema = z.object({
  name: z.string({ error: "Gerekli." }).trim().min(1, "Gerekli.").max(60, "En fazla 60 karakter."),
  sku: optionalText(64),
  price: optionalPriceSchema,
  active: z.boolean(),
  isDefault: z.boolean(),
  translations: translationsSchema(["name"] as const, { name: 60 }),
});
export type VariantInput = z.output<typeof variantSchema>;

// ─── Ekstralar ──────────────────────────────────────────────────────────────

export const modifierGroupSchema = z
  .object({
    name: menuNameSchema,
    required: z.boolean(),
    minSelect: z.coerce.number({ error: "Sayı girin." }).int("Tam sayı girin."),
    maxSelect: z.coerce.number({ error: "Sayı girin." }).int("Tam sayı girin."),
    active: z.boolean(),
    translations: translationsSchema(["name"] as const),
  })
  .superRefine((value, ctx) => {
    const error = validateModifierGroupRules(value);
    if (error) ctx.addIssue({ code: "custom", message: error, path: ["minSelect"] });
  });
export type ModifierGroupInput = z.output<typeof modifierGroupSchema>;

export const modifierSchema = z.object({
  name: menuNameSchema,
  priceDelta: priceSchema.refine((v) => v >= 0 && v <= MAX_PRICE_MINOR, "Fiyat farkı 0 veya pozitif olmalı."),
  active: z.boolean(),
  translations: translationsSchema(["name"] as const),
});
export type ModifierInput = z.output<typeof modifierSchema>;

// ─── Kütüphane ──────────────────────────────────────────────────────────────

export const libraryItemSchema = z.object({
  name: z.string({ error: "Gerekli." }).trim().min(1, "Gerekli.").max(80, "En fazla 80 karakter."),
  active: z.boolean(),
  translations: translationsSchema(["name"] as const, { name: 80 }),
});
export type LibraryItemInput = z.output<typeof libraryItemSchema>;

// ─── Şube geçersiz kılmaları ────────────────────────────────────────────────

const triState = z.enum(["inherit", "yes", "no"]);

export const branchOverrideSchema = z.object({
  branchId: menuIdSchema,
  available: triState,
  soldOut: triState,
  price: optionalPriceSchema,
  variantPrices: z.record(menuIdSchema, optionalPriceSchema).default({}),
});
export type BranchOverrideInput = z.output<typeof branchOverrideSchema>;

// ─── Toplu işlemler / sıralama ──────────────────────────────────────────────

export const BULK_PRODUCT_OPS = ["activate", "deactivate", "sold_out", "clear_sold_out", "feature", "unfeature"] as const;
export const bulkProductSchema = z.object({
  op: z.enum(BULK_PRODUCT_OPS),
  ids: z.array(menuIdSchema).min(1, "En az bir ürün seçin.").max(100, "En fazla 100 ürün seçilebilir."),
});

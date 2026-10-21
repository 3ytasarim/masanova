import "server-only";
import { textDirection } from "@/config/menu";
import { prisma } from "@/lib/db/prisma";
import { resolveAvailability, type AvailabilityStatus } from "@/lib/menu/availability";
import { resolveProductPrice, resolveStartingPrice } from "@/lib/menu/pricing";
import { pickTranslated, translatedName } from "@/lib/menu/translation";
import { MEDIA_ASSET_SELECT, resolveImage, resolveProductImage } from "@/server/media/urls";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * Yayınlanmış menü — gelecekteki public QR menü, sipariş motoru ve AI asistanın TEK veri kaynağı.
 * Public QR menü (Sprint 5) bunu önbellekli olarak (public-menu-cache.ts) ve toPublicMenuView ile küçültülmüş
 * bir sözleşmeye dönüştürerek kullanır.
 *
 * Döndürmez: SKU, iç kimlikler dışındaki yönetim alanları, arşivlenmiş/pasif kayıtlar, denetim zaman damgaları.
 * Çevirisi olmayan alanlar varsayılan dile düşer (`fallback` ile işaretlenir). Fiyat ve erişilebilirlik
 * merkezi çözümleyicilerden gelir; alerjen/diyet/besin bilgisi "işletme beyanı" olarak işaretlenir.
 */
export type PublishedMenu = {
  locale: string;
  defaultLocale: string;
  direction: "ltr" | "rtl";
  currency: string;
  branch: { id: string; name: string } | null;
  categories: PublishedCategory[];
};

export type PublishedCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  featured: boolean;
  children: PublishedCategory[];
  products: PublishedProduct[];
};

export type PublishedProduct = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  translationFallback: boolean;
  featured: boolean;
  availability: AvailabilityStatus;
  price: { amountMinor: number; currency: string; startingFrom: boolean };
  preparationMinutes: number | null;
  images: { url: string; srcSet: string | null; alt: string | null; primary: boolean }[];
  variants: { id: string; name: string; priceMinor: number; isDefault: boolean }[];
  modifierGroups: {
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    modifiers: { id: string; name: string; priceDeltaMinor: number }[];
  }[];
  ingredients: string[];
  allergens: { code: string; name: string }[];
  /** İşletme alerjen bilgisini beyan etti mi (onay ya da en az bir alerjen)? Değilse "bilinmiyor" — "alerjen yok" DEĞİL. */
  allergensDeclared: boolean;
  dietaryTags: { code: string; name: string }[];
  nutrition: { calories: number | null; proteinGrams: number | null; carbohydrateGrams: number | null; fatGrams: number | null } | null;
  /** Alerjen, diyet etiketi ve besin değeri bilgileri işletme beyanıdır; platform doğrulamaz/sertifikalamaz. */
  declaredByRestaurant: true;
};

export async function getPublishedMenu(scope: TenantScope, options: { branchId?: string | null; locale: string }): Promise<PublishedMenu> {
  const tenantId = scope.tenantId;
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultLocale: true, defaultCurrency: true } });
  const defaultLocale = settings?.defaultLocale ?? "tr";
  const locale = options.locale;

  const branch = options.branchId
    ? await prisma.branch.findFirst({ where: { id: options.branchId, tenantId }, select: { id: true, name: true, active: true } })
    : null;
  if (options.branchId && !branch) throw new Error("branch_not_found");

  const translationFilter = { where: { locale: { in: [locale, defaultLocale] } } };
  const [categories, products, branchVariantPrices] = await Promise.all([
    prisma.menuCategory.findMany({
      where: { tenantId, active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, parentId: true, slug: true, name: true, description: true, imageUrl: true, imageAsset: { select: MEDIA_ASSET_SELECT }, featured: true, active: true, translations: translationFilter },
    }),
    prisma.product.findMany({
      where: { tenantId, archivedAt: null, active: true, category: { active: true } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        category: { select: { active: true, parent: { select: { active: true } } } },
        translations: translationFilter,
        images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], include: { mediaAsset: { select: MEDIA_ASSET_SELECT } } },
        variants: { where: { archivedAt: null, active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { translations: translationFilter } },
        modifierGroups: {
          orderBy: { sortOrder: "asc" },
          where: { group: { active: true, archivedAt: null } },
          include: {
            group: {
              include: {
                translations: translationFilter,
                modifiers: { where: { active: true, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { translations: translationFilter } },
              },
            },
          },
        },
        ingredients: { orderBy: { sortOrder: "asc" }, where: { ingredient: { active: true } }, include: { ingredient: { include: { translations: translationFilter } } } },
        allergens: { where: { allergen: { active: true } }, include: { allergen: { include: { translations: translationFilter } } } },
        dietaryTags: { where: { dietaryTag: { active: true } }, include: { dietaryTag: { include: { translations: translationFilter } } } },
        // Şube verilmediyse hiçbir şube geçersiz kılması eşleşmez (boş id) → ürün varsayılanları kullanılır.
        branchOverrides: { where: { branchId: branch?.id ?? "" } },
      },
    }),
    branch ? prisma.branchVariantPrice.findMany({ where: { tenantId, branchId: branch.id }, select: { variantId: true, priceMinor: true } }) : Promise.resolve([]),
  ]);
  const branchPrices = new Map(branchVariantPrices.map((p) => [p.variantId, p.priceMinor]));

  const publishedProducts = new Map<string, PublishedProduct[]>();
  for (const product of products) {
    const branchProduct = product.branchOverrides[0] ?? null;
    const availability = resolveAvailability({ product, category: product.category, branch, branchProduct });
    if (!availability.visible) continue;

    const text = pickTranslated(
      { name: product.name, shortDescription: product.shortDescription, description: product.description },
      product.translations,
      locale,
      defaultLocale,
    );
    const starting = resolveStartingPrice({
      product,
      branchProduct,
      variants: product.variants,
      branchVariantPrices: branchPrices,
    });

    const published: PublishedProduct = {
      id: product.id,
      slug: product.slug,
      name: text.values.name,
      shortDescription: text.values.shortDescription,
      description: text.values.description,
      translationFallback: text.fallback,
      featured: product.featured,
      availability: availability.status,
      price: { amountMinor: starting.amountMinor, currency: starting.currency, startingFrom: product.variants.length > 1 },
      preparationMinutes: product.preparationMinutes,
      images: product.images.flatMap((image) => {
        const resolved = resolveProductImage(image);
        return resolved ? [{ url: resolved.url, srcSet: resolved.srcSet, alt: image.altText, primary: image.isPrimary }] : [];
      }),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        name: translatedName(variant.name, variant.translations, locale, defaultLocale),
        priceMinor: resolveProductPrice({
          product,
          branchProduct,
          variant,
          branchVariant: branchPrices.has(variant.id) ? { priceMinor: branchPrices.get(variant.id)! } : null,
        }).amountMinor,
        isDefault: variant.isDefault,
      })),
      modifierGroups: product.modifierGroups.map(({ group }) => ({
        id: group.id,
        name: translatedName(group.name, group.translations, locale, defaultLocale),
        required: group.required,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        modifiers: group.modifiers.map((m) => ({ id: m.id, name: translatedName(m.name, m.translations, locale, defaultLocale), priceDeltaMinor: m.priceDeltaMinor })),
      })),
      ingredients: product.ingredients.map(({ ingredient }) => translatedName(ingredient.name, ingredient.translations, locale, defaultLocale)),
      allergens: product.allergens.map(({ allergen }) => ({ code: allergen.code, name: translatedName(allergen.name, allergen.translations, locale, defaultLocale) })),
      allergensDeclared: product.allergensConfirmedAt !== null || product.allergens.length > 0,
      dietaryTags: product.dietaryTags.map(({ dietaryTag }) => ({ code: dietaryTag.code, name: translatedName(dietaryTag.name, dietaryTag.translations, locale, defaultLocale) })),
      nutrition:
        product.calories ?? product.proteinGrams ?? product.carbohydrateGrams ?? product.fatGrams
          ? { calories: product.calories, proteinGrams: product.proteinGrams, carbohydrateGrams: product.carbohydrateGrams, fatGrams: product.fatGrams }
          : null,
      declaredByRestaurant: true,
    };
    const list = publishedProducts.get(product.categoryId) ?? [];
    list.push(published);
    publishedProducts.set(product.categoryId, list);
  }

  const toPublished = (c: (typeof categories)[number]): PublishedCategory => {
    const text = pickTranslated({ name: c.name, description: c.description }, c.translations, locale, defaultLocale);
    return {
      id: c.id,
      slug: c.slug,
      name: text.values.name,
      description: text.values.description,
      imageUrl: resolveImage(c.imageAsset, c.imageUrl)?.url ?? null,
      featured: c.featured,
      children: [],
      products: publishedProducts.get(c.id) ?? [],
    };
  };

  const roots = categories.filter((c) => c.parentId === null).map(toPublished);
  const byId = new Map(roots.map((r) => [r.id, r]));
  for (const child of categories.filter((c) => c.parentId !== null)) {
    const parent = byId.get(child.parentId!);
    if (parent) parent.children.push(toPublished(child)); // pasif üst kategorinin altındakiler gösterilmez
  }
  const nonEmpty = (c: PublishedCategory): boolean => c.products.length > 0 || c.children.some(nonEmpty);
  for (const root of roots) root.children = root.children.filter(nonEmpty);

  return {
    locale,
    defaultLocale,
    direction: textDirection(locale),
    currency: settings?.defaultCurrency ?? "TRY",
    branch: branch ? { id: branch.id, name: branch.name } : null,
    categories: roots.filter(nonEmpty),
  };
}

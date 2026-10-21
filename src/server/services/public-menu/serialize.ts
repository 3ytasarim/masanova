import "server-only";
import { MENU_LOCALES, isMenuLocale, type MenuLocale } from "@/config/menu";
import { formatMoney } from "@/lib/menu/money";
import { NUMBER_LOCALES } from "@/lib/public-menu/i18n";
import { DIETARY_FILTER_CODES, normalizeSearchText } from "@/lib/public-menu/search";
import { resolvePublicTheme } from "@/lib/public-menu/theme";
import { applyVisibility } from "@/lib/public-menu/visibility";
import type { PublicCategoryView, PublicMenuView, PublicProductView } from "@/lib/public-menu/types";
import type { PublishedCategory, PublishedMenu, PublishedProduct } from "@/server/services/menu/public-menu.service";
import type { PublicPresentation } from "@/server/services/public-menu/public-menu-cache";

/**
 * Yayınlanmış menü (sunucu) → public görünüm sözleşmesi (tarayıcı). Tek dönüşüm noktası: buradan çıkmayan alan
 * tarayıcıya gitmez. Fiyatlar merkezi çözümleyicinin sonucundan biçimlenir; istemci hesap yapmaz.
 */
export function toPublicMenuView(
  menu: PublishedMenu,
  presentation: PublicPresentation,
  context: { table: { name: string; area: string | null } | null; refOf: (id: string) => string; ordering: PublicMenuView["ordering"] },
): PublicMenuView {
  const locale: MenuLocale = isMenuLocale(menu.locale) ? menu.locale : "tr";
  const numberLocale = NUMBER_LOCALES[locale];
  const money = (minor: number, currency: string) => formatMoney(minor, currency, numberLocale);

  const categories: PublicCategoryView[] = [];
  const featuredKeys: string[] = [];
  const dietary = new Map<string, string>();
  const allergens = new Map<string, string>();

  const toProduct = (p: PublishedProduct, categoryKey: string, categoryNames: string[]): PublicProductView => {
    if (p.featured && p.availability !== "unavailable") featuredKeys.push(p.slug);
    for (const t of p.dietaryTags) if ((DIETARY_FILTER_CODES as readonly string[]).includes(t.code)) dietary.set(t.code, t.name);
    for (const a of p.allergens) allergens.set(a.code, a.name);
    return {
      key: p.slug,
      categoryKey,
      name: p.name,
      shortDescription: p.shortDescription,
      description: p.description,
      featured: p.featured,
      soldOut: p.availability === "sold_out",
      priceLabel: money(p.price.amountMinor, p.price.currency),
      startingFrom: p.price.startingFrom,
      preparationMinutes: p.preparationMinutes,
      images: p.images.map((i) => ({ url: i.url, srcSet: i.srcSet, alt: i.alt })),
      currency: p.price.currency,
      basePriceMinor: p.price.amountMinor,
      variants: p.variants.map((v) => ({ ref: context.refOf(v.id), name: v.name, priceLabel: money(v.priceMinor, p.price.currency), priceMinor: v.priceMinor, isDefault: v.isDefault })),
      modifierGroups: p.modifierGroups.map((g) => ({
        ref: context.refOf(g.id),
        name: g.name,
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        modifiers: g.modifiers.map((m) => ({ ref: context.refOf(m.id), name: m.name, priceDeltaMinor: m.priceDeltaMinor, priceDeltaLabel: m.priceDeltaMinor > 0 ? `+${money(m.priceDeltaMinor, p.price.currency)}` : null })),
      })),
      ingredients: p.ingredients,
      allergens: p.allergens,
      allergenInfoDeclared: p.allergensDeclared,
      dietaryTags: p.dietaryTags,
      nutrition: p.nutrition,
      search: normalizeSearchText(
        [p.name, p.shortDescription, p.description, ...(presentation.showIngredients ? p.ingredients : []), ...categoryNames, ...p.dietaryTags.map((t) => t.name)].filter(Boolean).join(" "),
      ),
    };
  };

  const pushCategory = (c: PublishedCategory, parent: PublishedCategory | null) => {
    const names = parent ? [parent.name, c.name] : [c.name];
    categories.push({
      key: c.slug,
      name: c.name,
      description: c.description,
      imageUrl: c.imageUrl,
      parentKey: parent?.slug ?? null,
      products: c.products.map((p) => toProduct(p, c.slug, names)),
    });
  };
  for (const root of menu.categories) {
    pushCategory(root, null);
    for (const child of root.children) pushCategory(child, root);
  }

  const theme = resolvePublicTheme(presentation);
  // Görünürlük tercihleri (alerjen / malzeme / besin / süre) tek fonksiyonla uygulanır — önizlemeyle birebir aynı.
  return applyVisibility({
    locale,
    defaultLocale: menu.defaultLocale,
    direction: menu.direction,
    availableLocales: [...MENU_LOCALES],
    restaurant: { name: presentation.restaurantName },
    branch: menu.branch ? { name: menu.branch.name } : null,
    table: context.table,
    categories,
    featuredKeys,
    filters: {
      dietary: DIETARY_FILTER_CODES.filter((code) => dietary.has(code)).map((code) => ({ code, name: dietary.get(code)! })),
      allergens: [...allergens].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, numberLocale)),
    },
    theme,
    ordering: context.ordering,
  }, theme.show);
}

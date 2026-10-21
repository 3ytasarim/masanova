import type { PublicMenuView } from "@/lib/public-menu/types";

/** "Popüler" bölümünün sabit anahtarı (kategori kısa adlarıyla çakışmaz). */
export const POPULAR_KEY = "__popular";

export type CategoryNavItem = { key: string; name: string; child: boolean };

/**
 * Kategori gezinme çipleri: önce "Popüler" (öne çıkan ürün varsa), sonra menü sırasıyla ana kategoriler ve alt
 * kategorileri. Ürünü olmayan ana kategori yalnızca görünür alt kategorisi varsa listelenir.
 */
export function buildCategoryNav(view: Pick<PublicMenuView, "categories" | "featuredKeys">, popularLabel: string): CategoryNavItem[] {
  const hasChildren = new Set(view.categories.filter((c) => c.parentKey).map((c) => c.parentKey));
  return [
    ...(view.featuredKeys.length ? [{ key: POPULAR_KEY, name: popularLabel, child: false }] : []),
    ...view.categories.filter((c) => c.products.length > 0 || hasChildren.has(c.key)).map((c) => ({ key: c.key, name: c.name, child: c.parentKey !== null })),
  ];
}

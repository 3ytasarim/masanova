import type { PublicProductView } from "@/lib/public-menu/types";

/**
 * Menü içi arama ve filtreler — saf fonksiyonlar. Arama metni sunucuda bir kez üretilir (normalizeSearchText),
 * istemci yalnızca sorguyu aynı fonksiyonla normalize edip yüklenmiş menüde süzer (ağ isteği yok, anında).
 */

/** Büyük/küçük harf, Türkçe İ/ı, aksan ve noktalama duyarsız; Arapça harfler korunur. */
export function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Sorgudaki her kelime metinde geçmeli (sıra önemsiz). */
export function matchesQuery(searchText: string, query: string): boolean {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  return terms.every((term) => searchText.includes(term));
}

/** Müşteri diyet filtreleri — yalnızca menüde gerçekten bulunanlar gösterilir. */
export const DIETARY_FILTER_CODES = ["vegan", "vegetarian", "gluten_free", "lactose_free", "spicy"] as const;

export type MenuFilters = {
  query: string;
  /** Ürün bu etiketlerin HEPSİNİ taşımalı (işletme beyanı). */
  dietary: readonly string[];
  /** Ürün bu alerjenlerin HİÇBİRİNİ içermemeli — yalnızca alerjen bilgisi beyan edilmiş ürünler eşleşir. */
  excludeAllergens: readonly string[];
};

export const EMPTY_FILTERS: MenuFilters = { query: "", dietary: [], excludeAllergens: [] };

export function hasActiveFilters(filters: MenuFilters): boolean {
  return filters.query.trim() !== "" || filters.dietary.length > 0 || filters.excludeAllergens.length > 0;
}

export function productMatches(product: PublicProductView, filters: MenuFilters): boolean {
  if (filters.query.trim() && !matchesQuery(product.search, filters.query)) return false;
  if (filters.dietary.length && !filters.dietary.every((code) => product.dietaryTags.some((t) => t.code === code))) return false;
  if (filters.excludeAllergens.length) {
    // Bilgisi girilmemiş ürün "içermez" diye gösterilemez (güvenlik).
    if (!product.allergenInfoDeclared) return false;
    if (product.allergens.some((a) => filters.excludeAllergens.includes(a.code))) return false;
  }
  return true;
}

export function filterProducts<T extends PublicProductView>(products: readonly T[], filters: MenuFilters): T[] {
  return products.filter((p) => productMatches(p, filters));
}

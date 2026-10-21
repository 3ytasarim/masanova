import type { PublicMenuView, PublicTheme } from "@/lib/public-menu/types";

/**
 * İşletmenin görünürlük tercihlerini görünüm sözleşmesine uygular (tek kaynak: sunucu serileştirmesi ve paneldeki
 * canlı önizleme aynı fonksiyonu kullanır). Alerjenler gizlenirse ürünler "alerjen bilgisi yok" sayılır — böylece
 * "içermesin" filtresi bir ürünü asla yanlışlıkla güvenli göstermez.
 */
export function applyVisibility(view: PublicMenuView, show: PublicTheme["show"]): PublicMenuView {
  return {
    ...view,
    categories: view.categories.map((c) => ({
      ...c,
      products: c.products.map((p) => ({
        ...p,
        ingredients: show.ingredients ? p.ingredients : [],
        allergens: show.allergens ? p.allergens : [],
        allergenInfoDeclared: show.allergens && p.allergenInfoDeclared,
        nutrition: show.nutrition ? p.nutrition : null,
        preparationMinutes: show.preparationTime ? p.preparationMinutes : null,
      })),
    })),
    filters: { dietary: view.filters.dietary, allergens: show.allergens ? view.filters.allergens : [] },
  };
}

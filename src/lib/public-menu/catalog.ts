import type { CatalogProduct } from "@/lib/orders/calculate";
import type { PublicMenuView, PublicProductView } from "@/lib/public-menu/types";

/**
 * Public görünümden istemci kataloğu — merkezi hesaplayıcıyla (src/lib/orders/calculate.ts) canlı fiyat
 * ÖNİZLEMESİ için. Yetkili değildir: gönderimde sunucu aynı hesabı veritabanındaki güncel veriyle yeniden yapar.
 */
export function toCatalogProduct(p: PublicProductView): CatalogProduct {
  return {
    key: p.key,
    name: p.name,
    currency: p.currency,
    availability: p.soldOut ? "sold_out" : "available",
    basePriceMinor: p.basePriceMinor,
    variants: p.variants.map((v) => ({ ref: v.ref, name: v.name, priceMinor: v.priceMinor, isDefault: v.isDefault })),
    groups: p.modifierGroups.map((g) => ({
      ref: g.ref,
      name: g.name,
      required: g.required,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: g.modifiers.map((m) => ({ ref: m.ref, name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
    })),
  };
}

export function toClientCatalog(view: Pick<PublicMenuView, "categories">): Map<string, CatalogProduct> {
  return new Map(view.categories.flatMap((c) => c.products.map((p) => [p.key, toCatalogProduct(p)] as const)));
}

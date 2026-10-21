/**
 * MERKEZİ FİYAT ÇÖZÜMLEYİCİ — bileşenlerde fiyat hesabı yapılmaz, her yer bunu çağırır
 * (panel önizlemesi, gelecekteki public menü, sipariş motoru, AI asistan).
 *
 * Kesin kural (tamsayı kuruş):
 *   Varyant seçili değilse:
 *     1) şube ürün fiyatı (BranchProduct.priceMinor)
 *     2) ürün taban fiyatı (Product.basePriceMinor)
 *   Varyant seçiliyse:
 *     1) şube varyant fiyatı (BranchVariantPrice.priceMinor)
 *     2) varyantın kendi fiyatı (ProductVariant.priceMinor)
 *     3) şube ürün fiyatı
 *     4) ürün taban fiyatı
 *
 * Neden "varyant fiyatı" şube ürün fiyatından önce? Şube ürün fiyatı ürünün TABAN fiyatını geçersiz kılar;
 * kendi fiyatı olan varyantları (Küçük 50 / Büyük 70) tek bir fiyata ezmemelidir. Fiyatı boş (null) olan
 * varyantlar tabanı miras aldığı için şube ürün fiyatı onlara uygulanır. Şubeye özel varyant fiyatı her
 * zaman en yüksek önceliklidir. (Görevdeki öncelik listesinin bilinçli ve belgelenmiş yorumu.)
 *
 * Ekstralar (Modifier.priceDeltaMinor) ayrı toplanır: totalWithModifiers().
 */
export type PriceSource = "branch_variant" | "variant" | "branch_product" | "product";

export type PriceInput = {
  product: { basePriceMinor: number; currency: string };
  variant?: { priceMinor: number | null } | null;
  branchProduct?: { priceMinor: number | null } | null;
  branchVariant?: { priceMinor: number } | null;
};

export type ResolvedPrice = { amountMinor: number; currency: string; source: PriceSource };

export function resolveProductPrice(input: PriceInput): ResolvedPrice {
  const { product, variant, branchProduct, branchVariant } = input;
  const currency = product.currency;

  if (variant) {
    if (branchVariant) return { amountMinor: branchVariant.priceMinor, currency, source: "branch_variant" };
    if (variant.priceMinor !== null) return { amountMinor: variant.priceMinor, currency, source: "variant" };
  }
  if (branchProduct && branchProduct.priceMinor !== null) {
    return { amountMinor: branchProduct.priceMinor, currency, source: "branch_product" };
  }
  return { amountMinor: product.basePriceMinor, currency, source: "product" };
}

/** Seçilen ekstraların fiyat farklarını ekler (tamsayı toplam; negatif fark desteklenmez). */
export function totalWithModifiers(base: ResolvedPrice, modifierDeltasMinor: readonly number[]): ResolvedPrice {
  const extra = modifierDeltasMinor.reduce((sum, d) => sum + Math.max(0, d), 0);
  return { ...base, amountMinor: base.amountMinor + extra };
}

/** "₺50,00'den başlayan" gösterimi için: aktif varyantların çözülmüş en düşük fiyatı (varyant yoksa ürün fiyatı). */
export function resolveStartingPrice(
  input: Omit<PriceInput, "variant" | "branchVariant"> & {
    variants: readonly { id: string; priceMinor: number | null }[];
    branchVariantPrices?: ReadonlyMap<string, number>;
  },
): ResolvedPrice {
  if (input.variants.length === 0) return resolveProductPrice(input);
  const prices = input.variants.map((variant) => {
    const branchPrice = input.branchVariantPrices?.get(variant.id);
    return resolveProductPrice({
      product: input.product,
      branchProduct: input.branchProduct,
      variant,
      branchVariant: branchPrice === undefined ? null : { priceMinor: branchPrice },
    });
  });
  return prices.reduce((min, p) => (p.amountMinor < min.amountMinor ? p : min));
}

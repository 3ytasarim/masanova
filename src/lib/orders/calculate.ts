/**
 * MERKEZİ SİPARİŞ HESAPLAYICI — saf fonksiyon, tek kaynak.
 *
 * Sunucu: gönderimde veritabanından (önbelleksiz) kurulan katalogla çalıştırır → TEK yetkili sonuç.
 * İstemci: aynı fonksiyonu sunucunun gönderdiği public katalogla çalıştırır → yalnızca fiyat önizlemesi (UX).
 * İleride garson / POS / AI siparişleri de bu motoru kullanır.
 *
 * Katalogdaki fiyatlar ZATEN merkezi fiyat çözümleyicisinden (src/lib/menu/pricing.ts) geçmiştir:
 *   varyantsız ürün → basePriceMinor (şube ürün fiyatı → taban)
 *   varyant        → variant.priceMinor (şube varyant → varyant → şube ürün → taban)
 * Burada yalnızca seçim kuralları ve tamsayı kuruş toplamları uygulanır. Hiçbir fiyat istemciden okunmaz:
 * istemcinin gönderdiği `expectedUnitPriceMinor` yalnızca "fiyat değişti mi?" karşılaştırması içindir.
 */

export const ORDER_LIMITS = {
  maxLines: 30,
  maxQuantityPerLine: 20,
  maxTotalQuantity: 100,
  itemNoteMax: 140,
  orderNoteMax: 300,
} as const;

export type CatalogModifier = { ref: string; id?: string; name: string; priceDeltaMinor: number };
export type CatalogGroup = { ref: string; id?: string; name: string; required: boolean; minSelect: number; maxSelect: number; modifiers: CatalogModifier[] };
export type CatalogVariant = { ref: string; id?: string; name: string; priceMinor: number; isDefault: boolean };
export type CatalogProduct = {
  key: string;
  id?: string;
  name: string;
  /** İşletmenin varsayılan dilindeki ad (sunucu kopyası için). */
  nameDefault?: string;
  currency: string;
  availability: "available" | "sold_out" | "unavailable";
  /** Varyantsız ürünün çözülmüş fiyatı. */
  basePriceMinor: number;
  variants: CatalogVariant[];
  groups: CatalogGroup[];
};
export type OrderCatalog = ReadonlyMap<string, CatalogProduct>;

export type ItemSelection = {
  product: string;
  variant: string | null;
  modifiers: { group: string; modifier: string }[];
  quantity: number;
  note: string | null;
  /** Müşterinin sepette gördüğü birim fiyat (yalnızca karşılaştırma). */
  expectedUnitPriceMinor?: number | null;
};

export type LineIssue =
  | { code: "product_unavailable" }
  | { code: "sold_out" }
  | { code: "variant_required" }
  | { code: "variant_invalid" }
  | { code: "group_invalid" }
  | { code: "modifier_invalid" }
  | { code: "duplicate_modifier" }
  | { code: "group_min"; group: string; min: number }
  | { code: "group_max"; group: string; max: number }
  | { code: "quantity_invalid" }
  | { code: "note_too_long" }
  | { code: "price_changed"; fromMinor: number; toMinor: number };

export type CalculatedLine = {
  index: number;
  product: CatalogProduct | null;
  variant: CatalogVariant | null;
  modifiers: { group: CatalogGroup; modifier: CatalogModifier }[];
  basePriceMinor: number;
  modifiersTotalMinor: number;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  note: string | null;
  issues: LineIssue[];
};

export type OrderCalculation = {
  lines: CalculatedLine[];
  currency: string | null;
  subtotalMinor: number;
  totalMinor: number;
  itemCount: number;
  /** Sepet geneli sorunlar (boş sepet, sınır aşımı, karışık para birimi). */
  orderIssues: ("empty" | "too_many_lines" | "too_many_items" | "mixed_currency")[];
  ok: boolean;
};

/** Tek satırın birim fiyatı ve kural doğrulaması. */
export function calculateLine(product: CatalogProduct | undefined, selection: ItemSelection, index = 0, options: { checkExpectedPrice?: boolean } = {}): CalculatedLine {
  const issues: LineIssue[] = [];
  const quantity = selection.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > ORDER_LIMITS.maxQuantityPerLine) issues.push({ code: "quantity_invalid" });
  if (selection.note && selection.note.length > ORDER_LIMITS.itemNoteMax) issues.push({ code: "note_too_long" });

  const empty: CalculatedLine = { index, product: product ?? null, variant: null, modifiers: [], basePriceMinor: 0, modifiersTotalMinor: 0, unitPriceMinor: 0, quantity, lineTotalMinor: 0, note: selection.note, issues };
  if (!product || product.availability === "unavailable") {
    issues.unshift({ code: "product_unavailable" });
    return empty;
  }
  if (product.availability === "sold_out") issues.push({ code: "sold_out" });

  // Varyant: ürünün varyantı varsa seçim ZORUNLU (sunucu kendiliğinden varsayılanı seçmez — sessiz değişiklik yok).
  let variant: CatalogVariant | null = null;
  if (product.variants.length) {
    if (!selection.variant) issues.push({ code: "variant_required" });
    else {
      variant = product.variants.find((v) => v.ref === selection.variant) ?? null;
      if (!variant) issues.push({ code: "variant_invalid" });
    }
  } else if (selection.variant) {
    issues.push({ code: "variant_invalid" });
  }

  // Ekstralar: grup ürüne bağlı olmalı, ekstra o gruba ait olmalı, tekrar yok, en az / en fazla kuralı.
  const chosen: { group: CatalogGroup; modifier: CatalogModifier }[] = [];
  const seen = new Set<string>();
  for (const pick of selection.modifiers) {
    const group = product.groups.find((g) => g.ref === pick.group);
    if (!group) {
      issues.push({ code: "group_invalid" });
      continue;
    }
    const modifier = group.modifiers.find((m) => m.ref === pick.modifier);
    if (!modifier) {
      issues.push({ code: "modifier_invalid" });
      continue;
    }
    const key = `${group.ref}:${modifier.ref}`;
    if (seen.has(key)) {
      issues.push({ code: "duplicate_modifier" });
      continue;
    }
    seen.add(key);
    chosen.push({ group, modifier });
  }
  // Kopyalar ve özetler menüdeki grup / ekstra sırasıyla tutulur (müşterinin dokunma sırasından bağımsız).
  const rank = (c: { group: CatalogGroup; modifier: CatalogModifier }) => product.groups.indexOf(c.group) * 1000 + c.group.modifiers.indexOf(c.modifier);
  chosen.sort((a, b) => rank(a) - rank(b));
  for (const group of product.groups) {
    const count = chosen.filter((c) => c.group.ref === group.ref).length;
    const min = group.required ? Math.max(1, group.minSelect) : group.minSelect;
    const max = Math.min(group.maxSelect, group.modifiers.length);
    if (count < min) issues.push({ code: "group_min", group: group.name, min });
    if (count > max) issues.push({ code: "group_max", group: group.name, max });
  }

  const basePriceMinor = variant ? variant.priceMinor : product.basePriceMinor;
  const modifiersTotalMinor = chosen.reduce((sum, c) => sum + Math.max(0, c.modifier.priceDeltaMinor), 0);
  const unitPriceMinor = basePriceMinor + modifiersTotalMinor;
  const validQuantity = issues.some((i) => i.code === "quantity_invalid") ? 0 : quantity;

  // Fiyat farkı yalnızca GEÇERLİ bir yapılandırma için anlamlıdır (geçersiz seçimin fiyatı karşılaştırılmaz).
  if (options.checkExpectedPrice && issues.length === 0 && selection.expectedUnitPriceMinor != null && selection.expectedUnitPriceMinor !== unitPriceMinor) {
    issues.push({ code: "price_changed", fromMinor: selection.expectedUnitPriceMinor, toMinor: unitPriceMinor });
  }

  return {
    index,
    product,
    variant,
    modifiers: chosen,
    basePriceMinor,
    modifiersTotalMinor,
    unitPriceMinor,
    quantity,
    lineTotalMinor: unitPriceMinor * validQuantity,
    note: selection.note,
    issues,
  };
}

export function calculateOrder(catalog: OrderCatalog, items: readonly ItemSelection[], options: { checkExpectedPrice?: boolean } = {}): OrderCalculation {
  const orderIssues: OrderCalculation["orderIssues"] = [];
  if (items.length === 0) orderIssues.push("empty");
  if (items.length > ORDER_LIMITS.maxLines) orderIssues.push("too_many_lines");
  const lines = items.slice(0, ORDER_LIMITS.maxLines).map((item, i) => calculateLine(catalog.get(item.product), item, i, options));
  const itemCount = lines.reduce((n, l) => n + (Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 0), 0);
  if (itemCount > ORDER_LIMITS.maxTotalQuantity) orderIssues.push("too_many_items");
  const currencies = new Set(lines.flatMap((l) => (l.product ? [l.product.currency] : [])));
  if (currencies.size > 1) orderIssues.push("mixed_currency");
  const subtotalMinor = lines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  return {
    lines,
    currency: currencies.size === 1 ? [...currencies][0]! : null,
    subtotalMinor,
    // Vergi / servis bedeli sistemi yok: toplam = ara toplam (ücret uydurulmaz).
    totalMinor: subtotalMinor,
    itemCount,
    orderIssues,
    ok: orderIssues.length === 0 && lines.every((l) => l.issues.length === 0),
  };
}

/** Bir seçim için varsayılan ön seçim (yalnızca istemci arayüzü): varsayılan varyant. Ekstralar seçilmez. */
export function defaultVariantRef(product: CatalogProduct): string | null {
  if (!product.variants.length) return null;
  return (product.variants.find((v) => v.isDefault) ?? product.variants[0]!).ref;
}

/**
 * Ödeme dağıtım matematiği — SAF, tamsayı kuruş, kayan nokta yok. Her fonksiyon toplamı KURUŞU KURUŞUNA korur.
 */

/** Eşit bölme: 10001 / 3 → [3334, 3334, 3333]. Kalan ilk paylara birer kuruş dağıtılır (toplam aynen korunur). */
export function splitEqually(totalMinor: number, parts: number): number[] {
  if (!Number.isInteger(totalMinor) || totalMinor < 0 || !Number.isInteger(parts) || parts < 1) return [];
  const base = Math.floor(totalMinor / parts);
  const rest = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Orantılı dağıtım (en büyük kalan yöntemi): ağırlıklara göre `total`'ı tamsayılara böler; toplam = total. Eşit kalan
 * kesirlerde düşük indeks önce (deterministik).
 */
export function allocateProportionally(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) * total) / sum);
  const floors = raw.map((r) => Math.floor(r));
  let left = total - floors.reduce((s, f) => s + f, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i]! += 1;
    left--;
  }
  return floors;
}

export type OrderLineSnapshot = { id: string; name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number };
export type PromotionSnapshot = { promotionType: "FIXED_AMOUNT" | "PERCENTAGE" | "FREE_ITEM"; discountMinor: number; freeItemName: string | null } | null;
export type LinePayable = { id: string; name: string; quantity: number; payableMinor: number; unitPayables: number[] };

/**
 * Kalem bazında ÖDENECEK tutar (sipariş anındaki DEĞİŞMEZ kopyalardan; canlı menü fiyatı kullanılmaz). Kural:
 *   - İndirim yoksa: kalem tutarı.
 *   - Ücretsiz ürün promosyonu: indirim ücretsiz kalemin İLK birimine yazılır (o birim 0; başka ödeyen bu indirimi
 *     taşımaz). Eşleşen kalem bulunamazsa orantılı kurala düşülür.
 *   - Diğer (sabit / yüzde / ödül): indirim, indirim ÖNCESİ kalem tutarlarıyla ORANTILI dağıtılır (en büyük kalan).
 * Birim payları: kalem tutarı adede eşit bölünür, kalan ilk birimlere. Garanti: Σ kalem = sipariş toplamı.
 */
export function linePayables(lines: readonly OrderLineSnapshot[], promotion: PromotionSnapshot): LinePayable[] {
  const discount = promotion?.discountMinor ?? 0;
  const lineDiscounts = new Array<number>(lines.length).fill(0);
  if (discount > 0) {
    const freeIdx = promotion?.promotionType === "FREE_ITEM" ? lines.findIndex((l) => l.name === promotion.freeItemName && l.unitPriceMinor === discount) : -1;
    if (freeIdx >= 0) lineDiscounts[freeIdx] = discount;
    else allocateProportionally(lines.map((l) => l.lineTotalMinor), discount).forEach((d, i) => (lineDiscounts[i] = d));
  }
  return lines.map((l, i) => {
    const payable = Math.max(0, l.lineTotalMinor - lineDiscounts[i]!);
    const freeIdx = promotion?.promotionType === "FREE_ITEM" && lineDiscounts[i] === l.unitPriceMinor && lineDiscounts[i]! > 0;
    // Ücretsiz birim 0, kalan birimler tam fiyat; aksi halde eşit bölme.
    const unitPayables = freeIdx ? [0, ...new Array<number>(Math.max(0, l.quantity - 1)).fill(l.unitPriceMinor)] : splitEqually(payable, l.quantity);
    return { id: l.id, name: l.name, quantity: l.quantity, payableMinor: payable, unitPayables };
  });
}

/** Kalemin [alreadyAllocated, alreadyAllocated + qty) birimlerinin tutarı (birimler sırayla ödenir — deterministik). */
export function unitsAmount(line: Pick<LinePayable, "unitPayables">, alreadyAllocated: number, qty: number): number {
  return line.unitPayables.slice(alreadyAllocated, alreadyAllocated + qty).reduce((s, v) => s + v, 0);
}

import { confidenceFor, isMeaningfulChange, pctChange, score } from "@/lib/advisor/stats";
import { THRESHOLDS } from "@/lib/advisor/thresholds";
import type { AdvisorFacts, InsightCandidate } from "@/lib/advisor/types";

/**
 * Ürün ivmesi: adedi önceki döneme göre en çok artan / azalan ürün. Düşük hacim bastırılır (1 → 2 "%100" olmaz).
 * Arşivlenmiş / silinmiş ürünlerin düşüşü içgörü üretmez (işletme zaten kaldırmış).
 */
export function productMomentum(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.productMomentum;
  const rows: InsightCandidate[] = [];
  for (const c of f.current.products) {
    const p = f.previous.products.find((x) => x.key === c.key);
    const prevQty = p?.quantity ?? 0;
    if (c.quantity + prevQty < t.minCombined || prevQty < t.minPrevious) continue;
    if (!isMeaningfulChange({ current: c.quantity, previous: prevQty, currentN: c.quantity + prevQty, previousN: prevQty, minSamples: t.minPrevious, minPct: t.minPct, minAbs: t.minAbs })) continue;
    const pct = pctChange(c.quantity, prevQty)!;
    if (pct < 0 && (c.archived || c.deleted)) continue;
    const severity = pct > 0 ? "OPPORTUNITY" : "ATTENTION";
    const confidence = confidenceFor({ n: Math.min(c.quantity, prevQty), min: t.minPrevious });
    rows.push({
      type: "PRODUCT_MOMENTUM",
      category: "MENU",
      severity,
      confidence,
      subjectKey: c.key,
      subject: c.name,
      facts: { product: c.name, currentQty: c.quantity, previousQty: prevQty, deltaPct: pct, direction: pct > 0 ? "up" : "down", archived: c.archived ? "yes" : "no" },
      metrics: [
        { label: `${c.name} adet`, current: c.quantity, previous: prevQty, unit: "count" },
        { label: "Sipariş tutarı katkısı", current: c.totalMinor, previous: p?.totalMinor ?? 0, unit: "money" },
      ],
      score: score(severity, confidence, pct),
      tab: "products",
      actions: pct > 0 ? ["REVIEW_MENU_PLACEMENT", "MONITOR"] : ["REVIEW_MENU_PLACEMENT"],
    });
  }
  const up = rows.filter((r) => r.facts.direction === "up").sort((a, b) => b.score - a.score)[0];
  const down = rows.filter((r) => r.facts.direction === "down").sort((a, b) => b.score - a.score)[0];
  return [up, down].filter((r): r is InsightCandidate => !!r);
}

/**
 * Menü karması (maliyet verisi YOK → kârlılık / marj söylenmez): adet payı ile sipariş tutarı katkı payı karşılaştırılır.
 *   - Yüksek adet / görece düşük katkı → fiyatlandırma ya da paketleme ayrıca incelenebilir (kesin fiyat önerisi yok)
 *   - Düşük adet / görece yüksek katkı → menüdeki görünürlük gözden geçirilebilir
 */
export function menuMix(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.menuMix;
  const live = f.current.products.filter((p) => !p.archived && !p.deleted);
  const totalQty = live.reduce((s, p) => s + p.quantity, 0);
  const totalValue = live.reduce((s, p) => s + p.totalMinor, 0);
  if (totalQty < t.minItems || totalValue <= 0) return [];
  const confidence = confidenceFor({ n: totalQty, min: t.minItems, hasBaseline: false });
  const out: InsightCandidate[] = [];
  const withShares = live.map((p) => ({ p, qtyShare: p.quantity / totalQty, valueShare: p.totalMinor / totalValue }));
  const high = withShares
    .filter((x) => x.p.quantity >= t.minProductQty && x.qtyShare >= t.highQtyShare && x.valueShare / x.qtyShare <= t.lowValueRatio)
    .sort((a, b) => b.qtyShare - a.qtyShare)[0];
  if (high) {
    out.push({
      type: "MENU_HIGH_QTY_LOW_VALUE",
      category: "MENU",
      severity: "OPPORTUNITY",
      confidence,
      subjectKey: high.p.key,
      subject: high.p.name,
      facts: { product: high.p.name, quantity: high.p.quantity, qtySharePct: Math.round(high.qtyShare * 100), valueSharePct: Math.round(high.valueShare * 100), totalItems: totalQty },
      metrics: [
        { label: "Adet payı", current: high.qtyShare, unit: "share", note: `${high.p.quantity} / ${totalQty} ürün` },
        { label: "Sipariş tutarı katkı payı", current: high.valueShare, unit: "share" },
      ],
      score: score("OPPORTUNITY", confidence, (high.qtyShare - high.valueShare) * 200),
      tab: "products",
      actions: ["REVIEW_PRICING_STRATEGY", "REVIEW_MENU_PLACEMENT"],
    });
  }
  const low = withShares
    .filter((x) => x.p.quantity >= t.minLowQty && x.qtyShare <= t.lowQtyShare && x.valueShare >= t.minValueShare && x.valueShare / x.qtyShare >= t.highValueRatio)
    .sort((a, b) => b.valueShare - a.valueShare)[0];
  if (low) {
    out.push({
      type: "MENU_LOW_QTY_HIGH_VALUE",
      category: "MENU",
      severity: "OPPORTUNITY",
      confidence,
      subjectKey: low.p.key,
      subject: low.p.name,
      facts: { product: low.p.name, quantity: low.p.quantity, qtySharePct: Math.round(low.qtyShare * 100), valueSharePct: Math.round(low.valueShare * 100), totalItems: totalQty },
      metrics: [
        { label: "Adet payı", current: low.qtyShare, unit: "share", note: `${low.p.quantity} / ${totalQty} ürün` },
        { label: "Sipariş tutarı katkı payı", current: low.valueShare, unit: "share" },
      ],
      score: score("OPPORTUNITY", confidence, (low.valueShare - low.qtyShare) * 200),
      tab: "products",
      actions: ["REVIEW_MENU_PLACEMENT"],
    });
  }
  return out;
}

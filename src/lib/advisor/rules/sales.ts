import { confidenceFor, isMeaningfulChange, pctChange, robustZ, score } from "@/lib/advisor/stats";
import { THRESHOLDS } from "@/lib/advisor/thresholds";
import type { AdvisorFacts, InsightCandidate } from "@/lib/advisor/types";

/** Sipariş adedi önceki eşdeğer döneme göre anlamlı değişti mi? (Sipariş Tutarı gelir değildir.) */
export function orderVolumeChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.orderVolume;
  const cur = f.current.orders.salesOrders;
  const prev = f.previous.orders.salesOrders;
  if (!isMeaningfulChange({ current: cur, previous: prev, currentN: cur, previousN: prev, minSamples: t.minSamples, minPct: t.minPct, minAbs: t.minAbs })) return [];
  const pct = pctChange(cur, prev)!;
  const severity = pct < 0 ? "ATTENTION" : "INFO";
  const confidence = confidenceFor({ n: Math.min(cur, prev), min: t.minSamples });
  return [
    {
      type: "ORDER_VOLUME_CHANGE",
      category: "SALES",
      severity,
      confidence,
      subjectKey: "",
      subject: null,
      facts: { currentOrders: cur, previousOrders: prev, deltaPct: pct, currentSalesMinor: f.current.orders.salesMinor, previousSalesMinor: f.previous.orders.salesMinor },
      metrics: [
        { label: "Sipariş sayısı", current: cur, previous: prev, unit: "count" },
        { label: "Sipariş Tutarı", current: f.current.orders.salesMinor, previous: f.previous.orders.salesMinor, unit: "money" },
      ],
      score: score(severity, confidence, pct),
      tab: "overview",
      actions: pct < 0 ? ["MONITOR", "REVIEW_MENU_PLACEMENT"] : ["REVIEW_CAPACITY", "MONITOR"],
    },
  ];
}

/** Ortalama sipariş (sipariş tutarı / sipariş) değişimi. */
export function averageOrderChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.averageOrder;
  const { salesOrders: cn, salesMinor: cs } = f.current.orders;
  const { salesOrders: pn, salesMinor: ps } = f.previous.orders;
  if (cn < t.minSamples || pn < t.minSamples) return [];
  const cur = Math.round(cs / cn);
  const prev = Math.round(ps / pn);
  if (!isMeaningfulChange({ current: cur, previous: prev, currentN: cn, previousN: pn, minSamples: t.minSamples, minPct: t.minPct })) return [];
  const pct = pctChange(cur, prev)!;
  const severity = pct < 0 ? "ATTENTION" : "OPPORTUNITY";
  const confidence = confidenceFor({ n: Math.min(cn, pn), min: t.minSamples });
  return [
    {
      type: "AVERAGE_ORDER_CHANGE",
      category: "SALES",
      severity,
      confidence,
      subjectKey: "",
      subject: null,
      facts: { currentAverageMinor: cur, previousAverageMinor: prev, deltaPct: pct, currentOrders: cn, previousOrders: pn },
      metrics: [
        { label: "Ortalama Sipariş", current: cur, previous: prev, unit: "money" },
        { label: "Sipariş sayısı", current: cn, previous: pn, unit: "count" },
      ],
      score: score(severity, confidence, pct),
      tab: "overview",
      actions: ["REVIEW_MENU_PLACEMENT", "MONITOR"],
    },
  ];
}

/**
 * Basit sağlam anomali: son TAM günün sipariş sayısı, önceki günlerin medyan / MAD tabanına göre aykırı mı?
 * Hafta içi / hafta sonu mevsimselliği modellenmez (bilinen sınır) — eşik bu yüzden yüksek (z ≥ 3,5).
 */
export function orderDayAnomaly(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.dayAnomaly;
  const days = f.detail.daily;
  if (days.length < t.minDays + 1) return [];
  const last = days[days.length - 1]!;
  const baseline = days.slice(0, -1).map((d) => d.orders);
  const r = robustZ(last.orders, baseline);
  if (!r || r.median < t.minBaselineMedian || Math.abs(r.z) < t.robustZ) return [];
  const severity = r.z < 0 ? "ATTENTION" : "INFO";
  const confidence = confidenceFor({ n: baseline.length, min: t.minDays, hasBaseline: true });
  return [
    {
      type: "ORDER_DAY_ANOMALY",
      category: "SALES",
      severity,
      confidence,
      subjectKey: last.day,
      subject: last.day,
      facts: { day: last.day, dayOrders: last.orders, baselineMedian: r.median, baselineDays: baseline.length, robustZ: r.z },
      metrics: [
        { label: `Sipariş (${last.day})`, current: last.orders, unit: "count" },
        { label: `Önceki ${baseline.length} günün medyanı`, current: r.median, unit: "count" },
        { label: "Sağlam z-puanı (MAD)", current: r.z, unit: "score", note: "|z| ≥ 3,5 aykırı kabul edilir" },
      ],
      score: score(severity, confidence, Math.abs(r.z) * 10),
      tab: "overview",
      actions: ["MONITOR"],
    },
  ];
}

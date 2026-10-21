import { confidenceFor, isMeaningfulChange, pctChange, score } from "@/lib/advisor/stats";
import { THRESHOLDS } from "@/lib/advisor/thresholds";
import type { AdvisorFacts, InsightCandidate } from "@/lib/advisor/types";

const NO_AREA = "Bölgesiz";

/** Servis talebi yanıt süresi (oluşturma → üstlenme) medyan değişimi. Personel adı / sıralaması YOK. */
export function serviceResponseChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.serviceResponse;
  const c = f.current.service.response;
  const p = f.previous.service.response;
  if (c.medianMs === null || p.medianMs === null) return [];
  if (!isMeaningfulChange({ current: c.medianMs, previous: p.medianMs, currentN: c.count, previousN: p.count, minSamples: t.minSamples, minPct: t.minPct, minAbs: t.minAbsMs })) return [];
  const pct = pctChange(c.medianMs, p.medianMs)!;
  const severity = pct > 0 ? "ATTENTION" : "INFO";
  const confidence = confidenceFor({ n: Math.min(c.count, p.count), min: t.minSamples, spread: c.p90Ms && c.medianMs ? c.p90Ms / c.medianMs : null });
  return [
    {
      type: "SERVICE_RESPONSE_CHANGE",
      category: "SERVICE",
      severity,
      confidence,
      subjectKey: "",
      subject: null,
      facts: { currentMedianMs: c.medianMs, previousMedianMs: p.medianMs, deltaPct: pct, currentRequests: c.count, previousRequests: p.count },
      metrics: [
        { label: "Medyan yanıt süresi", current: c.medianMs, previous: p.medianMs, unit: "duration" },
        { label: "Yanıtlanan talep", current: c.count, previous: p.count, unit: "count" },
      ],
      score: score(severity, confidence, pct),
      tab: "service",
      actions: pct > 0 ? ["REVIEW_SERVICE_COVERAGE", "MONITOR"] : ["MONITOR"],
    },
  ];
}

/** Bölgeler arası servis yanıtı farkı: en yavaş bölge, diğer bölgelerin medyanından belirgin uzun mu? */
export function areaServiceGap(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.areaServiceGap;
  const areas = f.detail.serviceAreas.filter((a) => a.n >= t.minPerArea && a.medianMs !== null);
  if (areas.length < 2) return [];
  const sorted = [...areas].sort((a, b) => b.medianMs! - a.medianMs!);
  const slow = sorted[0]!;
  const fast = sorted[sorted.length - 1]!;
  const pct = pctChange(slow.medianMs!, fast.medianMs!);
  if (pct === null || pct < t.minPctGap || slow.medianMs! - fast.medianMs! < t.minAbsMs) return [];
  const confidence = confidenceFor({ n: Math.min(slow.n, fast.n), min: t.minPerArea, hasBaseline: true });
  const slowName = slow.area ?? NO_AREA;
  const fastName = fast.area ?? NO_AREA;
  return [
    {
      type: "AREA_SERVICE_GAP",
      category: "TABLES",
      severity: "ATTENTION",
      confidence,
      subjectKey: slowName,
      subject: slowName,
      facts: { slowArea: slowName, slowMedianMs: slow.medianMs, slowRequests: slow.n, fastArea: fastName, fastMedianMs: fast.medianMs, fastRequests: fast.n, gapPct: pct },
      metrics: [
        { label: `${slowName} medyan yanıt`, current: slow.medianMs, unit: "duration", note: `${slow.n} talep` },
        { label: `${fastName} medyan yanıt`, current: fast.medianMs, unit: "duration", note: `${fast.n} talep` },
      ],
      score: score("ATTENTION", confidence, pct),
      tab: "service",
      actions: ["REVIEW_SERVICE_COVERAGE"],
    },
  ];
}

/** Bölge bazında sipariş adedi değişimi (en belirgin bölge). Masa hareketi müşteri memnuniyeti DEĞİLDİR. */
export function areaOrderChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.areaOrders;
  const out: InsightCandidate[] = [];
  for (const c of f.current.areas) {
    const p = f.previous.areas.find((a) => a.area === c.area);
    if (!p) continue;
    if (!isMeaningfulChange({ current: c.orders, previous: p.orders, currentN: c.orders, previousN: p.orders, minSamples: t.minSamples, minPct: t.minPct, minAbs: t.minAbs })) continue;
    const pct = pctChange(c.orders, p.orders)!;
    const severity = pct > 0 ? "INFO" : "ATTENTION";
    const confidence = confidenceFor({ n: Math.min(c.orders, p.orders), min: t.minSamples });
    const name = c.area ?? NO_AREA;
    out.push({
      type: "AREA_ORDER_CHANGE",
      category: "TABLES",
      severity,
      confidence,
      subjectKey: name,
      subject: name,
      facts: { area: name, currentOrders: c.orders, previousOrders: p.orders, deltaPct: pct },
      metrics: [{ label: `${name} sipariş`, current: c.orders, previous: p.orders, unit: "count" }],
      score: score(severity, confidence, pct) * 0.9,
      tab: "tables",
      actions: pct > 0 ? ["REVIEW_SERVICE_COVERAGE", "MONITOR"] : ["MONITOR"],
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 1);
}

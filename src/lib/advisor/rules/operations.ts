import { confidenceFor, isMeaningfulChange, pctChange, score } from "@/lib/advisor/stats";
import { THRESHOLDS } from "@/lib/advisor/thresholds";
import type { AdvisorFacts, InsightCandidate } from "@/lib/advisor/types";

/** Ret oranı (reddedilen / gönderilen) yüzde puanı değişimi. */
export function rejectionRateChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.rejectionRate;
  const c = f.current.orders;
  const p = f.previous.orders;
  if (c.submitted < t.minSamples || p.submitted < t.minSamples) return [];
  const cr = (c.rejected / c.submitted) * 100;
  const pr = (p.rejected / p.submitted) * 100;
  const pp = Math.round((cr - pr) * 10) / 10;
  if (Math.abs(pp) < t.minPp) return [];
  const severity = pp > 0 ? "ATTENTION" : "INFO";
  const confidence = confidenceFor({ n: Math.min(c.submitted, p.submitted), min: t.minSamples });
  return [
    {
      type: "REJECTION_RATE_CHANGE",
      category: "OPERATIONS",
      severity,
      confidence,
      subjectKey: "",
      subject: null,
      facts: { currentRatePct: Math.round(cr), previousRatePct: Math.round(pr), deltaPp: Math.round(pp), currentRejected: c.rejected, currentSubmitted: c.submitted, previousRejected: p.rejected, previousSubmitted: p.submitted },
      metrics: [
        { label: "Ret oranı", current: Math.round(cr), previous: Math.round(pr), unit: "percent" },
        { label: "Reddedilen / gönderilen", current: c.rejected, previous: p.rejected, unit: "count", note: `${c.submitted} / ${p.submitted} gönderilen` },
      ],
      score: score(severity, confidence, pp * 3),
      tab: "overview",
      actions: ["REVIEW_MENU_PLACEMENT", "MONITOR"],
    },
  ];
}

/** Medyan hazırlama süresi (kabul → hazır) değişimi. */
export function prepTimeChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.prepTime;
  const c = f.current.preparation;
  const p = f.previous.preparation;
  if (c.medianMs === null || p.medianMs === null) return [];
  if (!isMeaningfulChange({ current: c.medianMs, previous: p.medianMs, currentN: c.count, previousN: p.count, minSamples: t.minSamples, minPct: t.minPct, minAbs: t.minAbsMs })) return [];
  const pct = pctChange(c.medianMs, p.medianMs)!;
  const severity = pct > 0 ? "ATTENTION" : "INFO";
  const spread = c.p90Ms && c.medianMs ? c.p90Ms / c.medianMs : null;
  const confidence = confidenceFor({ n: Math.min(c.count, p.count), min: t.minSamples, spread });
  return [
    {
      type: "PREP_TIME_CHANGE",
      category: "OPERATIONS",
      severity,
      confidence,
      subjectKey: "",
      subject: null,
      facts: { currentMedianMs: c.medianMs, previousMedianMs: p.medianMs, deltaPct: pct, currentP90Ms: c.p90Ms, currentOrders: c.count, previousOrders: p.count },
      metrics: [
        { label: "Medyan hazırlama", current: c.medianMs, previous: p.medianMs, unit: "duration" },
        { label: "p90 hazırlama", current: c.p90Ms, previous: p.p90Ms, unit: "duration" },
        { label: "Sipariş (örneklem)", current: c.count, previous: p.count, unit: "count" },
      ],
      score: score(severity, confidence, pct),
      tab: "operations",
      actions: pct > 0 ? ["REVIEW_CAPACITY", "REVIEW_STATION_LOAD"] : ["MONITOR"],
    },
  ];
}

/**
 * Yoğun saat penceresi: 2 saatlik pencerenin medyan hazırlama süresi, dönemin genel medyanından belirgin yüksek mi?
 * Pencerede en uzun hazırlayan istasyon bağlam olarak eklenir (yalnızca örneklem yeterliyse).
 */
export function peakPrepWindow(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.peakPrepWindow;
  const overall = f.current.preparation;
  if (overall.medianMs === null || overall.count < t.minOverallSamples) return [];
  const eligible = f.detail.prepWindows.filter((w) => w.n >= t.minWindowSamples && w.medianMs !== null);
  if (eligible.length === 0) return [];
  const worst = eligible.reduce((a, b) => (b.medianMs! > a.medianMs! ? b : a));
  const pct = pctChange(worst.medianMs!, overall.medianMs)!;
  if (pct < t.minPctAbove || worst.medianMs! - overall.medianMs < t.minAbsMs) return [];
  const station = f.detail.stationWindows
    .filter((s) => s.startHour === worst.startHour && s.n >= t.minWindowSamples / 2 && s.medianMs !== null)
    .sort((a, b) => b.medianMs! - a.medianMs!)[0];
  const confidence = confidenceFor({ n: worst.n, min: t.minWindowSamples, hasBaseline: true });
  return [
    {
      type: "PEAK_PREP_WINDOW",
      category: "KDS",
      severity: "ATTENTION",
      confidence,
      subjectKey: String(worst.startHour),
      subject: null,
      facts: {
        startHour: worst.startHour,
        endHour: (worst.startHour + 2) % 24,
        windowMedianMs: worst.medianMs,
        overallMedianMs: overall.medianMs,
        deltaPct: pct,
        windowOrders: worst.n,
        overallOrders: overall.count,
        station: station?.station ?? null,
        stationMedianMs: station?.medianMs ?? null,
        stationTickets: station?.n ?? null,
      },
      metrics: [
        { label: "Pencere medyan hazırlama", current: worst.medianMs, unit: "duration" },
        { label: "Dönem geneli medyan", current: overall.medianMs, unit: "duration" },
        { label: "Penceredeki sipariş", current: worst.n, unit: "count" },
        ...(station ? [{ label: `${station.station} istasyonu (pencere medyanı)`, current: station.medianMs, unit: "duration" as const, note: `${station.n} fiş` }] : []),
      ],
      score: score("ATTENTION", confidence, pct),
      tab: "operations",
      actions: ["REVIEW_CAPACITY", "REVIEW_STATION_LOAD"],
    },
  ];
}

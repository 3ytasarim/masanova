import { confidenceFor, isMeaningfulChange, pctChange, score } from "@/lib/advisor/stats";
import { THRESHOLDS } from "@/lib/advisor/thresholds";
import type { AdvisorFacts, InsightCandidate } from "@/lib/advisor/types";

/** İstasyon bazında medyan fiş süresi değişimi (en belirgin tek istasyon). Personel sıralaması YOK. */
export function stationPrepChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.stationPrep;
  const out: InsightCandidate[] = [];
  for (const c of f.current.stations) {
    const p = f.previous.stations.find((s) => s.name === c.name);
    if (!p || c.medianMs === null || p.medianMs === null) continue;
    if (!isMeaningfulChange({ current: c.medianMs, previous: p.medianMs, currentN: c.tickets, previousN: p.tickets, minSamples: t.minSamples, minPct: t.minPct, minAbs: t.minAbsMs })) continue;
    const pct = pctChange(c.medianMs, p.medianMs)!;
    const severity = pct > 0 ? "ATTENTION" : "INFO";
    const confidence = confidenceFor({ n: Math.min(c.tickets, p.tickets), min: t.minSamples, spread: c.p90Ms && c.medianMs ? c.p90Ms / c.medianMs : null });
    out.push({
      type: "STATION_PREP_CHANGE",
      category: "KDS",
      severity,
      confidence,
      subjectKey: c.name,
      subject: c.name,
      facts: { station: c.name, currentMedianMs: c.medianMs, previousMedianMs: p.medianMs, deltaPct: pct, currentP90Ms: c.p90Ms, currentTickets: c.tickets, previousTickets: p.tickets },
      metrics: [
        { label: "Medyan fiş süresi", current: c.medianMs, previous: p.medianMs, unit: "duration" },
        { label: "p90 fiş süresi", current: c.p90Ms, previous: p.p90Ms, unit: "duration" },
        { label: "Fiş", current: c.tickets, previous: p.tickets, unit: "count" },
      ],
      score: score(severity, confidence, pct),
      tab: "operations",
      actions: ["REVIEW_STATION_LOAD", "REVIEW_CAPACITY"],
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2);
}

/** Uzun kuyruk: p90, medyanın çok üzerinde (bazı fişler belirgin uzun sürüyor). Ortalamaya güvenilmez. */
export function stationTail(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.stationTail;
  const out: InsightCandidate[] = [];
  for (const s of f.current.stations) {
    if (s.tickets < t.minSamples || !s.medianMs || !s.p90Ms) continue;
    const ratio = Math.round((s.p90Ms / s.medianMs) * 10) / 10;
    if (ratio < t.minP90ToMedian || s.p90Ms - s.medianMs < t.minAbsMs) continue;
    const confidence = confidenceFor({ n: s.tickets, min: t.minSamples, hasBaseline: false });
    out.push({
      type: "STATION_TAIL",
      category: "KDS",
      severity: "ATTENTION",
      confidence,
      subjectKey: s.name,
      subject: s.name,
      facts: { station: s.name, medianMs: s.medianMs, p90Ms: s.p90Ms, ratio, tickets: s.tickets },
      metrics: [
        { label: "Medyan fiş süresi", current: s.medianMs, unit: "duration" },
        { label: "p90 fiş süresi", current: s.p90Ms, unit: "duration" },
        { label: "Fiş", current: s.tickets, unit: "count" },
      ],
      score: score("ATTENTION", confidence, (ratio - 1) * 40),
      tab: "operations",
      actions: ["REVIEW_STATION_LOAD"],
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 1);
}

/**
 * Çok istasyonlu darboğaz: birden fazla istasyona düşen siparişlerde EN SON hazır olan istasyon çoğunlukla aynı mı?
 */
export function stationBottleneck(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.bottleneck;
  const { multiStationOrders, lastReady } = f.detail.bottleneck;
  if (multiStationOrders < t.minMultiStationOrders || lastReady.length < 1) return [];
  const top = [...lastReady].sort((a, b) => b.count - a.count)[0]!;
  const share = top.count / multiStationOrders;
  if (share < t.minShare) return [];
  const station = f.current.stations.find((s) => s.name === top.station);
  const confidence = confidenceFor({ n: multiStationOrders, min: t.minMultiStationOrders, hasBaseline: false });
  return [
    {
      type: "STATION_BOTTLENECK",
      category: "KDS",
      severity: "ATTENTION",
      confidence,
      subjectKey: top.station,
      subject: top.station,
      facts: { station: top.station, lastReadyCount: top.count, multiStationOrders, sharePct: Math.round(share * 100), stationMedianMs: station?.medianMs ?? null },
      metrics: [
        { label: "Son hazır olan istasyon payı", current: share, unit: "share" },
        { label: `${top.station} son tamamlanan (sipariş)`, current: top.count, unit: "count" },
        { label: "Birden fazla istasyonlu sipariş", current: multiStationOrders, unit: "count" },
        ...(station ? [{ label: `${top.station} medyan fiş süresi`, current: station.medianMs, unit: "duration" as const }] : []),
      ],
      score: score("ATTENTION", confidence, share * 100),
      tab: "operations",
      actions: ["REVIEW_STATION_LOAD", "REVIEW_CAPACITY"],
    },
  ];
}

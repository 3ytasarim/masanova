import { confidenceFor, isMeaningfulChange, pctChange, score } from "@/lib/advisor/stats";
import { THRESHOLDS } from "@/lib/advisor/thresholds";
import type { AdvisorFacts, InsightCandidate } from "@/lib/advisor/types";

/**
 * AI kullanımı — yalnızca toplu sayılar (konuşma İÇERİĞİ hiçbir zaman okunmaz). AI → satış nedenselliği İDDİA EDİLMEZ.
 */
export function aiFallbackChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.aiFallback;
  const c = f.current.ai;
  const p = f.previous.ai;
  if (c.turns < t.minTurns || p.turns < t.minTurns) return [];
  const cr = Math.round((c.fallbackTurns / c.turns) * 100);
  const pr = Math.round((p.fallbackTurns / p.turns) * 100);
  const pp = cr - pr;
  if (pp < t.minPp) return [];
  const confidence = confidenceFor({ n: Math.min(c.turns, p.turns), min: t.minTurns });
  return [
    {
      type: "AI_FALLBACK_CHANGE",
      category: "AI_USAGE",
      severity: "ATTENTION",
      confidence,
      subjectKey: "",
      subject: null,
      facts: { currentRatePct: cr, previousRatePct: pr, deltaPp: pp, currentTurns: c.turns, previousTurns: p.turns },
      metrics: [
        { label: "Bas-konuşa düşen tur oranı", current: cr, previous: pr, unit: "percent" },
        { label: "Sesli tur", current: c.turns, previous: p.turns, unit: "count" },
      ],
      score: score("ATTENTION", confidence, pp * 3),
      tab: "ai",
      actions: ["REVIEW_AI_SETTINGS", "MONITOR"],
    },
  ];
}

export function aiFailureRate(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.aiFailure;
  const c = f.current.ai;
  const failed = c.failedTurns + c.providerErrors;
  if (c.turns < t.minTurns || failed < t.minFailed) return [];
  const rate = failed / (c.turns + c.providerErrors);
  if (rate < t.minRate) return [];
  const confidence = confidenceFor({ n: c.turns, min: t.minTurns, hasBaseline: false });
  return [
    {
      type: "AI_FAILURE_RATE",
      category: "AI_USAGE",
      severity: "ATTENTION",
      confidence,
      subjectKey: "",
      subject: null,
      facts: { failed, turns: c.turns, providerErrors: c.providerErrors, ratePct: Math.round(rate * 100) },
      metrics: [
        { label: "Başarısız tur / sağlayıcı hatası", current: failed, unit: "count" },
        { label: "Hata oranı", current: Math.round(rate * 100), unit: "percent" },
      ],
      score: score("ATTENTION", confidence, rate * 300),
      tab: "ai",
      actions: ["REVIEW_AI_SETTINGS"],
    },
  ];
}

export function aiUsageChange(f: AdvisorFacts): InsightCandidate[] {
  const t = THRESHOLDS.aiUsage;
  const c = f.current.ai.conversations;
  const p = f.previous.ai.conversations;
  if (!isMeaningfulChange({ current: c, previous: p, currentN: c, previousN: p, minSamples: t.minSamples, minPct: t.minPct, minAbs: t.minAbs })) return [];
  const pct = pctChange(c, p)!;
  const confidence = confidenceFor({ n: Math.min(c, p), min: t.minSamples });
  return [
    {
      type: "AI_USAGE_CHANGE",
      category: "AI_USAGE",
      severity: "INFO",
      confidence,
      subjectKey: "",
      subject: null,
      facts: { currentConversations: c, previousConversations: p, deltaPct: pct },
      metrics: [{ label: "AI konuşması", current: c, previous: p, unit: "count" }],
      score: score("INFO", confidence, pct) * 0.8,
      tab: "ai",
      actions: ["MONITOR"],
    },
  ];
}

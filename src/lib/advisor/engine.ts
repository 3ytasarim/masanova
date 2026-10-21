import { aiFailureRate, aiFallbackChange, aiUsageChange } from "@/lib/advisor/rules/ai";
import { stationBottleneck, stationPrepChange, stationTail } from "@/lib/advisor/rules/kds";
import { menuMix, productMomentum } from "@/lib/advisor/rules/menu";
import { peakPrepWindow, prepTimeChange, rejectionRateChange } from "@/lib/advisor/rules/operations";
import { averageOrderChange, orderDayAnomaly, orderVolumeChange } from "@/lib/advisor/rules/sales";
import { areaOrderChange, areaServiceGap, serviceResponseChange } from "@/lib/advisor/rules/service";
import { MAX_INSIGHTS } from "@/lib/advisor/thresholds";
import type { AdvisorFacts, InsightCandidate } from "@/lib/advisor/types";

/** Kural kaydı — her kural bağımsız test edilir; biri hata verirse diğerleri etkilenmez. */
export const RULES: readonly { name: string; run: (f: AdvisorFacts) => InsightCandidate[] }[] = [
  { name: "order-volume-change", run: orderVolumeChange },
  { name: "average-order-change", run: averageOrderChange },
  { name: "order-day-anomaly", run: orderDayAnomaly },
  { name: "rejection-rate-change", run: rejectionRateChange },
  { name: "prep-time-change", run: prepTimeChange },
  { name: "peak-prep-window", run: peakPrepWindow },
  { name: "station-prep-change", run: stationPrepChange },
  { name: "station-tail", run: stationTail },
  { name: "station-bottleneck", run: stationBottleneck },
  { name: "service-response-change", run: serviceResponseChange },
  { name: "area-service-gap", run: areaServiceGap },
  { name: "area-order-change", run: areaOrderChange },
  { name: "product-momentum", run: productMomentum },
  { name: "menu-mix", run: menuMix },
  { name: "ai-fallback-change", run: aiFallbackChange },
  { name: "ai-failure-rate", run: aiFailureRate },
  { name: "ai-usage-change", run: aiUsageChange },
];

/** Tüm kurallar → puana göre sıralı, en fazla MAX_INSIGHTS aday. Hata veren kural atlanır ve raporlanır. */
export function generateCandidates(facts: AdvisorFacts): { candidates: InsightCandidate[]; failedRules: string[] } {
  const all: InsightCandidate[] = [];
  const failedRules: string[] = [];
  for (const rule of RULES) {
    try {
      all.push(...rule.run(facts));
    } catch {
      failedRules.push(rule.name);
    }
  }
  return { candidates: all.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type)).slice(0, MAX_INSIGHTS), failedRules };
}

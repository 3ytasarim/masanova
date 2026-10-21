import { CONFIDENCE } from "@/lib/advisor/thresholds";
import type { Confidence } from "@/lib/advisor/types";

/** Yüzde değişim; taban 0 ya da geçersizse null (sıfır tabanından "sonsuz artış" üretilmez). */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Anlamlı değişim mi? Her iki dönemde en az örneklem + en az göreli VE mutlak değişim. Sıfır taban → hayır.
 */
export function isMeaningfulChange(input: { current: number; previous: number; currentN: number; previousN: number; minSamples: number; minPct: number; minAbs?: number }): boolean {
  const { current, previous, currentN, previousN, minSamples, minPct, minAbs = 0 } = input;
  if (currentN < minSamples || previousN < minSamples) return false;
  const pct = pctChange(current, previous);
  if (pct === null) return false;
  return Math.abs(pct) >= minPct && Math.abs(current - previous) >= minAbs;
}

/**
 * Veri kalitesi (deterministik): en küçük örneklem eşiğe göre; karşılaştırma tabanı yoksa en fazla ORTA;
 * geniş dağılım (p90 / medyan) bir seviye düşürür.
 */
export function confidenceFor(input: { n: number; min: number; hasBaseline?: boolean; spread?: number | null }): Confidence {
  const { n, min, hasBaseline = true, spread } = input;
  let level: Confidence = n >= min * CONFIDENCE.highFactor ? "HIGH" : n >= min * CONFIDENCE.mediumFactor ? "MEDIUM" : "LOW";
  if (!hasBaseline && level === "HIGH") level = "MEDIUM";
  if (spread != null && spread >= CONFIDENCE.wideSpreadRatio) level = level === "HIGH" ? "MEDIUM" : "LOW";
  return level;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Medyan mutlak sapma tabanlı sağlam z-puanı (MAD 0 → null: anlamlı ölçek yok). */
export function robustZ(value: number, baseline: readonly number[]): { z: number; median: number; mad: number } | null {
  const med = median(baseline);
  if (med === null) return null;
  const mad = median(baseline.map((v) => Math.abs(v - med)));
  if (!mad) return null;
  return { z: Math.round(((value - med) / (1.4826 * mad)) * 10) / 10, median: med, mad };
}

const CONF_WEIGHT: Record<Confidence, number> = { HIGH: 1, MEDIUM: 0.75, LOW: 0.45 };
const SEV_WEIGHT = { ATTENTION: 1.2, OPPORTUNITY: 1, INFO: 0.85 } as const;

/** Sıralama puanı: önem × güven × büyüklük (log ölçekli, aşırı değerler sıralamayı ezmesin). */
export function score(severity: keyof typeof SEV_WEIGHT, confidence: Confidence, magnitudePct: number): number {
  return Math.round(SEV_WEIGHT[severity] * CONF_WEIGHT[confidence] * Math.log10(10 + Math.abs(magnitudePct)) * 1000) / 1000;
}

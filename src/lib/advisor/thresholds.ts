/**
 * Danışman eşikleri — TEK yer (kurallarda sihirli sayı yok). Amaç gürültüyü bastırmak: küçük örneklemden
 * (1 → 2 satış = "%100 artış") güçlü bir eğilim içgörüsü ÜRETİLMEZ.
 *   minSamples   : her iki dönemde gereken en az gözlem
 *   minPct       : en az göreli değişim (%)
 *   minAbs       : en az mutlak değişim (birim: adet / ms / yüzde puanı)
 */
const MIN = 60_000;

export const THRESHOLDS = {
  orderVolume: { minSamples: 20, minPct: 15, minAbs: 5 },
  averageOrder: { minSamples: 20, minPct: 10 },
  dayAnomaly: { minDays: 14, minBaselineMedian: 5, robustZ: 3.5 },
  rejectionRate: { minSamples: 20, minPp: 5 },
  prepTime: { minSamples: 15, minPct: 15, minAbsMs: MIN },
  peakPrepWindow: { minWindowSamples: 12, minOverallSamples: 30, minPctAbove: 20, minAbsMs: MIN },
  stationPrep: { minSamples: 15, minPct: 20, minAbsMs: MIN },
  stationTail: { minSamples: 20, minP90ToMedian: 2.5, minAbsMs: 2 * MIN },
  bottleneck: { minMultiStationOrders: 15, minShare: 0.5 },
  serviceResponse: { minSamples: 12, minPct: 20, minAbsMs: 30_000 },
  areaServiceGap: { minPerArea: 8, minPctGap: 30, minAbsMs: 30_000 },
  areaOrders: { minSamples: 15, minPct: 25, minAbs: 5 },
  productMomentum: { minCombined: 20, minPrevious: 8, minAbs: 6, minPct: 25 },
  menuMix: { minItems: 50, minProductQty: 15, highQtyShare: 0.12, lowValueRatio: 0.65, lowQtyShare: 0.06, highValueRatio: 1.8, minValueShare: 0.06, minLowQty: 5 },
  aiFallback: { minTurns: 20, minPp: 10 },
  aiFailure: { minTurns: 20, minRate: 0.1, minFailed: 3 },
  aiUsage: { minSamples: 10, minPct: 30, minAbs: 5 },
} as const;

/** Güven seviyesi çarpanları: n ≥ 3×min → YÜKSEK, ≥ 1.5×min → ORTA, aksi DÜŞÜK; geniş dağılım bir seviye düşürür. */
export const CONFIDENCE = { highFactor: 3, mediumFactor: 1.5, wideSpreadRatio: 3 } as const;

/** Sayfada gösterilen en fazla içgörü ve "öne çıkanlar" adedi. */
export const MAX_INSIGHTS = 10;
export const HIGHLIGHTS = 4;
/** Danışman analiz aralıkları (yıllarca veri her istekte taranmaz). */
export const ADVISOR_RANGES = ["today", "last7", "last30"] as const;
export type AdvisorRange = (typeof ADVISOR_RANGES)[number];
export const DEFAULT_ADVISOR_RANGE: AdvisorRange = "last7";

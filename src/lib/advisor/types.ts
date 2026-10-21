/**
 * İşletme Danışmanı (Sprint 15) — ortak tipler. İçgörü motoru SAF ve deterministiktir: sunucu güvenilir analitik
 * özetlerini (`AdvisorFacts`) üretir, kurallar aday içgörüleri (`InsightCandidate`) çıkarır, AI yalnızca bu
 * adayları açıklar. Danışman SALT OKUNUR: hiçbir tip / araç veri değiştiremez.
 */
export const INSIGHT_CATEGORIES = ["SALES", "MENU", "OPERATIONS", "KDS", "SERVICE", "TABLES", "AI_USAGE"] as const;
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number];

export const INSIGHT_TYPES = [
  "ORDER_VOLUME_CHANGE",
  "AVERAGE_ORDER_CHANGE",
  "ORDER_DAY_ANOMALY",
  "REJECTION_RATE_CHANGE",
  "PREP_TIME_CHANGE",
  "PEAK_PREP_WINDOW",
  "STATION_PREP_CHANGE",
  "STATION_TAIL",
  "STATION_BOTTLENECK",
  "SERVICE_RESPONSE_CHANGE",
  "AREA_SERVICE_GAP",
  "AREA_ORDER_CHANGE",
  "PRODUCT_MOMENTUM",
  "MENU_HIGH_QTY_LOW_VALUE",
  "MENU_LOW_QTY_HIGH_VALUE",
  "AI_FALLBACK_CHANGE",
  "AI_FAILURE_RATE",
  "AI_USAGE_CHANGE",
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

/** Bilgi / Fırsat / Dikkat — acil durum dili yok. */
export type Severity = "INFO" | "OPPORTUNITY" | "ATTENTION";
/** Veri kalitesi — DETERMİNİSTİK hesaplanır (örneklem, karşılaştırma kapsamı, dağılım); AI belirlemez. */
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

/** Önerilebilecek eylem türleri (yalnızca öneri; hiçbiri sistemde değişiklik yapmaz). */
export type ActionType = "REVIEW_CAPACITY" | "REVIEW_STATION_LOAD" | "REVIEW_MENU_PLACEMENT" | "REVIEW_PRICING_STRATEGY" | "REVIEW_SERVICE_COVERAGE" | "MONITOR" | "REVIEW_AI_SETTINGS";

/** Analitik derin bağlantısı (Sprint 12 sekmesi). */
export type AnalyticsTab = "overview" | "products" | "tables" | "operations" | "service" | "ai";

export type MetricUnit = "count" | "money" | "duration" | "percent" | "share" | "score";
/** "Bu nasıl hesaplandı?" satırı — ham değer + birim (biçimlendirme sunumda). */
export type MetricRow = { label: string; current: number | null; previous?: number | null; unit: MetricUnit; note?: string };

export type InsightCandidate = {
  type: InsightType;
  category: InsightCategory;
  severity: Severity;
  confidence: Confidence;
  /** Aynı türün farklı öznesi (istasyon, ürün anahtarı, bölge) — kimliğin parçası. Yoksa "". */
  subjectKey: string;
  /** Kullanıcıya gösterilen özne adı (ör. "Izgara", "Cheeseburger", "Bahçe"). */
  subject: string | null;
  /** Kural girdileri — açıklama ve AI doğrulaması YALNIZCA bunlara dayanır. */
  facts: Record<string, number | string | null>;
  metrics: MetricRow[];
  /** Sıralama puanı (önem × güven × büyüklük). */
  score: number;
  tab: AnalyticsTab;
  actions: ActionType[];
};

export type DurationStats = { count: number; medianMs: number | null; p90Ms: number | null };

/** Bir dönemin danışman özetleri (Sprint 12 sorgularından; ham sipariş satırı DEĞİL). */
export type PeriodFacts = {
  orders: { salesOrders: number; salesMinor: number; itemsSold: number; submitted: number; rejected: number };
  preparation: DurationStats;
  acceptance: DurationStats;
  stations: { name: string; tickets: number; medianMs: number | null; p90Ms: number | null }[];
  products: { key: string; name: string; archived: boolean; deleted: boolean; quantity: number; totalMinor: number }[];
  service: { total: number; response: DurationStats };
  areas: { area: string | null; orders: number }[];
  ai: { conversations: number; turns: number; fallbackTurns: number; failedTurns: number; providerErrors: number };
};

/** Yalnızca mevcut dönem için ayrıntılar (saat penceresi, darboğaz, bölge yanıtı). */
export type CurrentDetailFacts = {
  /** Başlangıç saati h için [h, h+2) yerel saat penceresi. */
  prepWindows: { startHour: number; n: number; medianMs: number | null }[];
  stationWindows: { startHour: number; station: string; n: number; medianMs: number | null }[];
  bottleneck: { multiStationOrders: number; lastReady: { station: string; count: number }[] };
  serviceAreas: { area: string | null; n: number; medianMs: number | null }[];
  /** Son 28 tam günün günlük sipariş sayısı (eski → yeni) + son tam gün. */
  daily: { day: string; orders: number }[];
};

export type AdvisorFacts = {
  current: PeriodFacts;
  previous: PeriodFacts;
  detail: CurrentDetailFacts;
  currency: string;
};

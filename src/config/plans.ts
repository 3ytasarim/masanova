import type { TenantPlan } from "@prisma/client";

/**
 * Paket → özellik / limit eşlemesi — TEK doğruluk kaynağı (Sprint 20). Sunucu yetkilendirmesi
 * (`src/server/billing/entitlements.ts`), panel gezintisi, kiracı abonelik sayfası, Super Admin ve pazarlama paket kartları
 * bu tabloyu okur. Hiçbir yerde `plan === "PRO"` gibi doğrudan karşılaştırma yazılmaz; tek müşteriye özel istisna için
 * paket tanımı değil `EntitlementOverride` kullanılır.
 */
export const FEATURES = [
  "qr_menu",
  "tables",
  "qr_labels",
  "branding",
  "ordering",
  "kds",
  "preparation_stations",
  "service_requests",
  "analytics",
  "reservations",
  "crm",
  "loyalty",
  "promotions",
  "restaurant_payments",
  "voice_ai",
  "business_advisor",
  "cashier_screen",
] as const;

export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  qr_menu: "QR menü",
  tables: "Masa yönetimi",
  qr_labels: "Baskıya hazır QR etiketleri",
  branding: "Tema ve marka",
  ordering: "Masadan sipariş",
  kds: "Mutfak ekranı (KDS)",
  preparation_stations: "Hazırlık istasyonları",
  service_requests: "Garson çağrısı ve servis talepleri",
  analytics: "Analitik",
  reservations: "Rezervasyon",
  crm: "Müşteriler (CRM)",
  loyalty: "Sadakat programı",
  promotions: "Kupon, ödül ve kampanyalar",
  restaurant_payments: "Online ödeme ve kasa kaydı",
  voice_ai: "Sesli AI asistan",
  business_advisor: "AI İşletme Danışmanı",
  cashier_screen: "Kasa ve adisyon ekranı",
};

const STARTER: readonly Feature[] = ["qr_menu", "tables", "qr_labels", "branding"];
/** Small: menüyü anlatan sesli asistan — sepet / sipariş / servis talebi YOK (asistan yalnızca bilgi verir). */
const VOICE_MENU: readonly Feature[] = [...STARTER, "voice_ai"];
const PRO: readonly Feature[] = [
  ...STARTER,
  "ordering",
  "kds",
  "preparation_stations",
  "service_requests",
  "analytics",
  "reservations",
  "crm",
  "loyalty",
  "promotions",
  "restaurant_payments",
];
const AI: readonly Feature[] = [...PRO, "voice_ai", "business_advisor", "cashier_screen"];

/**
 * Limit anahtarları. `null` = sınırsız. Aylık AI limitleri abonelik dönemine (yoksa takvim ayına, UTC) göre sayılır.
 *   maxMenuProducts: ARŞİVLENMEMİŞ ürünler · maxStaffUsers: etkin kullanıcılar (sahip dahil)
 *   maxMonthlyAiMinutes: sesli konuşma süresi (girdi + çıktı ses) · maxMonthlyAiReplies: AI yanıtı (yazılı + sesli)
 */
export const LIMIT_KEYS = ["maxBranches", "maxTables", "maxMenuProducts", "maxStaffUsers", "maxMediaBytes", "maxMonthlyAiMinutes", "maxMonthlyAiReplies", "maxMonthlyAdvisorRuns"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type PlanLimits = Record<LimitKey, number | null>;

export const LIMIT_LABELS: Record<LimitKey, string> = {
  maxBranches: "Şube",
  maxTables: "Masa",
  maxMenuProducts: "Menü ürünü",
  maxStaffUsers: "Personel hesabı",
  maxMediaBytes: "Görsel depolama",
  maxMonthlyAiMinutes: "Aylık sesli AI dakikası",
  maxMonthlyAiReplies: "Aylık AI yanıtı",
  maxMonthlyAdvisorRuns: "Aylık Danışman yenilemesi",
};

const MB = 1024 * 1024;
/**
 * GEÇİCİ (PROVISIONAL) limitler — ticari karar DEĞİLDİR, pazarlamada gösterilmez. İşletme kararı verilince yalnızca
 * bu tablo değişir; tek müşteri istisnası EntitlementOverride ile yapılır. Mevcut kayıtlar limit düşse de SİLİNMEZ.
 */
const LIMITS: Record<TenantPlan, PlanLimits> = {
  STARTER: { maxBranches: 1, maxTables: 50, maxMenuProducts: 300, maxStaffUsers: 5, maxMediaBytes: 500 * MB, maxMonthlyAiMinutes: 0, maxMonthlyAiReplies: 0, maxMonthlyAdvisorRuns: 0 },
  VOICE_MENU: { maxBranches: 1, maxTables: 50, maxMenuProducts: 300, maxStaffUsers: 5, maxMediaBytes: 500 * MB, maxMonthlyAiMinutes: 300, maxMonthlyAiReplies: 5000, maxMonthlyAdvisorRuns: 0 },
  PRO: { maxBranches: 5, maxTables: null, maxMenuProducts: null, maxStaffUsers: 50, maxMediaBytes: 5 * 1024 * MB, maxMonthlyAiMinutes: 0, maxMonthlyAiReplies: 0, maxMonthlyAdvisorRuns: 0 },
  AI: { maxBranches: 5, maxTables: null, maxMenuProducts: null, maxStaffUsers: 50, maxMediaBytes: 5 * 1024 * MB, maxMonthlyAiMinutes: 1000, maxMonthlyAiReplies: 20_000, maxMonthlyAdvisorRuns: 300 },
};
export const LIMITS_PROVISIONAL = true;

export const PLANS: Record<TenantPlan, { label: string; description: string; features: readonly Feature[]; limits: PlanLimits }> = {
  STARTER: { label: "Starter", description: "Dijital QR menü, masalar ve QR etiketleri.", features: STARTER, limits: LIMITS.STARTER },
  VOICE_MENU: { label: "Sesli Menü", description: "Small: QR menü + menüyü anlatan sesli AI asistan. Sepet ve sipariş yok; müşteri soru sorar, asistan anlatır.", features: VOICE_MENU, limits: LIMITS.VOICE_MENU },
  PRO: { label: "Pro", description: "Sipariş, mutfak, servis, rezervasyon, CRM, sadakat, kampanya, ödeme ve analitik ile tam operasyon.", features: PRO, limits: LIMITS.PRO },
  AI: { label: "AI", description: "Full: Pro'nun tamamı + sesli sipariş veren AI asistan ve AI İşletme Danışmanı.", features: AI, limits: LIMITS.AI },
};

export const PLAN_ORDER: readonly TenantPlan[] = ["STARTER", "VOICE_MENU", "PRO", "AI"];

export function planHasFeature(plan: TenantPlan, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}

/** Yükseltme yolu: her paket bir öncekini kapsar. Sesli Menü (Small) YAN pakettir (sipariş yok) — yükseltme önerisi olmaz. */
export const UPGRADE_LADDER: readonly TenantPlan[] = ["STARTER", "PRO", "AI"];

/** Özelliği içeren en düşük YÜKSELTME paketi (kilitli özellik rozeti: "PRO"). Pro'daki firmaya sesli AI için "AI" önerilir
 *  (Sesli Menü'ye geçmek siparişi kaybettirir). */
export function minimumPlanFor(feature: Feature): TenantPlan {
  return UPGRADE_LADDER.find((p) => planHasFeature(p, feature)) ?? "AI";
}

/** a paketinin tüm özellikleri b'de var mı? (paket kartlarında "X'in tamamı +" yalnızca gerçekten kapsıyorsa) */
export function planIncludes(b: TenantPlan, a: TenantPlan): boolean {
  return PLANS[a].features.every((f) => planHasFeature(b, f));
}

export const isFeature = (v: string): v is Feature => (FEATURES as readonly string[]).includes(v);
export const isLimitKey = (v: string): v is LimitKey => (LIMIT_KEYS as readonly string[]).includes(v);

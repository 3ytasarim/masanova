import { SERVICE_RATE_LIMITS } from "@/lib/service-requests/duplicate";

/**
 * TÜM hız sınırı politikaları tek yerde (saf veri — testler doğrudan okur). Çağıran kod yalnızca politika ADINI ve
 * özneyi verir: `rateLimit("order.submit.table", tableId)`. Sayılar daha önce dağınık tanımlıydı; davranış aynı.
 *
 * `onBackendFailure` — Redis yapılandırılmış ama erişilemiyorsa (bilinçli seçim, sessizce sınırsızlık YOK):
 *   "memory": süreç içi bellek sayacına düşülür. Sınır yine uygulanır; yalnızca süreçler arası paylaşılmaz (N süreçte
 *              en kötü durum N × sınır). Menü / sipariş / servis / giriş akışları çalışmaya devam eder.
 *   "deny":    istek reddedilir (ücretli AI çağrısı yapılmaz). Asistan "şu an yanıt veremiyor" der; menü, sepet ve
 *              sipariş bundan ETKİLENMEZ.
 */
export type FallbackMode = "memory" | "deny";
export type RateLimitPolicy = { limit: number; windowMs: number; onBackendFailure: FallbackMode };

const MIN = 60 * 1000;

export const RATE_LIMIT_POLICIES = {
  // QR girişi (kararlı /q/<token>) — IP başına
  "qr.entry": { limit: 60, windowMs: MIN, onBackendFailure: "memory" },
  // Sipariş
  "order.submit.iptable": { limit: 8, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "order.submit.table": { limit: 30, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "order.submit.ip": { limit: 120, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "order.check": { limit: 120, windowMs: 10 * MIN, onBackendFailure: "memory" },
  // Masa servis talepleri
  "service.tabletype": { ...SERVICE_RATE_LIMITS.tableType, onBackendFailure: "memory" },
  "service.table": { ...SERVICE_RATE_LIMITS.table, onBackendFailure: "memory" },
  "service.ip": { ...SERVICE_RATE_LIMITS.ip, onBackendFailure: "memory" },
  // Sesli AI (ücretli sağlayıcı) — Redis yoksa güvenli ret
  "ai.conversation": { limit: 20, windowMs: MIN, onBackendFailure: "deny" },
  "ai.table": { limit: 60, windowMs: 10 * MIN, onBackendFailure: "deny" },
  "ai.ip": { limit: 300, windowMs: 10 * MIN, onBackendFailure: "deny" },
  "ai.session": { limit: 20, windowMs: 10 * MIN, onBackendFailure: "deny" },
  "ai.speech": { limit: 30, windowMs: MIN, onBackendFailure: "deny" },
  "ai.report": { limit: 60, windowMs: MIN, onBackendFailure: "memory" },
  // Sesten sese oturum (ücretli): masa / IP başına yeni bağlantı; araç çağrıları konuşma başına
  "ai.realtime.table": { limit: 12, windowMs: 10 * MIN, onBackendFailure: "deny" },
  "ai.realtime.ip": { limit: 60, windowMs: 10 * MIN, onBackendFailure: "deny" },
  "ai.tool": { limit: 90, windowMs: MIN, onBackendFailure: "deny" },
  // İşletme Danışmanı: elle "Analizi Yenile" (ücretli AI açıklaması) — kiracı başına
  "advisor.refresh": { limit: 6, windowMs: 60 * MIN, onBackendFailure: "deny" },
  // Panel görsel yükleme (CPU yoğun işleme) — kullanıcı başına
  "media.upload": { limit: 40, windowMs: 10 * MIN, onBackendFailure: "memory" },
  // Müşteri katılımı / doğrulama (QR) — herkese açık uçlar; IP + masa + iletişim değeri başına
  "crm.join.ip": { limit: 10, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "crm.join.table": { limit: 10, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "crm.verify.send.contact": { limit: 3, windowMs: 60 * MIN, onBackendFailure: "memory" },
  "crm.verify.send.ip": { limit: 10, windowMs: 60 * MIN, onBackendFailure: "memory" },
  "crm.verify.check.ip": { limit: 30, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "crm.profile.ip": { limit: 30, windowMs: 10 * MIN, onBackendFailure: "memory" },
  // Public rezervasyon (kiracı alan adı) — uygunluk orta, oluşturma sıkı (IP + iletişim + şube), yönetim bağlantısı
  "res.availability.ip": { limit: 60, windowMs: MIN, onBackendFailure: "memory" },
  "res.book.ip": { limit: 6, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "res.book.contact": { limit: 4, windowMs: 24 * 60 * MIN, onBackendFailure: "memory" },
  "res.book.branch": { limit: 120, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "res.manage.ip": { limit: 30, windowMs: 10 * MIN, onBackendFailure: "memory" },
  // Kupon / ödül önizlemesi (QR sepet) — kod tahmin denemesine karşı masa + IP
  "promo.check.table": { limit: 20, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "promo.check.ip": { limit: 40, windowMs: 10 * MIN, onBackendFailure: "memory" },
  // Online ödeme başlatma — sipariş + IP (sonsuz sağlayıcı denemesi yok); durum sorgusu orta
  "pay.create.order": { limit: 10, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "pay.create.ip": { limit: 30, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "pay.status.ip": { limit: 300, windowMs: 10 * MIN, onBackendFailure: "memory" },
  // Kimlik doğrulama ve pazarlama
  "auth.login": { limit: 5, windowMs: 15 * MIN, onBackendFailure: "memory" },
  "demo.ip": { limit: 3, windowMs: 10 * MIN, onBackendFailure: "memory" },
  "demo.email": { limit: 3, windowMs: 24 * 60 * MIN, onBackendFailure: "memory" },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

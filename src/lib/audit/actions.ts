/**
 * Denetim kaydı eylem kataloğu — tek kaynak. Yeni bir eylem önce buraya eklenir; servisler serbest
 * string yazamaz (AuditAction tipi), filtre ekranı da listeyi buradan okur.
 */
export const AUDIT_ACTION_LABELS = {
  AUTH_LOGIN_SUCCESS: "Giriş başarılı",
  AUTH_LOGIN_FAILURE: "Giriş başarısız",
  AUTH_LOGIN_THROTTLED: "Giriş hız sınırına takıldı",
  AUTH_LOGOUT: "Çıkış",
  TENANT_CREATED: "İşletme oluşturuldu",
  TENANT_UPDATED: "İşletme güncellendi",
  TENANT_SLUG_CHANGED: "İşletme kısa adı değişti",
  TENANT_STATUS_CHANGED: "İşletme durumu değişti",
  TENANT_PLAN_CHANGED: "İşletme paketi değişti",
  TENANT_MENU_CACHE_INVALIDATED: "Menü önbelleği temizlendi",
  BRANCH_CREATED: "Şube oluşturuldu",
  BRANCH_UPDATED: "Şube güncellendi",
  DOMAIN_CREATED: "Alan adı eklendi",
  DOMAIN_REMOVED: "Alan adı kaldırıldı",
  DOMAIN_PRIMARY_CHANGED: "Birincil alan adı değişti",
  DOMAIN_VERIFICATION_REQUESTED: "Alan adı doğrulaması istendi",
  DOMAIN_VERIFICATION_FAILED: "Alan adı doğrulaması başarısız",
  DOMAIN_VERIFIED: "Alan adı doğrulandı",
  USER_CREATED: "Kullanıcı oluşturuldu",
  USER_UPDATED: "Kullanıcı güncellendi",
  USER_PASSWORD_RESET: "Kullanıcı parolası sıfırlandı",
  USER_PASSWORD_CHANGED: "Kullanıcı kendi parolasını değiştirdi",
  SUPPORT_MODE_STARTED: "Destek modu başladı",
  SUPPORT_MODE_STOPPED: "Destek modu bitti",
  CATEGORY_CREATED: "Kategori oluşturuldu",
  CATEGORY_UPDATED: "Kategori güncellendi",
  CATEGORY_STATUS_CHANGED: "Kategori durumu değişti",
  PRODUCT_CREATED: "Ürün oluşturuldu",
  PRODUCT_UPDATED: "Ürün güncellendi",
  PRODUCT_STATUS_CHANGED: "Ürün durumu değişti",
  PRODUCT_SOLD_OUT_CHANGED: "Ürün tükendi durumu değişti",
  PRODUCT_ARCHIVED: "Ürün arşivlendi",
  PRODUCT_RESTORED: "Ürün arşivden çıkarıldı",
  PRODUCT_BULK_UPDATED: "Ürünler toplu güncellendi",
  VARIANT_CREATED: "Varyant oluşturuldu",
  VARIANT_UPDATED: "Varyant güncellendi",
  MODIFIER_GROUP_CREATED: "Ekstra grubu oluşturuldu",
  MODIFIER_GROUP_UPDATED: "Ekstra grubu güncellendi",
  MODIFIER_CREATED: "Ekstra oluşturuldu",
  MODIFIER_UPDATED: "Ekstra güncellendi",
  MENU_LIBRARY_UPDATED: "Menü kütüphanesi güncellendi",
  BRANCH_PRODUCT_OVERRIDE_UPDATED: "Şube ürün ayarı güncellendi",
  DINING_AREA_CREATED: "Bölge oluşturuldu",
  DINING_AREA_UPDATED: "Bölge güncellendi",
  TABLE_CREATED: "Masa oluşturuldu",
  TABLE_UPDATED: "Masa güncellendi",
  TABLE_BULK_CREATED: "Masalar toplu oluşturuldu",
  TABLE_QR_CREATED: "Masa QR kodu oluşturuldu",
  TABLE_QR_REGENERATED: "Masa QR kodu yenilendi",
  TABLE_QR_REVOKED: "Masa QR kodu iptal edildi",
  LABEL_PDF_GENERATED: "QR etiket PDF'i üretildi",
  ORDER_SUBMITTED: "Sipariş alındı (QR masa)",
  ORDER_ACCEPTED: "Sipariş kabul edildi",
  ORDER_REJECTED: "Sipariş reddedildi",
  ORDER_PREPARING: "Sipariş hazırlanıyor",
  ORDER_READY: "Sipariş hazır",
  ORDER_SERVED: "Sipariş servis edildi",
  ORDER_CANCELLED: "Sipariş iptal edildi",
  STATION_CREATED: "Hazırlama istasyonu oluşturuldu",
  STATION_UPDATED: "Hazırlama istasyonu güncellendi",
  STATION_DEACTIVATED: "Hazırlama istasyonu pasifleştirildi",
  PRODUCT_STATIONS_UPDATED: "Ürün istasyon yönlendirmesi güncellendi",
  TICKET_PREPARING: "İstasyon fişi hazırlanıyor",
  TICKET_READY: "İstasyon fişi hazır",
  SERVICE_REQUEST_CREATED: "Servis talebi alındı (QR masa)",
  SERVICE_REQUEST_ACKNOWLEDGED: "Servis talebi üstlenildi",
  SERVICE_REQUEST_COMPLETED: "Servis talebi tamamlandı",
  SERVICE_REQUEST_CANCELLED: "Servis talebi iptal edildi",
  AI_SETTINGS_UPDATED: "AI asistan ayarları güncellendi",
  PUBLIC_MENU_SETTINGS_UPDATED: "QR menü görünümü güncellendi",
  MEDIA_UPLOADED: "Görsel yüklendi",
  MEDIA_REPLACED: "Görsel değiştirildi",
  MEDIA_DELETED: "Görsel kaldırıldı",
  DEMO_REQUEST_CREATED: "Demo talebi alındı",
  DEMO_REQUEST_UPDATED: "Demo talebi güncellendi",
  CUSTOMER_CREATED: "Müşteri oluşturuldu",
  CUSTOMER_UPDATED: "Müşteri güncellendi",
  CUSTOMER_DELETION_REQUESTED: "Müşteri veri silme talebi",
  CONSENT_CHANGED: "Müşteri onayı değişti",
  LOYALTY_SETTINGS_UPDATED: "Sadakat ayarları güncellendi",
  LOYALTY_ADJUSTMENT: "Sadakat puanı düzeltildi",
  RESERVATION_CREATED: "Rezervasyon oluşturuldu",
  RESERVATION_CONFIRMED: "Rezervasyon onaylandı",
  RESERVATION_TABLE_ASSIGNED: "Rezervasyon masası atandı",
  RESERVATION_SEATED: "Rezervasyon masaya alındı",
  RESERVATION_COMPLETED: "Rezervasyon tamamlandı",
  RESERVATION_CANCELLED: "Rezervasyon iptal edildi",
  RESERVATION_NO_SHOW: "Rezervasyon: gelmedi",
  RESERVATION_OVERRIDE: "Rezervasyon kuralı yönetici tarafından aşıldı",
  RESERVATION_UPDATED: "Rezervasyon notu güncellendi",
  RESERVATION_SETTINGS_UPDATED: "Rezervasyon ayarları güncellendi",
  COUPON_CREATED: "Kupon oluşturuldu",
  COUPON_UPDATED: "Kupon güncellendi",
  COUPON_ARCHIVED: "Kupon arşivlendi",
  LOYALTY_REWARD_CREATED: "Sadakat ödülü oluşturuldu",
  LOYALTY_REWARD_UPDATED: "Sadakat ödülü güncellendi",
  CAMPAIGN_CREATED: "Kampanya taslağı oluşturuldu",
  CAMPAIGN_UPDATED: "Kampanya güncellendi",
  PAYMENT_MANUAL_RECORDED: "Manuel ödeme kaydedildi",
  PAYMENT_REFUND_REQUESTED: "Ödeme iadesi istendi",
  PAYMENT_REFUNDED: "Ödeme iade edildi",
  PAYMENT_PROVIDER_SETTING_UPDATED: "Ödeme ayarları güncellendi",
  SUBSCRIPTION_CREATED: "Abonelik oluşturuldu",
  SUBSCRIPTION_PLAN_CHANGED: "Abonelik paketi değişti",
  SUBSCRIPTION_STATUS_CHANGED: "Abonelik durumu değişti",
  SUBSCRIPTION_TRIAL_STARTED: "Deneme başlatıldı",
  SUBSCRIPTION_TRIAL_EXTENDED: "Deneme uzatıldı",
  SUBSCRIPTION_PERIOD_CHANGED: "Abonelik dönemi değişti",
  SUBSCRIPTION_CANCEL_SCHEDULED: "Dönem sonunda iptal planlandı",
  SUBSCRIPTION_CANCEL_UNSCHEDULED: "Planlı iptal kaldırıldı",
  SUBSCRIPTION_REACTIVATED: "Abonelik yeniden etkinleştirildi",
  ENTITLEMENT_OVERRIDE_SET: "Paket istisnası tanımlandı",
  ENTITLEMENT_OVERRIDE_REMOVED: "Paket istisnası kaldırıldı",
  SYSTEM_SEED: "Seed çalıştırıldı",
  VOICE_MENU_INDEX_BUILT: "Sesli menü dizini oluşturuldu",
  AI_KNOWLEDGE_SAVED: "Yapay zeka eğitim kartı kaydedildi",
  AI_KNOWLEDGE_DELETED: "Yapay zeka eğitim kartı silindi",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;
export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS) as AuditAction[];

export const AUDIT_ENTITIES = [
  "Tenant", "Branch", "TenantDomain", "User", "Session", "DemoRequest", "System",
  "MenuCategory", "Product", "ProductVariant", "ModifierGroup", "Modifier", "Ingredient", "Allergen", "DietaryTag", "BranchProduct",
  "DiningArea", "DiningTable", "TableQrToken", "PublicMenuSettings", "Order",
  "PreparationStation", "OrderTicket", "TableServiceRequest", "AiSettings", "MediaAsset",
  "Customer", "CustomerConsent", "LoyaltySettings", "LoyaltyAccount",
  "Reservation", "ReservationSettings", "BranchOpeningHours", "ReservationBlackout", "TableCombination",
  "Coupon", "LoyaltyReward", "Campaign",
  "Payment", "PaymentSettings",
  "Subscription", "EntitlementOverride", "VoiceMenuIndex", "AiKnowledgeDocument",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export function auditActionLabel(action: string): string {
  return action in AUDIT_ACTION_LABELS ? AUDIT_ACTION_LABELS[action as AuditAction] : action;
}

/** Metadata'da asla bulunmaması gereken anahtarlar (parola, token, oturum, bağlantı dizesi…). */
const SENSITIVE_KEY = /pass(word)?|parola|secret|token|hash|session|cookie|authorization|database_?url|direct_?url|redis_?url|credential|api_?key|proof|transcript|utterance|audio/i;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Denetim metadata'sını yazmadan önce temizler: hassas görünen anahtarlar düşürülür, uzun stringler kırpılır.
 * Bu bir emniyet ağıdır — çağıranlar zaten sır göndermemelidir.
 */
export function sanitizeAuditMetadata(value: unknown, depth = 0): Json | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAuditMetadata(item, depth + 1) ?? null);
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      const clean = sanitizeAuditMetadata(item, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return null;
}

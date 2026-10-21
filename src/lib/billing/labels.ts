import type { SubscriptionStatus } from "@prisma/client";
import type { EffectiveState } from "@/lib/billing/engine";

/** Abonelik görünüm etiketleri (panel + Super Admin). Ödeme / fiyat bilgisi YOK. */
export const EFFECTIVE_STATE_LABELS: Record<EffectiveState, string> = {
  TRIALING: "Deneme",
  ACTIVE: "Aktif",
  GRACE: "Ek süre",
  TRIAL_EXPIRED: "Deneme bitti",
  EXPIRED: "Süresi doldu",
  SUSPENDED: "Askıda",
  NONE: "Abonelik yok",
};

export const EFFECTIVE_STATE_TONES: Record<EffectiveState, "success" | "info" | "warning" | "danger" | "neutral"> = {
  TRIALING: "info",
  ACTIVE: "success",
  GRACE: "warning",
  TRIAL_EXPIRED: "danger",
  EXPIRED: "danger",
  SUSPENDED: "danger",
  NONE: "neutral",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: "Deneme",
  ACTIVE: "Aktif",
  PAST_DUE: "Ödeme gecikti",
  GRACE: "Ek süre",
  CANCELLED: "İptal edildi",
  EXPIRED: "Süresi doldu",
  SUSPENDED: "Askıya alındı",
};

export const SUBSCRIPTION_EVENT_LABELS: Record<string, string> = {
  SUBSCRIPTION_CREATED: "Abonelik oluşturuldu",
  SUBSCRIPTION_PLAN_CHANGED: "Paket değişti",
  SUBSCRIPTION_STATUS_CHANGED: "Durum değişti",
  SUBSCRIPTION_TRIAL_STARTED: "Deneme başlatıldı",
  SUBSCRIPTION_TRIAL_EXTENDED: "Deneme uzatıldı",
  SUBSCRIPTION_PERIOD_CHANGED: "Dönem değişti",
  SUBSCRIPTION_CANCEL_SCHEDULED: "Dönem sonunda iptal planlandı",
  SUBSCRIPTION_CANCEL_UNSCHEDULED: "Planlı iptal kaldırıldı",
  SUBSCRIPTION_REACTIVATED: "Yeniden etkinleştirildi",
  ENTITLEMENT_OVERRIDE_SET: "İstisna tanımlandı",
  ENTITLEMENT_OVERRIDE_REMOVED: "İstisna kaldırıldı",
};

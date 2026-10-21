import type { BadgeTone } from "@/components/ui/badge";
import type { ConsentState } from "@/lib/crm/consent";

/** CRM panel etiketleri (TR). */
export const CUSTOMER_SOURCE_LABELS = {
  QR_OPT_IN: "QR menüden katıldı",
  ORDER_CHECKOUT: "Sipariş sonrası katıldı",
  LOYALTY_JOIN: "Sadakat davetiyle katıldı",
  MANUAL_STAFF: "Personel ekledi",
} as const;

export const CONSENT_TYPE_LABELS = {
  PRIVACY: "Aydınlatma / gizlilik",
  LOYALTY: "Sadakat programı",
  MARKETING_EMAIL: "E-posta pazarlama",
  MARKETING_SMS: "SMS pazarlama",
  MARKETING_WHATSAPP: "WhatsApp pazarlama",
} as const;

export const CONSENT_SOURCE_LABELS = { QR_OPT_IN: "QR katılım", CUSTOMER_PROFILE: "Müşteri hesabı", MANUAL_STAFF: "Personel (müşteri talebi)" } as const;

/** Pazarlama durumu — belirsiz "abone" yok: İzin var / İzin yok / Geri alındı. */
export const MARKETING_STATE_LABELS: Record<ConsentState, string> = { GRANTED: "İzin var", NONE: "İzin yok", REVOKED: "Geri alındı" };
export const MARKETING_STATE_TONES: Record<ConsentState, BadgeTone> = { GRANTED: "success", NONE: "neutral", REVOKED: "warning" };

export const LOYALTY_STATUS_LABELS = { ACTIVE: "Üye", LEFT: "Ayrıldı", NONE: "Üye değil" } as const;
export const LOYALTY_STATUS_TONES: Record<keyof typeof LOYALTY_STATUS_LABELS, BadgeTone> = { ACTIVE: "accent", LEFT: "warning", NONE: "neutral" };

export const LEDGER_TYPE_LABELS = { EARN: "Kazanım", REDEEM: "Ödül kullanımı", ADJUSTMENT: "Düzeltme", EXPIRE: "Süre doldu", REVERSAL: "Geri alma (iptal)" } as const;

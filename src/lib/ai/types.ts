import type { ServiceRequestType } from "@prisma/client";
import type { AiLanguage } from "@/lib/voice/language-detection";

/**
 * AI asistan sözleşmeleri (sunucu ↔ istemci). Eylem kartları YALNIZCA sunucunun doğruladığı araç sonuçlarından üretilir;
 * modelin serbest metni asla bir eylem yaratmaz. Hiçbir kart siparişi göndermez: en fazla sepeti açar.
 */
export type CartLinePayload = {
  product: string;
  variant: string | null;
  modifiers: { group: string; modifier: string }[];
  quantity: number;
  note: string | null;
  unitPriceMinor: number;
  name: string;
  detail: string;
};

export type ActionCard =
  /** Sepete ekle (onaylanınca istemcideki MEVCUT sepet mantığı çalışır; gönderimde sunucu yeniden doğrular). */
  | { kind: "cart_add"; id: string; line: CartLinePayload; totalMinor: number; totalLabel: string }
  /** Seçim gerekli (zorunlu ekstra / varyant): MEVCUT ürün yapılandırıcısı açılır, tahmin yapılmaz. */
  | { kind: "configure"; id: string; product: string; name: string; reason: "required_modifiers" | "variant_choice" }
  /** Sepetteki satırın adedini değiştir (0 = çıkar). */
  | { kind: "cart_change"; id: string; lineKey: string; name: string; quantity: number }
  /** Mevcut Sprint 8 servis talebi (mükerrer koruması dahil). */
  | { kind: "service"; id: string; type: Exclude<ServiceRequestType, "CUSTOM"> }
  /** Sepeti / son onayı aç — siparişi müşteri "Siparişi Onayla" ile gönderir. */
  | { kind: "open_cart"; id: string };

export type ProductCard = { product: string; name: string; priceLabel: string; soldOut: boolean; quantity?: number; lineTotalLabel?: string };

export type RecommendationBundle = {
  items: { product: string; name: string; quantity: number; unitPriceLabel: string; lineTotalMinor: number; lineTotalLabel: string; addable: boolean }[];
  totalMinor: number;
  totalLabel: string;
  budgetMinor: number | null;
  guests: number;
};

export type AssistantReply = {
  messageId: string;
  text: string;
  language: AiLanguage;
  direction: "ltr" | "rtl";
  actions: ActionCard[];
  products: ProductCard[];
  recommendation: RecommendationBundle | null;
  /** Bu yanıt için ses üretilebilir mi (işletme ayarı + sağlayıcı). */
  speakable: boolean;
};

export type AssistantTurnResponse =
  | { ok: true; transcript: string | null; languageSwitched: boolean; reply: AssistantReply }
  | { ok: false; error: AssistantErrorCode };

export type AssistantErrorCode =
  | "context_invalid"
  | "feature_disabled"
  | "conversation_invalid"
  | "rate_limited"
  | "too_long"
  | "audio_too_long"
  | "audio_invalid"
  | "stt_failed"
  | "ai_failed"
  | "turn_limit";

export type ConversationSummary = {
  language: AiLanguage;
  direction: "ltr" | "rtl";
  assistantName: string;
  voiceEnabled: boolean;
  messages: { id: string; role: "user" | "assistant"; text: string; language: AiLanguage }[];
};

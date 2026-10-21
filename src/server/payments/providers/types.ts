/**
 * Ödeme sağlayıcısı soyutlaması. İş mantığı (rezervasyon, bakiye, dağıtım, iade sınırı) sağlayıcıdan BAĞIMSIZDIR;
 * gerçek bir sağlayıcı (karar verilmedi — Stripe / iyzico / PayTR vb. VARSAYILMADI) bu arayüzü uygulayan bir adaptörle
 * eklenir. Kart verisi MasaNova sunucusuna GELMEZ: barındırılan (hosted) ödeme sayfası / tokenizasyon varsayılır.
 */
export type ProviderPaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";
/** Sağlayıcının döndürebileceği GÜVENLİ kart özeti (PAN / CVV asla). */
export type SafeCardMeta = { brand: string | null; last4: string | null };

export type CreatePaymentInput = { reference: string; amountMinor: number; currency: string; idempotencyKey: string; returnUrl: string; description: string };
export type CreatePaymentResult = { providerReference: string; status: ProviderPaymentStatus; checkoutUrl: string | null; card: SafeCardMeta | null; failureCode: string | null };

export type WebhookEvent = { eventId: string; type: "payment.succeeded" | "payment.failed" | "payment.cancelled" | "refund.succeeded" | "other"; providerReference: string | null; card: SafeCardMeta | null };

export interface PaymentProvider {
  readonly name: string;
  /** Test sağlayıcısı mı (gerçek para çekilmez)? Panelde açıkça gösterilir. */
  readonly test: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPayment(providerReference: string): Promise<{ status: ProviderPaymentStatus; card: SafeCardMeta | null }>;
  cancelPayment(providerReference: string): Promise<void>;
  refundPayment(input: { providerReference: string; amountMinor: number; idempotencyKey: string }): Promise<{ ok: boolean; providerReference: string | null; failureCode: string | null }>;
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(rawBody: string): WebhookEvent | null;
}

export class ProviderUnavailable extends Error {
  constructor(readonly code: "timeout" | "unavailable") {
    super(`payment provider ${code}`);
  }
}

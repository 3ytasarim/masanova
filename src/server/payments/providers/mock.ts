import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { signWebhook, verifyWebhookSignature } from "@/lib/payments/state";
import { ProviderUnavailable, type CreatePaymentInput, type CreatePaymentResult, type PaymentProvider, type ProviderPaymentStatus, type WebhookEvent } from "@/server/payments/providers/types";

/**
 * TEST sağlayıcısı (gerçek para ÇEKİLMEZ). Barındırılan ödeme sayfasını taklit eder: ödeme başlatılınca müşteri
 * /odeme/mock/<ref> sayfasına yönlenir, orada sonucu seçer; sonuç İMZALI webhook olarak gerçek webhook işleyicisinden
 * geçer (aynı doğrulama yolu). Testler bir sonraki davranışı belirleyebilir: SUCCESS / FAIL / PENDING / TIMEOUT.
 * Durum süreç belleğindedir (tek süreç). Sağlayıcı idempotency'si: aynı anahtar → aynı referans.
 */
export type MockMode = "HOSTED" | "SUCCESS" | "FAIL" | "PENDING" | "TIMEOUT";
type Entry = { status: ProviderPaymentStatus; amountMinor: number; refunded: number };
type MockState = { payments: Map<string, Entry>; next: MockMode[]; refundFail: boolean };

const g = globalThis as unknown as { __masanovaMockPay?: MockState };
const state = (): MockState => (g.__masanovaMockPay ??= { payments: new Map(), next: [], refundFail: false });

/** Testler için: sonraki createPayment davranışlarını sıraya koy. */
export function mockQueue(...modes: MockMode[]) {
  state().next.push(...modes);
}
export function mockSetRefundFail(fail: boolean) {
  state().refundFail = fail;
}
export function mockReset() {
  g.__masanovaMockPay = { payments: new Map(), next: [], refundFail: false };
}

export function createMockProvider(secret: string): PaymentProvider & { buildEvent(ref: string, outcome: "payment.succeeded" | "payment.failed", eventId?: string): { rawBody: string; signature: string } } {
  return {
    name: "mock",
    test: true,
    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      const mode = state().next.shift() ?? "HOSTED";
      if (mode === "TIMEOUT") throw new ProviderUnavailable("timeout");
      const ref = `mock_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}`;
      const existing = state().payments.get(ref);
      if (existing) return { providerReference: ref, status: existing.status, checkoutUrl: existing.status === "PENDING" ? `/odeme/mock/${ref}?r=${encodeURIComponent(input.returnUrl)}` : null, card: null, failureCode: null };
      const status: ProviderPaymentStatus = mode === "SUCCESS" ? "SUCCEEDED" : mode === "FAIL" ? "FAILED" : "PENDING";
      state().payments.set(ref, { status, amountMinor: input.amountMinor, refunded: 0 });
      return {
        providerReference: ref,
        status,
        checkoutUrl: mode === "HOSTED" ? `/odeme/mock/${ref}?r=${encodeURIComponent(input.returnUrl)}` : null,
        card: status === "SUCCEEDED" ? { brand: "TEST", last4: "4242" } : null,
        failureCode: status === "FAILED" ? "card_declined" : null,
      };
    },
    async getPayment(ref) {
      const e = state().payments.get(ref);
      return { status: e?.status ?? "UNKNOWN", card: e?.status === "SUCCEEDED" ? { brand: "TEST", last4: "4242" } : null };
    },
    async cancelPayment(ref) {
      const e = state().payments.get(ref);
      if (e && e.status === "PENDING") e.status = "CANCELLED";
    },
    async refundPayment({ providerReference, amountMinor }) {
      const e = state().payments.get(providerReference);
      if (state().refundFail || !e || e.status !== "SUCCEEDED" || e.refunded + amountMinor > e.amountMinor) return { ok: false, providerReference: null, failureCode: "refund_failed" };
      e.refunded += amountMinor;
      return { ok: true, providerReference: `mock_rf_${randomBytes(6).toString("hex")}`, failureCode: null };
    },
    verifyWebhook(rawBody, headers) {
      return verifyWebhookSignature(secret, headers.get("x-masanova-signature"), rawBody);
    },
    parseWebhook(rawBody): WebhookEvent | null {
      try {
        const e = JSON.parse(rawBody) as { id?: unknown; type?: unknown; reference?: unknown };
        if (typeof e.id !== "string" || typeof e.type !== "string") return null;
        const type = (["payment.succeeded", "payment.failed", "payment.cancelled", "refund.succeeded"] as const).find((t) => t === e.type) ?? "other";
        return { eventId: e.id.slice(0, 100), type, providerReference: typeof e.reference === "string" ? e.reference.slice(0, 100) : null, card: type === "payment.succeeded" ? { brand: "TEST", last4: "4242" } : null };
      } catch {
        return null;
      }
    },
    /** Barındırılan ödeme sayfasındaki seçim → sağlayıcı durumu + imzalı olay (webhook işleyicisine verilir). */
    buildEvent(ref, outcome, eventId) {
      const e = state().payments.get(ref);
      if (e && e.status === "PENDING") e.status = outcome === "payment.succeeded" ? "SUCCEEDED" : "FAILED";
      const rawBody = JSON.stringify({ id: eventId ?? `evt_${randomBytes(8).toString("hex")}`, type: outcome, reference: ref });
      return { rawBody, signature: signWebhook(secret, Date.now(), rawBody) };
    },
  };
}

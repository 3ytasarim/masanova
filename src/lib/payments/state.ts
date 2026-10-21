import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ödeme durum makinesi ve sipariş ödeme durumu — tek kaynak.
 *   PENDING → PROCESSING / SUCCEEDED / FAILED / CANCELLED
 *   PROCESSING → SUCCEEDED / FAILED / CANCELLED
 *   SUCCEEDED → PARTIALLY_REFUNDED / REFUNDED; PARTIALLY_REFUNDED → PARTIALLY_REFUNDED / REFUNDED
 *   FAILED / CANCELLED → SUCCEEDED yalnızca GEÇ sağlayıcı onayıyla ve bakiye hâlâ uygunsa (servis karar verir)
 * Kesinleşmiş ödeme (SUCCEEDED ve iade durumları) ASLA geriye dönmez (veritabanı tetikleyicisi de engeller).
 */
export type PaymentStatusName = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "PARTIALLY_REFUNDED" | "REFUNDED";
export const SETTLED: readonly PaymentStatusName[] = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"];
export const IN_FLIGHT: readonly PaymentStatusName[] = ["PENDING", "PROCESSING"];

const TRANSITIONS: Record<PaymentStatusName, readonly PaymentStatusName[]> = {
  PENDING: ["PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  REFUNDED: [],
  FAILED: ["SUCCEEDED"],
  CANCELLED: ["SUCCEEDED"],
};

export function canTransitionPayment(from: PaymentStatusName, to: PaymentStatusName): boolean {
  return TRANSITIONS[from].includes(to);
}
export const isSettled = (s: PaymentStatusName) => SETTLED.includes(s);

/** Sipariş ancak mutfak kabul ettikten sonra ödenebilir; ret / iptal ödenemez. Servis edilmiş sipariş ödenmemiş olabilir. */
export const PAYABLE_ORDER_STATUSES = ["ACCEPTED", "PREPARING", "READY", "SERVED"] as const;
export function isPayableOrderStatus(status: string): boolean {
  return (PAYABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

export type PaymentLike = { status: PaymentStatusName; amountMinor: number; refundedMinor: number; reservedUntil: Date | null };
export type OrderPaymentState = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";

/** Rezervasyon: uçuştaki (PENDING / PROCESSING) ödeme, süresi dolmamışsa payını tutar. */
export function isActiveReservation(p: PaymentLike, now: Date): boolean {
  return IN_FLIGHT.includes(p.status) && !!p.reservedUntil && p.reservedUntil.getTime() > now.getTime();
}

/**
 * Bakiye — MERKEZİ. İade politikası (belgelendi): iade ödenecek bakiyeyi YENİDEN AÇMAZ (sipariş kapanmış sayılır; iade
 * işletmenin müşteriye geri ödemesidir). Bu yüzden:
 *   paid      = kesinleşmiş ödemelerin TAMAMI (iade edilmiş olsa da)
 *   remaining = toplam − paid
 *   available = remaining − etkin rezervasyonlar   (yeni ödeme en fazla bu kadar)
 */
export function paymentSummary(totalMinor: number, payments: readonly PaymentLike[], now: Date) {
  let paid = 0;
  let refunded = 0;
  let reserved = 0;
  for (const p of payments) {
    if (isSettled(p.status)) {
      paid += p.amountMinor;
      refunded += p.refundedMinor;
    } else if (isActiveReservation(p, now)) reserved += p.amountMinor;
  }
  const remaining = Math.max(0, totalMinor - paid);
  const available = Math.max(0, remaining - reserved);
  const state: OrderPaymentState = paid === 0 ? "UNPAID" : refunded > 0 ? (refunded >= paid ? "REFUNDED" : "PARTIALLY_REFUNDED") : paid >= totalMinor ? "PAID" : "PARTIALLY_PAID";
  return { totalMinor, paid, refunded, reserved, remaining, available, state };
}
export type PaymentSummary = ReturnType<typeof paymentSummary>;

export function refundableMinor(p: { status: PaymentStatusName; amountMinor: number; refundedMinor: number }): number {
  return isSettled(p.status) ? Math.max(0, p.amountMinor - p.refundedMinor) : 0;
}

export function statusAfterRefund(amountMinor: number, refundedMinor: number): "SUCCEEDED" | "PARTIALLY_REFUNDED" | "REFUNDED" {
  return refundedMinor <= 0 ? "SUCCEEDED" : refundedMinor >= amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
}

// ─── Webhook imzası (HMAC-SHA256, zaman damgalı) ────────────────────────────

export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

/** Ham gövde + başlık doğrulaması; zaman toleransı tekrar saldırısını sınırlar (olay kimliği ayrıca tekildir). */
export function verifyWebhookSignature(secret: string, header: string | null, rawBody: string, now = Date.now()): boolean {
  if (!header || rawBody.length > 64_000) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > WEBHOOK_TOLERANCE_MS || !/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return false;
  const expected = Buffer.from(signWebhook(secret, t, rawBody).split("v1=")[1]!, "hex");
  const got = Buffer.from(parts.v1!, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatusName, string> = {
  PENDING: "Başlatıldı",
  PROCESSING: "İşleniyor",
  SUCCEEDED: "Başarılı",
  FAILED: "Başarısız",
  CANCELLED: "İptal / süresi doldu",
  PARTIALLY_REFUNDED: "Kısmi iade",
  REFUNDED: "İade edildi",
};
export const ORDER_PAYMENT_LABELS: Record<OrderPaymentState, string> = { UNPAID: "Ödenmedi", PARTIALLY_PAID: "Kısmen ödendi", PAID: "Ödendi", PARTIALLY_REFUNDED: "Kısmi iade", REFUNDED: "İade edildi" };
export const PAYMENT_METHOD_LABELS = { ONLINE: "Online", CASH: "Nakit", CARD_TERMINAL: "Kart (POS cihazı)", OTHER: "Diğer" } as const;

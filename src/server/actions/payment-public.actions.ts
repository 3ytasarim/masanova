"use server";

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getRequestMeta } from "@/lib/security/request-meta";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import type { PaymentStatusName, PaymentSummary } from "@/lib/payments/state";
import { rateLimit, rateLimitAll } from "@/server/rate-limit";
import { readCustomerIdentity } from "@/server/crm/customer-session";
import { activeCustomerId } from "@/server/crm/customer.service";
import { findPublicOrderId } from "@/server/repositories/orders.repository";
import { loadOrderPaymentView, onlinePaymentsAvailable, refreshFromProvider, startOnlinePayment, type PayFailure } from "@/server/payments/payment.service";

/**
 * Müşteri (QR) ödeme eylemleri. Yetki: geçerli masa QR bağlamı + siparişin AYNI masaya ait ve son 24 saatte olması
 * (mevcut sipariş görüntüleme modeli; yeni misafir eski siparişleri görmez / ödeyemez). Kiracı / sipariş iç kimliği /
 * tutar / toplam istemciden ALINMAZ; tutar sunucuda hesaplanır. Server Action → Origin denetimi (CSRF).
 * Müşteri tanınıyorsa ödeme CRM müşterisiyle ilişkilendirilir; anonim ödeme anonim kalır.
 */
async function context(token: unknown, orderPublicId: unknown) {
  if (typeof token !== "string" || typeof orderPublicId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(orderPublicId)) return null;
  const r = await getTableQrContext(token);
  if (!r.ok) return null;
  const tenantId = r.context.tenant.id;
  const orderId = await findPublicOrderId({ tenantId, tableId: r.context.table.id }, orderPublicId);
  return orderId ? { tenantId, orderId, token, orderPublicId } : null;
}
const ip = async () => (await getRequestMeta()).ipAddress ?? "unknown";

const startSchema = z.object({
  mode: z.enum(["FULL", "AMOUNT", "EQUAL", "ITEMS"]),
  amountMinor: z.number().int().min(1).max(100_000_000).nullish(),
  items: z.array(z.object({ line: z.string().regex(/^[a-z0-9]{1,40}$/i), quantity: z.number().int().min(1).max(999) })).max(50).nullish(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
});

export type StartPaymentResult = { kind: "started"; paymentPublicId: string; status: PaymentStatusName; redirectUrl: string | null } | { kind: "rejected"; reason: PayFailure | "context_invalid" | "invalid" | "rate_limited" };

export async function startPaymentAction(token: string, orderPublicId: string, payload: unknown): Promise<StartPaymentResult> {
  const ctx = await context(token, orderPublicId);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  const parsed = startSchema.safeParse(payload);
  if (!parsed.success) return { kind: "rejected", reason: "invalid" };
  const limited = await rateLimitAll([
    ["pay.create.order", ctx.orderId],
    ["pay.create.ip", await ip()],
  ]);
  if (!limited.allowed) return { kind: "rejected", reason: "rate_limited" };
  const identity = await readCustomerIdentity(ctx.tenantId);
  const customerId = identity ? await activeCustomerId(ctx.tenantId, identity.customerId) : null;
  const d = parsed.data;
  const r = await startOnlinePayment({
    tenantId: ctx.tenantId,
    orderId: ctx.orderId,
    customerId,
    returnUrl: `/t/${token}/siparis/${orderPublicId}/odeme`,
    request: { mode: d.mode, amountMinor: d.amountMinor ?? null, items: (d.items ?? []).map((i) => ({ orderItemId: i.line, quantity: i.quantity })), idempotencyKey: d.idempotencyKey },
  });
  if (!r.ok) return { kind: "rejected", reason: r.reason };
  return { kind: "started", paymentPublicId: r.publicId, status: r.status, redirectUrl: r.checkoutUrl };
}

export type PaymentStatusView = { kind: "ok"; summary: PaymentSummary; payment: { status: PaymentStatusName; amountMinor: number } | null } | { kind: "rejected"; reason: "context_invalid" | "rate_limited" };

/** Dönüş / bekleme sayfası: yetkili durum (gerekirse sağlayıcıya sorulur — kayıp webhook). Yönlendirme kanıt değildir. */
export async function paymentStatusAction(token: string, orderPublicId: string, paymentPublicId: string | null): Promise<PaymentStatusView> {
  const ctx = await context(token, orderPublicId);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  if (!(await rateLimit("pay.status.ip", await ip())).allowed) return { kind: "rejected", reason: "rate_limited" };
  let payment: { status: PaymentStatusName; amountMinor: number } | null = null;
  if (paymentPublicId && /^[A-Za-z0-9_-]{22}$/.test(paymentPublicId)) {
    const p = await prisma.payment.findFirst({ where: { publicId: paymentPublicId, tenantId: ctx.tenantId, orderId: ctx.orderId }, select: { id: true, amountMinor: true } });
    if (p) payment = { status: (await refreshFromProvider(ctx.tenantId, p.id))!, amountMinor: p.amountMinor };
  }
  const view = await loadOrderPaymentView(prisma, ctx.tenantId, ctx.orderId);
  return view ? { kind: "ok", summary: view.summary, payment } : { kind: "rejected", reason: "context_invalid" };
}

export async function paymentsAvailableAction(token: string): Promise<boolean> {
  if (typeof token !== "string") return false;
  const r = await getTableQrContext(token);
  return r.ok ? onlinePaymentsAvailable(r.context.tenant.id) : false;
}

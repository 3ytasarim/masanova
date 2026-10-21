"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { getRequestId, getRequestMeta } from "@/lib/security/request-meta";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import { STAFF_TRANSITION_PERMISSION } from "@/lib/orders/status";
import { checkCartSchema, submitOrderSchema } from "@/lib/validation/orders";
import { cancelReasonSchema } from "@/lib/validation/stations";
import { changeOrderStatus, transitionTicket } from "@/server/services/orders/order-status.service";
import { rateLimit, rateLimitAll } from "@/server/rate-limit";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { readCustomerIdentity } from "@/server/crm/customer-session";
import { activeCustomerId, touchCustomer } from "@/server/crm/customer.service";
import { checkCart, submitOrder, type OrderContext, type ReconcileLine, type SubmitOrderResult } from "@/server/services/orders/submit-order.service";
import { checkFeature } from "@/server/billing/entitlements";

/**
 * Sipariş eylemleri.
 *
 * Müşteri (public, kiracı alan adı): oturum yok. Masa bağlamı her çağrıda QR token'dan + istek host'undan yeniden
 * kurulur (getTableQrContext); istemcinin gönderdiği hiçbir kimlik / fiyat kullanılmaz.
 * Hız sınırı katmanlı (src/server/rate-limit — REDIS_URL varsa süreçler arası paylaşılır):
 *   IP + masa  : 8 sipariş / 10 dk   (tek cihazdan spam)
 *   masa       : 30 sipariş / 10 dk  (IP değiştiren saldırgan)
 *   IP         : 120 sipariş / 10 dk (aynı Wi-Fi'deki birçok masa normal kullanımda takılmasın)
 */

export type PublicSubmitResult = SubmitOrderResult | { kind: "rejected"; reason: "rate_limited" | "invalid" };
export type PublicCheckResult = { kind: "ok"; lines: ReconcileLine[]; currentUnitPrices: number[] } | { kind: "rejected"; reason: "context_invalid" | "invalid" | "rate_limited" | "feature_disabled" };

async function orderContext(token: unknown): Promise<OrderContext | null> {
  if (typeof token !== "string") return null;
  const result = await getTableQrContext(token);
  if (!result.ok) return null;
  const { context } = result;
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: context.tenant.id }, select: { defaultLocale: true } });
  return {
    tenantId: context.tenant.id,
    branchId: context.branch.id,
    tableId: context.table.id,
    tokenId: context.token.id,
    branchName: context.branch.name,
    tableName: context.table.name,
    areaName: context.area?.name ?? null,
    defaultLocale: settings?.defaultLocale ?? "tr",
  };
}

export async function submitOrderAction(token: string, payload: unknown): Promise<PublicSubmitResult> {
  const ctx = await orderContext(token);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  const parsed = submitOrderSchema.safeParse(payload);
  if (!parsed.success) return { kind: "rejected", reason: "invalid" };

  const meta = await getRequestMeta();
  const ip = meta.ipAddress ?? "unknown";
  const limit = await rateLimitAll([
    ["order.submit.iptable", `${ip}|${ctx.tableId}`],
    ["order.submit.table", ctx.tableId],
    ["order.submit.ip", ip],
  ]);
  if (!limit.allowed) return { kind: "rejected", reason: "rate_limited" };

  // İsteğe bağlı kimlik: yalnızca bu tarayıcının müşteri oturumu (aynı kiracı). Masa yetkisi yine QR bağlamından gelir.
  const identity = await readCustomerIdentity(ctx.tenantId);
  const customerId = identity ? await activeCustomerId(ctx.tenantId, identity.customerId) : null;

  const started = Date.now();
  const result = await submitOrder({ ...ctx, customerId }, parsed.data);
  if (customerId && result.kind === "created") await touchCustomer(ctx.tenantId, customerId);
  // İz: requestId → orderId → (mutfak olayı orderId ile). Müşteri / masa kimliği ve sepet içeriği loglanmaz.
  log.info("order.submit", { requestId: await getRequestId(), tenant: ctx.tenantId, outcome: result.kind, orderNumber: "order" in result ? result.order.orderNumber : null, durationMs: Date.now() - started });
  metrics.observe("order.submit_ms", Date.now() - started);
  if (result.kind === "duplicate") metrics.inc("orders.idempotent_replay");
  if (result.kind === "created") {
    metrics.inc("orders.submitted");
    revalidatePath("/panel/siparisler", "layout");
  }
  return result;
}

export async function checkCartAction(token: string, payload: unknown): Promise<PublicCheckResult> {
  const ctx = await orderContext(token);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  const parsed = checkCartSchema.safeParse(payload);
  if (!parsed.success) return { kind: "rejected", reason: "invalid" };
  const ip = (await getRequestMeta()).ipAddress ?? "unknown";
  if (!(await rateLimit("order.check", `${ip}|${ctx.tableId}`)).allowed) return { kind: "rejected", reason: "rate_limited" };
  if (!(await checkFeature(ctx.tenantId, "ordering")).allowed) return { kind: "rejected", reason: "feature_disabled" };
  const result = await checkCart(ctx, { items: parsed.data.items.map((i) => ({ ...i, expectedUnitPriceMinor: i.expectedUnitPriceMinor ?? null })), locale: parsed.data.locale });
  return { kind: "ok", lines: result.lines, currentUnitPrices: result.currentUnitPrices };
}

// ─── Panel ──────────────────────────────────────────────────────────────────

/**
 * Personel sipariş eylemleri. Yetki geçişe göre: kabul / ret → orders.manage, servis → orders.serve (garson dahil),
 * iptal → orders.cancel (sahip / müdür; açıklama zorunlu). Hepsi yazma işlemidir (destek modu reddedilir).
 * PREPARING / READY elle atanamaz — mutfak fişlerinden otomatik türetilir.
 */
const staffStatusSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{20,40}$/),
  to: z.enum(["ACCEPTED", "REJECTED", "SERVED", "CANCELLED"]),
  reason: z
    .string()
    .max(200, "En fazla 200 karakter.")
    .optional()
    .transform((v) => v?.replace(/\s+/g, " ").trim() || null),
});

export async function orderStatusAction(orderId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const parsed = staffStatusSchema.safeParse({ id: orderId, to: fd.get("to"), reason: fd.get("reason") ?? undefined });
  if (!parsed.success) {
    await requireTenantUser({ permission: "orders.view" });
    return invalid(parsed.error, "Geçersiz işlem.");
  }
  const { id, to, reason } = parsed.data;
  const ctx = await requireTenantUser({ permission: STAFF_TRANSITION_PERMISSION[to], write: true });
  if (to === "CANCELLED") {
    const why = cancelReasonSchema.safeParse(reason ?? "");
    if (!why.success) return invalid(why.error, "İptal nedeni zorunlu.");
  }
  const result = await changeOrderStatus({ userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() }, id, to, reason);
  revalidatePath("/panel/siparisler", "layout");
  revalidatePath("/panel/mutfak", "layout");
  return result;
}

/** KDS fiş geçişi — kds.manage + yazma (mutfak / bar / sahip / müdür; garson ve kasiyer değil). */
export async function ticketStatusAction(ticketId: string, to: "PREPARING" | "READY"): Promise<ActionResult> {
  const ctx = await requireTenantUser({ permission: "kds.manage", write: true });
  const parsed = z.object({ id: z.string().regex(/^[a-z0-9]{20,40}$/), to: z.enum(["PREPARING", "READY"]) }).safeParse({ id: ticketId, to });
  if (!parsed.success) return { ok: false, error: "Geçersiz işlem." };
  const result = await transitionTicket({ userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() }, parsed.data.id, parsed.data.to);
  revalidatePath("/panel/mutfak", "layout");
  revalidatePath("/panel/siparisler", "layout");
  return result;
}

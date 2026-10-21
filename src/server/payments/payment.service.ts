import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PaymentMethod, type PaymentSplitMode } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { linePayables, unitsAmount, type LinePayable } from "@/lib/payments/allocation";
import { IN_FLIGHT, SETTLED, isPayableOrderStatus, isSettled, paymentSummary, refundableMinor, statusAfterRefund, type PaymentStatusName, type PaymentSummary } from "@/lib/payments/state";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { getPaymentProvider } from "@/server/payments/providers";
import { ProviderUnavailable, type SafeCardMeta } from "@/server/payments/providers/types";
import { buildAuditRow } from "@/server/services/audit.service";
import { getTenantEntitlements, resolveEntitlements } from "@/server/billing/entitlements";

/**
 * Ödeme orkestrasyonu. Tutar her zaman SUNUCUDA, siparişin KALICI toplamından (Sprint 18 indirimi dahil; kupon
 * uygunluğu yeniden hesaplanmaz) ve mevcut ödemelerden türetilir. Tarayıcının tutar / toplam / bakiye alanları yok sayılır.
 *
 * Fazla ödeme engeli:
 *   1. Sipariş satırı FOR UPDATE: aynı siparişte ödeme oluşturma / kesinleştirme sıraya girer.
 *   2. REZERVASYON: uçuştaki (PENDING / PROCESSING) ödeme payını `reserved_until`'e kadar tutar → iki ödeyen aynı payı
 *      sağlayıcıda aynı anda başlatamaz. Süresi dolan / başarısız olan rezervasyon serbest kalır.
 *   3. Veritabanı tetikleyicisi: kesinleşen ödemeler toplamı sipariş toplamını, kalem adetleri kalem adedini AŞAMAZ.
 * Idempotency: (kiracı, sha256(istemci anahtarı)) benzersiz + sağlayıcıya aynı idempotency anahtarı.
 * Kesin başarı YALNIZCA sağlayıcı onayıyla (imzalı webhook ya da sağlayıcı sorgusu); tarayıcı yönlendirmesi kanıt değildir.
 */
type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
const NO_META: RequestMeta = { ipAddress: null, userAgent: null };
const DEFAULT_RESERVATION_MINUTES = 15;

export const hashKey = (key: string) => createHash("sha256").update(`masanova:payment-idem:v1:${key}`, "utf8").digest("hex");

export async function getPaymentSettings(tenantId: string, db: Db = prisma) {
  return (
    (await db.paymentSettings.findUnique({ where: { tenantId }, select: { enabled: true, allowOnline: true, allowCash: true, allowCardTerminal: true, reservationMinutes: true } })) ?? {
      enabled: false,
      allowOnline: true,
      allowCash: true,
      allowCardTerminal: true,
      reservationMinutes: DEFAULT_RESERVATION_MINUTES,
    }
  );
}

/** Müşteriye online ödeme gösterilir mi: işletme açtı + online izinli + sağlayıcı yapılandırılmış. */
export async function onlinePaymentsAvailable(tenantId: string): Promise<boolean> {
  const [s, ent] = await Promise.all([getPaymentSettings(tenantId), getTenantEntitlements(tenantId)]);
  return s.enabled && s.allowOnline && !!getPaymentProvider() && ent.has("restaurant_payments");
}

// ─── Durum yükleme ──────────────────────────────────────────────────────────

async function lockOrder(tx: Tx, tenantId: string, orderId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id = ${orderId} AND tenant_id = ${tenantId} FOR UPDATE`;
  return rows.length === 1;
}

/** Süresi dolan rezervasyonları serbest bırakır (CANCELLED + EXPIRED deneme). Sağlayıcıdaki karşılığı dönen referanslar iptal edilir. */
export async function expireReservations(tx: Tx, tenantId: string, orderId: string | null, now = new Date()): Promise<string[]> {
  const stale = await tx.payment.findMany({
    where: { tenantId, ...(orderId ? { orderId } : {}), status: { in: [...IN_FLIGHT] }, reservedUntil: { lte: now } },
    select: { id: true, attempts: { where: { status: { in: ["CREATED", "PROCESSING"] } }, select: { id: true, providerReference: true } } },
  });
  if (!stale.length) return [];
  await tx.payment.updateMany({ where: { tenantId, id: { in: stale.map((s) => s.id) }, status: { in: [...IN_FLIGHT] } }, data: { status: "CANCELLED", failureCode: "reservation_expired" } });
  await tx.paymentAttempt.updateMany({ where: { tenantId, id: { in: stale.flatMap((s) => s.attempts.map((a) => a.id)) } }, data: { status: "EXPIRED", completedAt: now } });
  metrics.inc("payments.reservation_expired");
  return stale.flatMap((s) => s.attempts.map((a) => a.providerReference).filter((r): r is string => !!r));
}

export type OrderPaymentView = {
  order: { id: string; branchId: string; publicId: string; orderNumber: number; status: string; currency: string; subtotalMinor: number; discountMinor: number; totalMinor: number };
  summary: PaymentSummary;
  lines: (LinePayable & { allocatedUnits: number; remainingUnits: number; nextUnitsAmounts: number[] })[];
  payable: boolean;
};

/** Siparişin ödeme görünümü: bakiye + kalem bazında kalan adet (kesinleşmiş + etkin rezervasyonlar). */
export async function loadOrderPaymentView(db: Db, tenantId: string, orderId: string, now = new Date()): Promise<OrderPaymentView | null> {
  const order = await db.order.findFirst({
    where: { id: orderId, tenantId },
    select: {
      id: true,
      branchId: true,
      publicId: true,
      orderNumber: true,
      status: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      totalMinor: true,
      items: { orderBy: { sortOrder: "asc" }, select: { id: true, productName: true, variantName: true, quantity: true, unitPriceMinor: true, lineTotalMinor: true } },
      promotion: { select: { promotionType: true, discountMinor: true, freeItemName: true } },
      payments: { select: { id: true, status: true, amountMinor: true, refundedMinor: true, reservedUntil: true, allocations: { where: { orderItemId: { not: null } }, select: { orderItemId: true, quantity: true } } } },
    },
  });
  if (!order) return null;
  const summary = paymentSummary(order.totalMinor, order.payments, now);
  const counting = order.payments.filter((p) => isSettled(p.status) || (IN_FLIGHT.includes(p.status) && !!p.reservedUntil && p.reservedUntil > now));
  const allocated = new Map<string, number>();
  for (const p of counting) for (const a of p.allocations) allocated.set(a.orderItemId!, (allocated.get(a.orderItemId!) ?? 0) + (a.quantity ?? 0));
  const payables = linePayables(
    order.items.map((i) => ({ id: i.id, name: i.productName, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, lineTotalMinor: i.lineTotalMinor })),
    order.promotion ? { promotionType: order.promotion.promotionType, discountMinor: order.promotion.discountMinor, freeItemName: order.promotion.freeItemName } : null,
  );
  const lines = payables.map((l) => {
    const done = Math.min(l.quantity, allocated.get(l.id) ?? 0);
    return { ...l, name: order.items.find((i) => i.id === l.id)!.variantName ? `${l.name} (${order.items.find((i) => i.id === l.id)!.variantName})` : l.name, allocatedUnits: done, remainingUnits: l.quantity - done, nextUnitsAmounts: l.unitPayables.slice(done) };
  });
  const { items: _items, promotion: _promotion, payments: _payments, ...orderFields } = order;
  void _items;
  void _promotion;
  void _payments;
  return { order: orderFields, summary, lines, payable: isPayableOrderStatus(order.status) };
}

// ─── Online ödeme başlatma (müşteri) ────────────────────────────────────────

export type PayRequest = { mode: PaymentSplitMode; amountMinor?: number | null; items?: { orderItemId: string; quantity: number }[]; idempotencyKey: string };
export type PayFailure = "feature_disabled" | "unavailable" | "disabled" | "not_payable" | "nothing_due" | "amount_invalid" | "items_invalid" | "zero_amount" | "idempotency_conflict" | "provider_unavailable" | "not_found";
export type PayResult =
  | { ok: true; publicId: string; status: PaymentStatusName; checkoutUrl: string | null; amountMinor: number; replay: boolean }
  | { ok: false; reason: PayFailure };

class Fail extends Error {
  constructor(readonly reason: PayFailure) {
    super(reason);
  }
}

const requestHash = (orderId: string, req: PayRequest) => createHash("sha256").update(JSON.stringify([orderId, req.mode, req.amountMinor ?? null, (req.items ?? []).map((i) => [i.orderItemId, i.quantity]).sort()])).digest("hex");

async function replay(tenantId: string, keyHash: string, reqHash: string): Promise<PayResult | null> {
  const p = await prisma.payment.findUnique({ where: { tenantId_idempotencyKeyHash: { tenantId, idempotencyKeyHash: keyHash } }, select: { publicId: true, status: true, amountMinor: true, requestHash: true, attempts: { orderBy: { createdAt: "desc" }, take: 1, select: { checkoutUrl: true } } } });
  if (!p) return null;
  if (p.requestHash !== reqHash) return { ok: false, reason: "idempotency_conflict" };
  return { ok: true, publicId: p.publicId, status: p.status, checkoutUrl: IN_FLIGHT.includes(p.status) ? (p.attempts[0]?.checkoutUrl ?? null) : null, amountMinor: p.amountMinor, replay: true };
}

/** Tutarı moda göre SUNUCUDA belirler (kilit altında). */
function resolveAmount(view: OrderPaymentView, req: PayRequest): { amount: number; items: { orderItemId: string; quantity: number; amountMinor: number }[] } {
  const available = view.summary.available;
  if (available <= 0) throw new Fail("nothing_due");
  if (req.mode === "FULL") return { amount: available, items: [] };
  if (req.mode === "AMOUNT" || req.mode === "EQUAL") {
    const a = req.amountMinor;
    if (typeof a !== "number" || !Number.isInteger(a) || a < 1 || a > available) throw new Fail("amount_invalid");
    return { amount: a, items: [] };
  }
  const chosen = req.items ?? [];
  if (!chosen.length || chosen.length > 50 || new Set(chosen.map((c) => c.orderItemId)).size !== chosen.length) throw new Fail("items_invalid");
  const items = chosen.map((c) => {
    const line = view.lines.find((l) => l.id === c.orderItemId);
    if (!line || !Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > line.remainingUnits) throw new Fail("items_invalid");
    return { orderItemId: c.orderItemId, quantity: c.quantity, amountMinor: unitsAmount(line, line.allocatedUnits, c.quantity) };
  });
  const amount = items.reduce((s, i) => s + i.amountMinor, 0);
  if (amount <= 0) throw new Fail("zero_amount");
  if (amount > available) throw new Fail("amount_invalid");
  return { amount, items };
}

export async function startOnlinePayment(input: { tenantId: string; orderId: string; customerId: string | null; returnUrl: string; request: PayRequest; now?: Date }): Promise<PayResult> {
  const provider = getPaymentProvider();
  if (!provider) return { ok: false, reason: "unavailable" };
  const settings = await getPaymentSettings(input.tenantId);
  if (!settings.enabled || !settings.allowOnline) return { ok: false, reason: "disabled" };
  // Paket kapısı (Sprint 20): YENİ ödeme oluşturma yetki ister; iade / mutabakat / mevcut ödeme her zaman çalışır.
  if (!(await resolveEntitlements(input.tenantId)).has("restaurant_payments")) return { ok: false, reason: "feature_disabled" };
  const keyHash = hashKey(input.request.idempotencyKey);
  const reqHash = requestHash(input.orderId, input.request);
  const previous = await replay(input.tenantId, keyHash, reqHash);
  if (previous) return previous;

  const now = input.now ?? new Date();
  let created: { paymentId: string; attemptId: string; publicId: string; amount: number; currency: string; providerKey: string; expiredRefs: string[] };
  try {
    created = await prisma.$transaction(
      async (tx) => {
        if (!(await lockOrder(tx, input.tenantId, input.orderId))) throw new Fail("not_found");
        const expiredRefs = await expireReservations(tx, input.tenantId, input.orderId, now);
        const view = await loadOrderPaymentView(tx, input.tenantId, input.orderId, now);
        if (!view) throw new Fail("not_found");
        if (!view.payable) throw new Fail("not_payable");
        const { amount, items } = resolveAmount(view, input.request);
        const payment = await tx.payment.create({
          data: {
            tenantId: input.tenantId,
            branchId: view.order.branchId,
            orderId: input.orderId,
            publicId: randomBytes(16).toString("base64url"),
            customerId: input.customerId,
            provider: provider.name,
            method: "ONLINE",
            splitMode: input.request.mode,
            status: "PENDING",
            currency: view.order.currency,
            amountMinor: amount,
            reservedUntil: new Date(now.getTime() + settings.reservationMinutes * 60_000),
            idempotencyKeyHash: keyHash,
            requestHash: reqHash,
          },
          select: { id: true, publicId: true },
        });
        await tx.paymentAllocation.createMany({
          data: items.length
            ? items.map((i) => ({ tenantId: input.tenantId, paymentId: payment.id, orderId: input.orderId, orderItemId: i.orderItemId, quantity: i.quantity, amountMinor: i.amountMinor }))
            : [{ tenantId: input.tenantId, paymentId: payment.id, orderId: input.orderId, amountMinor: amount }],
        });
        const providerKey = `${payment.id}:1`;
        const attempt = await tx.paymentAttempt.create({ data: { tenantId: input.tenantId, paymentId: payment.id, provider: provider.name, status: "CREATED", amountMinor: amount, idempotencyKey: providerKey }, select: { id: true } });
        return { paymentId: payment.id, attemptId: attempt.id, publicId: payment.publicId, amount, currency: view.order.currency, providerKey, expiredRefs };
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (error instanceof Fail) return { ok: false, reason: error.reason };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await replay(input.tenantId, keyHash, reqHash);
      if (again) return again;
    }
    throw error;
  }
  for (const ref of created.expiredRefs) await provider.cancelPayment(ref).catch(() => null);

  // Sağlayıcı çağrısı transaction DIŞINDA (ağ). Rezervasyon bu sırada payı tutar.
  const started = Date.now();
  try {
    const r = await provider.createPayment({ reference: created.attemptId, amountMinor: created.amount, currency: created.currency, idempotencyKey: created.providerKey, returnUrl: input.returnUrl, description: "MasaNova sipariş ödemesi" });
    metrics.observe("payments.create_ms", Date.now() - started);
    await prisma.paymentAttempt.updateMany({ where: { id: created.attemptId, tenantId: input.tenantId }, data: { providerReference: r.providerReference, checkoutUrl: r.checkoutUrl, status: r.status === "PENDING" ? "PROCESSING" : r.status === "SUCCEEDED" ? "PROCESSING" : "FAILED", failureCode: r.failureCode } });
    let status: PaymentStatusName;
    if (r.status === "SUCCEEDED") {
      const outcome = await finalizeSuccess(input.tenantId, created.paymentId, r.card, "create");
      status = outcome === "late_conflict" ? "CANCELLED" : "SUCCEEDED";
    } else if (r.status === "FAILED" || r.status === "CANCELLED") {
      await markFailed(input.tenantId, created.paymentId, r.failureCode ?? "provider_failed");
      status = "FAILED";
    } else {
      // Webhook bu arada gelmiş olabilir: yalnızca hâlâ PENDING ise PROCESSING; aksi halde güncel durum okunur.
      const moved = await prisma.payment.updateMany({ where: { id: created.paymentId, tenantId: input.tenantId, status: "PENDING" }, data: { status: "PROCESSING" } });
      status = moved.count ? "PROCESSING" : (await prisma.payment.findUniqueOrThrow({ where: { id: created.paymentId }, select: { status: true } })).status;
    }
    log.info("payment.create", { tenant: input.tenantId, provider: provider.name, outcome: status, durationMs: Date.now() - started });
    return { ok: true, publicId: created.publicId, status, checkoutUrl: status === "PROCESSING" ? r.checkoutUrl : null, amountMinor: created.amount, replay: false };
  } catch (error) {
    const code = error instanceof ProviderUnavailable ? `provider_${error.code}` : "provider_error";
    await prisma.paymentAttempt.updateMany({ where: { id: created.attemptId, tenantId: input.tenantId }, data: { status: "FAILED", failureCode: code, completedAt: new Date() } });
    await markFailed(input.tenantId, created.paymentId, code);
    metrics.inc("payments.provider_failure");
    log.warn("payment.create_failed", { tenant: input.tenantId, provider: provider.name, code });
    return { ok: false, reason: "provider_unavailable" };
  }
}

// ─── Kesinleştirme / başarısızlık (sağlayıcı onayıyla) ──────────────────────

export type FinalizeOutcome = "succeeded" | "duplicate" | "late_conflict" | "not_found";

/**
 * Başarı: sipariş kilidi altında. Zaten kesinleşmişse no-op (yinelenen / sırasız webhook). Geç onay (rezervasyon düşmüş,
 * ödeme CANCELLED / FAILED) bakiye hâlâ uygunsa kabul edilir; değilse ödeme kesinleşmez, `needs_refund` işaretlenir
 * (müşteriden çekilen tutar iade edilmelidir — panelde görünür). Kesinleşen ödeme ASLA geriye dönmez.
 */
export async function finalizeSuccess(tenantId: string, paymentId: string, card: SafeCardMeta | null, source: "create" | "webhook" | "query"): Promise<FinalizeOutcome> {
  return prisma.$transaction(async (tx) => {
    const p0 = await tx.payment.findFirst({ where: { id: paymentId, tenantId }, select: { orderId: true } });
    if (!p0) return "not_found" as const;
    await lockOrder(tx, tenantId, p0.orderId);
    const p = await tx.payment.findFirstOrThrow({ where: { id: paymentId, tenantId }, select: { id: true, status: true, amountMinor: true, orderId: true, allocations: { select: { orderItemId: true, quantity: true } } } });
    if (isSettled(p.status)) return "duplicate" as const;
    const order = await tx.order.findFirstOrThrow({ where: { id: p.orderId, tenantId }, select: { totalMinor: true, items: { select: { id: true, quantity: true } } } });
    const settled = await tx.payment.findMany({ where: { tenantId, orderId: p.orderId, status: { in: [...SETTLED] }, id: { not: p.id } }, select: { amountMinor: true, allocations: { select: { orderItemId: true, quantity: true } } } });
    const settledSum = settled.reduce((s, x) => s + x.amountMinor, 0);
    const itemUse = new Map<string, number>();
    for (const x of [...settled, p]) for (const a of x.allocations) if (a.orderItemId) itemUse.set(a.orderItemId, (itemUse.get(a.orderItemId) ?? 0) + (a.quantity ?? 0));
    const itemsOk = order.items.every((i) => (itemUse.get(i.id) ?? 0) <= i.quantity);
    if (settledSum + p.amountMinor > order.totalMinor || !itemsOk) {
      await tx.payment.updateMany({ where: { id: p.id, tenantId }, data: { status: "CANCELLED", needsRefund: true, failureCode: "late_capacity_conflict" } });
      await tx.paymentAttempt.updateMany({ where: { tenantId, paymentId: p.id, status: { in: ["CREATED", "PROCESSING", "EXPIRED"] } }, data: { status: "SUCCEEDED", completedAt: new Date() } });
      log.warn("payment.late_conflict", { tenant: tenantId, source });
      return "late_conflict" as const;
    }
    await tx.payment.updateMany({ where: { id: p.id, tenantId }, data: { status: "SUCCEEDED", succeededAt: new Date(), reservedUntil: null, failureCode: null, cardBrand: card?.brand?.slice(0, 20) ?? null, cardLast4: card?.last4 && /^[0-9]{4}$/.test(card.last4) ? card.last4 : null } });
    await tx.paymentAttempt.updateMany({ where: { tenantId, paymentId: p.id, status: { in: ["CREATED", "PROCESSING", "EXPIRED", "FAILED"] } }, data: { status: "SUCCEEDED", completedAt: new Date() } });
    metrics.inc("payments.succeeded");
    return "succeeded" as const;
  });
}

/** Başarısızlık yalnızca uçuştaki ödemeyi etkiler (kesinleşmiş ödeme geriye dönmez); rezervasyon serbest kalır. */
export async function markFailed(tenantId: string, paymentId: string, code: string): Promise<void> {
  await prisma.payment.updateMany({ where: { id: paymentId, tenantId, status: { in: [...IN_FLIGHT] } }, data: { status: "FAILED", failureCode: code.slice(0, 60), reservedUntil: null } });
  await prisma.paymentAttempt.updateMany({ where: { tenantId, paymentId, status: { in: ["CREATED", "PROCESSING"] } }, data: { status: "FAILED", failureCode: code.slice(0, 60), completedAt: new Date() } });
}

/** Kayıp webhook'a karşı: uçuştaki ödemenin durumunu sağlayıcıdan sorgular (müşteri dönüş sayfası / panel mutabakatı). */
export async function refreshFromProvider(tenantId: string, paymentId: string): Promise<PaymentStatusName | null> {
  const provider = getPaymentProvider();
  const p = await prisma.payment.findFirst({ where: { id: paymentId, tenantId }, select: { status: true, attempts: { orderBy: { createdAt: "desc" }, take: 1, select: { providerReference: true } } } });
  if (!p) return null;
  const ref = p.attempts[0]?.providerReference;
  if (provider && ref && (IN_FLIGHT.includes(p.status) || p.status === "CANCELLED")) {
    const r = await provider.getPayment(ref).catch(() => null);
    if (r?.status === "SUCCEEDED") await finalizeSuccess(tenantId, paymentId, r.card, "query");
    else if (r?.status === "FAILED" || r?.status === "CANCELLED") await markFailed(tenantId, paymentId, "provider_failed");
  }
  return (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } })).status;
}

// ─── Webhook ────────────────────────────────────────────────────────────────

export type WebhookOutcome = { status: 200 | 400 | 401; outcome: "processed" | "duplicate" | "ignored" | "invalid_signature" | "invalid_payload" | "unknown_reference" };

/** İmza ZORUNLU; olay kimliği tekil (yinelenen olay bir kez işlenir); ham gövde saklanmaz. */
export async function processWebhook(providerName: string, rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  const provider = getPaymentProvider();
  if (!provider || provider.name !== providerName) return { status: 400, outcome: "invalid_payload" };
  const started = Date.now();
  if (!provider.verifyWebhook(rawBody, headers)) {
    metrics.inc("payments.webhook_invalid_signature");
    return { status: 401, outcome: "invalid_signature" };
  }
  const event = provider.parseWebhook(rawBody);
  if (!event) return { status: 400, outcome: "invalid_payload" };
  const attempt = event.providerReference ? await prisma.paymentAttempt.findUnique({ where: { provider_providerReference: { provider: provider.name, providerReference: event.providerReference } }, select: { tenantId: true, paymentId: true } }) : null;
  try {
    await prisma.paymentWebhookEvent.create({ data: { provider: provider.name, eventId: event.eventId, tenantId: attempt?.tenantId ?? null, type: event.type, providerReference: event.providerReference, outcome: "received" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      metrics.inc("payments.webhook_duplicate");
      return { status: 200, outcome: "duplicate" };
    }
    throw error;
  }
  let outcome: WebhookOutcome["outcome"] = "ignored";
  if (!attempt) outcome = "unknown_reference";
  else if (event.type === "payment.succeeded") {
    await finalizeSuccess(attempt.tenantId, attempt.paymentId, event.card, "webhook");
    outcome = "processed";
  } else if (event.type === "payment.failed" || event.type === "payment.cancelled") {
    await markFailed(attempt.tenantId, attempt.paymentId, event.type === "payment.failed" ? "provider_failed" : "provider_cancelled");
    outcome = "processed";
  }
  await prisma.paymentWebhookEvent.updateMany({ where: { provider: provider.name, eventId: event.eventId }, data: { outcome, processedAt: new Date() } });
  metrics.observe("payments.webhook_ms", Date.now() - started);
  return { status: 200, outcome };
}

// ─── Personel: manuel ödeme, iade, mutabakat ────────────────────────────────

export type StaffActor = { scope: TenantScope; userId: string; meta: RequestMeta };
const audit = (tx: Tx, actor: StaffActor | null, action: Parameters<typeof buildAuditRow>[0]["action"], entityId: string, tenantId: string, metadata: Record<string, unknown>) =>
  tx.auditLog.create({ data: buildAuditRow({ action, entity: "Payment", entityId, tenantId, userId: actor?.userId ?? null, metadata }, actor?.meta ?? NO_META) });

/** Kasada alınan nakit / POS / diğer ödeme. Sağlayıcı ödemesi DEĞİLDİR; yine bakiye + rezervasyon kuralına uyar. */
export async function recordManualPayment(actor: StaffActor, input: { orderId: string; method: Exclude<PaymentMethod, "ONLINE">; amountMinor: number | null; idempotencyKey: string; now?: Date }): Promise<PayResult> {
  const tenantId = actor.scope.tenantId;
  const settings = await getPaymentSettings(tenantId);
  if (!(await resolveEntitlements(tenantId)).has("restaurant_payments")) return { ok: false, reason: "feature_disabled" };
  if ((input.method === "CASH" && !settings.allowCash) || (input.method === "CARD_TERMINAL" && !settings.allowCardTerminal)) return { ok: false, reason: "disabled" };
  const keyHash = hashKey(input.idempotencyKey);
  const reqHash = requestHash(input.orderId, { mode: input.amountMinor ? "AMOUNT" : "FULL", amountMinor: input.amountMinor, idempotencyKey: "" }) + input.method;
  const previous = await replay(tenantId, keyHash, reqHash);
  if (previous) return previous;
  const now = input.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await lockOrder(tx, tenantId, input.orderId))) throw new Fail("not_found");
      await expireReservations(tx, tenantId, input.orderId, now);
      const view = await loadOrderPaymentView(tx, tenantId, input.orderId, now);
      if (!view) throw new Fail("not_found");
      if (!view.payable) throw new Fail("not_payable");
      const { amount } = resolveAmount(view, { mode: input.amountMinor ? "AMOUNT" : "FULL", amountMinor: input.amountMinor, idempotencyKey: "" });
      const order = await tx.order.findFirstOrThrow({ where: { id: input.orderId, tenantId }, select: { branchId: true, customerId: true } });
      const payment = await tx.payment.create({
        data: { tenantId, branchId: order.branchId, orderId: input.orderId, publicId: randomBytes(16).toString("base64url"), customerId: order.customerId, provider: "manual", method: input.method, splitMode: input.amountMinor ? "AMOUNT" : "FULL", status: "SUCCEEDED", currency: view.order.currency, amountMinor: amount, succeededAt: now, idempotencyKeyHash: keyHash, requestHash: reqHash, createdByUserId: actor.userId },
        select: { id: true, publicId: true },
      });
      await tx.paymentAllocation.create({ data: { tenantId, paymentId: payment.id, orderId: input.orderId, amountMinor: amount } });
      await audit(tx, actor, "PAYMENT_MANUAL_RECORDED", payment.id, tenantId, { orderId: input.orderId, method: input.method, amountMinor: amount });
      return { ok: true as const, publicId: payment.publicId, status: "SUCCEEDED" as const, checkoutUrl: null, amountMinor: amount, replay: false };
    });
  } catch (error) {
    if (error instanceof Fail) return { ok: false, reason: error.reason };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return (await replay(tenantId, keyHash, reqHash)) ?? { ok: false, reason: "idempotency_conflict" };
    throw error;
  }
}

export type RefundResult = { ok: true; status: "SUCCEEDED" | "FAILED"; refundedMinor: number; replay: boolean } | { ok: false; reason: "not_found" | "over_limit" | "invalid" | "provider_unavailable" };

/**
 * İade: kesinleşmiş ve iade edilmemiş tutar kadar (bekleyen iadeler düşülerek). Ödeme satırı kilitlenir; asıl tutar
 * DEĞİŞMEZ, iade ayrı değiştirilemez kayıt. Politika (belgelendi): iade bakiyeyi yeniden açmaz, sadakat / kupon
 * durumunu değiştirmez (onlar sipariş yaşam döngüsünü izler: ret / iptal).
 */
export async function refundPayment(actor: StaffActor, input: { paymentId: string; amountMinor: number; reason: string | null; idempotencyKey: string }): Promise<RefundResult> {
  const tenantId = actor.scope.tenantId;
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 1) return { ok: false, reason: "invalid" };
  const keyHash = hashKey(`refund:${input.idempotencyKey}`);
  const existing = await prisma.paymentRefund.findUnique({ where: { tenantId_idempotencyKeyHash: { tenantId, idempotencyKeyHash: keyHash } }, select: { status: true, payment: { select: { refundedMinor: true } } } });
  if (existing) return { ok: true, status: existing.status === "FAILED" ? "FAILED" : "SUCCEEDED", refundedMinor: existing.payment.refundedMinor, replay: true };
  let prepared: { refundId: string; provider: string; ref: string | null; method: PaymentMethod };
  try {
    prepared = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${input.paymentId} AND tenant_id = ${tenantId} FOR UPDATE`;
      if (!locked.length) throw new Fail("not_found");
      const p = await tx.payment.findFirstOrThrow({ where: { id: input.paymentId, tenantId }, select: { status: true, amountMinor: true, refundedMinor: true, provider: true, method: true, refunds: { where: { status: "PENDING" }, select: { amountMinor: true } }, attempts: { where: { status: "SUCCEEDED" }, take: 1, select: { providerReference: true } } } });
      const pending = p.refunds.reduce((s, r) => s + r.amountMinor, 0);
      if (input.amountMinor > refundableMinor(p) - pending) throw new Error("over_limit");
      const r = await tx.paymentRefund.create({ data: { tenantId, paymentId: input.paymentId, amountMinor: input.amountMinor, status: "PENDING", reason: input.reason, idempotencyKeyHash: keyHash, createdByUserId: actor.userId }, select: { id: true } });
      await audit(tx, actor, "PAYMENT_REFUND_REQUESTED", input.paymentId, tenantId, { amountMinor: input.amountMinor, method: p.method });
      return { refundId: r.id, provider: p.provider, ref: p.attempts[0]?.providerReference ?? null, method: p.method };
    });
  } catch (error) {
    if (error instanceof Fail) return { ok: false, reason: "not_found" };
    if (error instanceof Error && error.message === "over_limit") return { ok: false, reason: "over_limit" };
    throw error;
  }
  // Online ödeme: sağlayıcıda iade; manuel ödeme: kasadan geri ödeme kaydı (sağlayıcı yok).
  let ok = true;
  let providerRef: string | null = null;
  if (prepared.method === "ONLINE") {
    const provider = getPaymentProvider();
    if (!provider || !prepared.ref) ok = false;
    else {
      const started = Date.now();
      const r = await provider.refundPayment({ providerReference: prepared.ref, amountMinor: input.amountMinor, idempotencyKey: prepared.refundId }).catch(() => ({ ok: false, providerReference: null, failureCode: "provider_error" }));
      metrics.observe("payments.refund_ms", Date.now() - started);
      ok = r.ok;
      providerRef = r.providerReference;
    }
  }
  const refunded = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${input.paymentId} AND tenant_id = ${tenantId} FOR UPDATE`;
    await tx.paymentRefund.updateMany({ where: { id: prepared.refundId, tenantId }, data: { status: ok ? "SUCCEEDED" : "FAILED", providerReference: providerRef, completedAt: new Date() } });
    const p = await tx.payment.findFirstOrThrow({ where: { id: input.paymentId, tenantId }, select: { amountMinor: true, refundedMinor: true } });
    if (!ok) return p.refundedMinor;
    const next = p.refundedMinor + input.amountMinor;
    await tx.payment.updateMany({ where: { id: input.paymentId, tenantId }, data: { refundedMinor: next, status: statusAfterRefund(p.amountMinor, next) } });
    await audit(tx, actor, "PAYMENT_REFUNDED", input.paymentId, tenantId, { amountMinor: input.amountMinor, refundedMinor: next });
    return next;
  });
  return { ok: true, status: ok ? "SUCCEEDED" : "FAILED", refundedMinor: refunded, replay: false };
}

/** Yerel ↔ sağlayıcı durumu karşılaştırması (sahip). Uçuştaki ödemeyi sağlayıcı durumuna göre günceller. */
export async function reconcilePayment(actor: StaffActor, paymentId: string) {
  const tenantId = actor.scope.tenantId;
  const before = await prisma.payment.findFirst({ where: { id: paymentId, tenantId }, select: { status: true, method: true, attempts: { orderBy: { createdAt: "desc" }, take: 1, select: { providerReference: true } } } });
  if (!before) return null;
  const provider = getPaymentProvider();
  const ref = before.attempts[0]?.providerReference;
  const remote = before.method === "ONLINE" && provider && ref ? await provider.getPayment(ref).catch(() => null) : null;
  const after = await refreshFromProvider(tenantId, paymentId);
  return { local: before.status, provider: remote?.status ?? (before.method === "ONLINE" ? "UNKNOWN" : "MANUAL"), after };
}

// ─── Ayarlar ────────────────────────────────────────────────────────────────

export type PaymentSettingsInput = { enabled: boolean; allowOnline: boolean; allowCash: boolean; allowCardTerminal: boolean; reservationMinutes: number };

/** İşletme ödeme ayarları (sahip / müdür). Sağlayıcı anahtarları burada DEĞİL — sunucu ortam değişkenlerinde. */
export async function updatePaymentSettings(actor: StaffActor, input: PaymentSettingsInput): Promise<void> {
  const tenantId = actor.scope.tenantId;
  await prisma.$transaction(async (tx) => {
    const before = await getPaymentSettings(tenantId, tx);
    await tx.paymentSettings.upsert({ where: { tenantId }, create: { tenantId, ...input }, update: input });
    await tx.auditLog.create({ data: buildAuditRow({ action: "PAYMENT_PROVIDER_SETTING_UPDATED", entity: "PaymentSettings", entityId: tenantId, tenantId, userId: actor.userId, metadata: { before, after: input } }, actor.meta) });
  });
}

import "server-only";
import type { OrderStatus, Prisma, StationType, TicketStatus } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import type { AuditAction } from "@/lib/audit/actions";
import { prisma } from "@/lib/db/prisma";
import { planTicketRouting, type RoutingStation } from "@/lib/orders/routing";
import { canStaffTransition, canStaffTransitionTicket, deriveOrderStatus, formatOrderNumber, ORDER_STATUS_LABELS, TICKET_STATUS_LABELS } from "@/lib/orders/status";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { flushEvents, type OrderRef, type PendingEvent } from "@/server/realtime/bus";
import { earnLoyaltyInTx, reverseLoyaltyInTx } from "@/server/crm/loyalty.service";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * Sipariş yaşam döngüsü (personel + sistem). Geçiş tablosu (src/lib/orders/status.ts) tek kaynaktır.
 *
 * Eşzamanlılık: her değişiklik "beklenen önceki durum" koşullu güncellemedir (iki personel aynı anda karar verirse
 * yalnızca biri uygulanır). Fiş geçişleri sipariş satırını FOR UPDATE ile kilitler — iki istasyon aynı anda "Hazır"
 * dediğinde otomatik sipariş durumu (PREPARING / READY) TEK kez uygulanır ve tek kez yayınlanır.
 * Olaylar yalnızca transaction commit edildikten SONRA yayınlanır (geri alınan işlem olay üretmez).
 */
export type StaffActor = { userId: string; scope: TenantScope; meta: RequestMeta };

type Tx = Prisma.TransactionClient;
type Outcome = { ok: true; message: string; events: PendingEvent[] } | { ok: false; error: string };

const CONFLICT = "Sipariş bu sırada başka biri tarafından güncellendi. Sayfayı yenileyin.";
const AUDIT_FOR: Partial<Record<OrderStatus, AuditAction>> = {
  ACCEPTED: "ORDER_ACCEPTED",
  REJECTED: "ORDER_REJECTED",
  PREPARING: "ORDER_PREPARING",
  READY: "ORDER_READY",
  SERVED: "ORDER_SERVED",
  CANCELLED: "ORDER_CANCELLED",
};

function finish(outcome: Outcome): ActionResult {
  if (!outcome.ok) return { ok: false, error: outcome.error };
  flushEvents(outcome.events);
  return { ok: true, data: undefined, message: outcome.message };
}

function timestampFor(to: OrderStatus, now: Date): Prisma.OrderUpdateManyMutationInput {
  switch (to) {
    case "ACCEPTED":
      return { acceptedAt: now };
    case "REJECTED":
      return { rejectedAt: now };
    case "PREPARING":
      return { preparingAt: now };
    case "READY":
      return { readyAt: now };
    case "SERVED":
      return { servedAt: now };
    case "CANCELLED":
      return { cancelledAt: now };
    default:
      return {};
  }
}

/** Koşullu durum güncellemesi + geçmiş + denetim. Satır beklenen durumda değilse false. */
async function applyOrderTransition(
  tx: Tx,
  input: { tenantId: string; order: { id: string; orderNumber: number }; from: OrderStatus; to: OrderStatus; now: Date; actorUserId: string | null; reason?: string | null; meta: RequestMeta; extra?: Prisma.OrderUpdateManyMutationInput },
): Promise<boolean> {
  const { tenantId, order, from, to, now } = input;
  const updated = await tx.order.updateMany({ where: { id: order.id, tenantId, status: from }, data: { status: to, ...timestampFor(to, now), ...input.extra } });
  if (updated.count !== 1) return false;
  await tx.orderStatusHistory.create({
    data: { tenantId, orderId: order.id, fromStatus: from, toStatus: to, actorType: input.actorUserId ? "STAFF" : "SYSTEM", actorUserId: input.actorUserId, reason: input.reason ?? null },
  });
  const action = AUDIT_FOR[to];
  if (action) {
    await tx.auditLog.create({
      data: buildAuditRow(
        { action, entity: "Order", entityId: order.id, tenantId, userId: input.actorUserId, metadata: { orderNumber: order.orderNumber, from, to, reason: input.reason ?? null, automatic: !input.actorUserId } },
        input.meta,
      ),
    });
  }
  // Sadakat: TEK merkezi kazanım noktası (varsayılan SERVED). Aynı transaction — geçiş geri alınırsa puan da yazılmaz;
  // sipariş başına tek EARN veritabanı benzersizliğiyle garanti. REJECTED / CANCELLED hiçbir zaman puan üretmez.
  await earnLoyaltyInTx(tx, { tenantId, orderId: order.id, to });
  // Ret / iptal: kullanılan ödül puanı iade + kazanılmış puan geri alma (tek kez, yeni defter satırı).
  if (to === "REJECTED" || to === "CANCELLED") await reverseLoyaltyInTx(tx, { tenantId, orderId: order.id });
  return true;
}

async function findOrder(tenantId: string, orderId: string) {
  return prisma.order.findFirst({ where: { id: orderId, tenantId }, select: { id: true, status: true, orderNumber: true, branchId: true } });
}

const wrongState = (status: OrderStatus) => ({ ok: false as const, error: `Bu sipariş “${ORDER_STATUS_LABELS[status]}” durumunda; bu işlem yapılamaz.` });

// ─── Kabul (fiş üretimi ile atomik) ─────────────────────────────────────────

/**
 * Kabul: kalemler şubenin istasyonlarına yönlendirilir ve fişler AYNI transaction'da oluşturulur. Yönlendirilemeyen
 * kalem varsa (atama yok + varsayılan yok/pasif) sipariş KABUL EDİLMEZ — kalem sessizce kaybolmaz.
 */
export async function acceptOrder(actor: StaffActor, orderId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const order = await findOrder(tenantId, orderId);
  if (!order) return { ok: false, error: "Sipariş bulunamadı." };
  if (!canStaffTransition(order.status, "ACCEPTED")) return wrongState(order.status);
  const ref: OrderRef = { tenantId, orderId: order.id, orderNumber: order.orderNumber };
  const now = new Date();

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    const [items, branch, routes] = await Promise.all([
      tx.orderItem.findMany({ where: { orderId: order.id, tenantId }, orderBy: { sortOrder: "asc" }, select: { id: true, productId: true, productNameDefault: true } }),
      tx.branch.findFirst({ where: { id: order.branchId, tenantId }, select: { defaultStation: { select: { id: true, name: true, type: true, active: true } } } }),
      tx.productPreparationStation.findMany({
        where: { tenantId, branchId: order.branchId },
        select: { productId: true, station: { select: { id: true, name: true, type: true, active: true, sortOrder: true } } },
        orderBy: { station: { sortOrder: "asc" } },
      }),
    ]);
    const assignments = new Map<string, RoutingStation[]>();
    for (const r of routes) assignments.set(r.productId, [...(assignments.get(r.productId) ?? []), r.station]);
    const plan = planTicketRouting({ items: items.map((i) => ({ id: i.id, productId: i.productId, name: i.productNameDefault })), assignments, defaultStation: branch?.defaultStation ?? null });
    if (plan.unrouted.length) {
      const names = [...new Set(plan.unrouted.map((i) => i.name))].join(", ");
      return { ok: false, error: `${plan.unrouted.length} ürün için hazırlama istasyonu tanımlanmamış (${names}). Mutfak › İstasyonlar'dan varsayılan istasyon seçin.` };
    }

    if (!(await applyOrderTransition(tx, { tenantId, order, from: order.status, to: "ACCEPTED", now, actorUserId: actor.userId, meta: actor.meta }))) return { ok: false, error: CONFLICT };

    const events: PendingEvent[] = [{ kind: "order", order: ref, status: "ACCEPTED" }];
    const sortIndex = new Map(items.map((i, index) => [i.id, index]));
    for (const ticket of plan.tickets) {
      const created = await tx.orderTicket.create({
        data: {
          tenantId,
          branchId: order.branchId,
          orderId: order.id,
          stationId: ticket.station.id,
          stationName: ticket.station.name,
          stationType: ticket.station.type as StationType,
          createdAt: now,
        },
        select: { id: true },
      });
      await tx.orderTicketItem.createMany({ data: ticket.itemIds.map((orderItemId) => ({ tenantId, ticketId: created.id, orderItemId, sortOrder: sortIndex.get(orderItemId) ?? 0 })) });
      events.push({ kind: "ticket", order: ref, ticketId: created.id, stationId: ticket.station.id, status: "PENDING" });
    }
    return { ok: true, message: `${formatOrderNumber(order.orderNumber)} kabul edildi · ${plan.tickets.length} istasyon fişi oluşturuldu.`, events };
  });
  return finish(outcome);
}

// ─── Ret / servis / iptal ───────────────────────────────────────────────────

export async function rejectOrder(actor: StaffActor, orderId: string, reason: string | null): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const order = await findOrder(tenantId, orderId);
  if (!order) return { ok: false, error: "Sipariş bulunamadı." };
  if (!canStaffTransition(order.status, "REJECTED")) return wrongState(order.status);
  const now = new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    const applied = await applyOrderTransition(tx, { tenantId, order, from: order.status, to: "REJECTED", now, actorUserId: actor.userId, reason, meta: actor.meta, extra: { rejectionReason: reason } });
    if (!applied) return { ok: false, error: CONFLICT };
    return { ok: true, message: `${formatOrderNumber(order.orderNumber)} reddedildi.`, events: [{ kind: "order", order: { tenantId, orderId: order.id, orderNumber: order.orderNumber }, status: "REJECTED" }] };
  });
  return finish(outcome);
}

export async function serveOrder(actor: StaffActor, orderId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const order = await findOrder(tenantId, orderId);
  if (!order) return { ok: false, error: "Sipariş bulunamadı." };
  if (!canStaffTransition(order.status, "SERVED")) return wrongState(order.status);
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    const applied = await applyOrderTransition(tx, { tenantId, order, from: order.status, to: "SERVED", now: new Date(), actorUserId: actor.userId, meta: actor.meta });
    if (!applied) return { ok: false, error: CONFLICT };
    return { ok: true, message: `${formatOrderNumber(order.orderNumber)} servis edildi.`, events: [{ kind: "order", order: { tenantId, orderId: order.id, orderNumber: order.orderNumber }, status: "SERVED" }] };
  });
  return finish(outcome);
}

/** İptal (ACCEPTED / PREPARING): açıklama zorunlu; açık fişler de iptal edilir. Ödeme / iade bu sürümde yok. */
export async function cancelOrder(actor: StaffActor, orderId: string, reason: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const order = await findOrder(tenantId, orderId);
  if (!order) return { ok: false, error: "Sipariş bulunamadı." };
  if (!canStaffTransition(order.status, "CANCELLED")) return wrongState(order.status);
  const ref: OrderRef = { tenantId, orderId: order.id, orderNumber: order.orderNumber };
  const now = new Date();
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    const applied = await applyOrderTransition(tx, { tenantId, order, from: order.status, to: "CANCELLED", now, actorUserId: actor.userId, reason, meta: actor.meta, extra: { cancellationReason: reason } });
    if (!applied) return { ok: false, error: CONFLICT };
    const open = await tx.orderTicket.findMany({ where: { orderId: order.id, tenantId, status: { in: ["PENDING", "PREPARING"] } }, select: { id: true, stationId: true } });
    await tx.orderTicket.updateMany({ where: { orderId: order.id, tenantId, status: { in: ["PENDING", "PREPARING"] } }, data: { status: "CANCELLED", cancelledAt: now } });
    const events: PendingEvent[] = [{ kind: "order", order: ref, status: "CANCELLED" }];
    for (const t of open) events.push({ kind: "ticket", order: ref, ticketId: t.id, stationId: t.stationId, status: "CANCELLED" });
    return { ok: true, message: `${formatOrderNumber(order.orderNumber)} iptal edildi.`, events };
  });
  return finish(outcome);
}

// ─── İstasyon fişi (KDS) ────────────────────────────────────────────────────

/**
 * Fiş geçişi (PENDING → PREPARING → READY). Sipariş satırı kilitlenir; fiş koşullu güncellenir; ardından sipariş
 * durumu fişlerden türetilir (ilk başlayan fiş → PREPARING; TÜM fişler hazır → READY) ve sistem aktörüyle yazılır.
 */
export async function transitionTicket(actor: StaffActor, ticketId: string, to: TicketStatus): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const ticket = await prisma.orderTicket.findFirst({
    where: { id: ticketId, tenantId },
    select: { id: true, status: true, stationId: true, stationName: true, orderId: true, order: { select: { orderNumber: true } } },
  });
  if (!ticket) return { ok: false, error: "Fiş bulunamadı." };
  if (!canStaffTransitionTicket(ticket.status, to)) return { ok: false, error: `Bu fiş “${TICKET_STATUS_LABELS[ticket.status]}” durumunda; bu işlem yapılamaz.` };
  const ref: OrderRef = { tenantId, orderId: ticket.orderId, orderNumber: ticket.order.orderNumber };
  const now = new Date();

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // Aynı siparişin fişleri sırayla işlenir (otomatik sipariş durumu tek kez uygulanır).
    const locked = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM orders WHERE id = ${ticket.orderId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const orderStatus = locked[0]?.status;
    if (!orderStatus) return { ok: false, error: "Sipariş bulunamadı." };
    if (orderStatus !== "ACCEPTED" && orderStatus !== "PREPARING") return { ok: false, error: `Sipariş “${ORDER_STATUS_LABELS[orderStatus]}” durumunda; fiş güncellenemez.` };

    const updated = await tx.orderTicket.updateMany({
      where: { id: ticket.id, tenantId, status: ticket.status },
      data: { status: to, ...(to === "PREPARING" ? { startedAt: now } : {}), ...(to === "READY" ? { readyAt: now } : {}) },
    });
    if (updated.count !== 1) return { ok: false, error: "Fiş bu sırada başka bir ekranda güncellendi." };
    await tx.auditLog.create({
      data: buildAuditRow(
        { action: to === "READY" ? "TICKET_READY" : "TICKET_PREPARING", entity: "OrderTicket", entityId: ticket.id, tenantId, userId: actor.userId, metadata: { orderNumber: ref.orderNumber, station: ticket.stationName, from: ticket.status, to } },
        actor.meta,
      ),
    });
    const events: PendingEvent[] = [{ kind: "ticket", order: ref, ticketId: ticket.id, stationId: ticket.stationId, status: to }];

    const all = await tx.orderTicket.findMany({ where: { orderId: ticket.orderId, tenantId }, select: { status: true } });
    let current: OrderStatus = orderStatus;
    // ACCEPTED → (PREPARING) → READY: aynı anda tüm fişler hazırsa ara adım da tarihçeye yazılır.
    for (let step = 0; step < 2; step++) {
      const next = deriveOrderStatus(current, all);
      if (!next) break;
      const target: OrderStatus = current === "ACCEPTED" ? "PREPARING" : next;
      const ok = await applyOrderTransition(tx, { tenantId, order: { id: ticket.orderId, orderNumber: ref.orderNumber }, from: current, to: target, now, actorUserId: null, meta: actor.meta });
      if (!ok) break;
      events.push({ kind: "order", order: ref, status: target });
      current = target;
    }
    const message = to === "READY" ? (current === "READY" ? `${formatOrderNumber(ref.orderNumber)} tamamen hazır.` : `${ticket.stationName} fişi hazır.`) : `${formatOrderNumber(ref.orderNumber)} hazırlanıyor.`;
    return { ok: true, message, events };
  });
  return finish(outcome);
}

/** Personel durum eylemi dağıtıcısı (yetki eylem katmanında STAFF_TRANSITION_PERMISSION ile denetlenir). */
export async function changeOrderStatus(actor: StaffActor, orderId: string, to: OrderStatus, reason: string | null): Promise<ActionResult> {
  switch (to) {
    case "ACCEPTED":
      return acceptOrder(actor, orderId);
    case "REJECTED":
      return rejectOrder(actor, orderId, reason);
    case "SERVED":
      return serveOrder(actor, orderId);
    case "CANCELLED":
      return reason ? cancelOrder(actor, orderId, reason) : { ok: false, error: "İptal nedeni zorunlu." };
    default:
      return { ok: false, error: "Bu durum elle atanamaz; mutfak ekranındaki fişlerden otomatik ilerler." };
  }
}

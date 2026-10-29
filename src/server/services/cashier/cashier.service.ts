import "server-only";
import { prisma } from "@/lib/db/prisma";
import { buildTableBills, OPEN_WINDOW_MS, type TableBill } from "@/lib/cashier/bill";
import { PAYABLE_ORDER_STATUSES } from "@/lib/payments/state";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { publishServiceRequest } from "@/server/realtime/bus";
import { recordManualPayment, type PayFailure } from "@/server/payments/payment.service";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * Kasa / adisyon ekranı (Full paket, cashier_screen). Masa başına açık hesap = masanın son 24 saatteki ödenebilir
 * siparişlerinin kalan bakiyesi (ayrı "hesap" kaydı yok, şema değişmez). Kapatma = her açık siparişe mevcut kasa
 * kaydıyla (recordManualPayment: kilit + bakiye + idempotency + denetim) nakit / kart ödemesi + masanın HESAP
 * taleplerini tamamlama. Kapsam her zaman oturumdan; masa / sipariş yalnızca kiracı içinde aranır.
 */
export type CashierActor = { scope: TenantScope; userId: string; displayName: string; meta: RequestMeta };

export type CashierTable = {
  id: string;
  name: string;
  area: string | null;
  branch: string;
  bill: TableBill | null;
  /** Müşteri QR'dan "Hesap" istedi (açık talep). printed: adisyon basıldı (talep üstlenildi), ödeme bekleniyor. */
  billRequest: { id: string; at: Date; printed: boolean } | null;
  /** Henüz kabul edilmemiş sipariş sayısı (adisyona girmez; kasiyer bilsin). */
  pendingOrders: number;
};

const ACTIVE_REQUEST = ["OPEN", "ACKNOWLEDGED"] as const;

async function openOrders(tenantId: string, now: Date, tableId?: string) {
  return prisma.order.findMany({
    where: { tenantId, ...(tableId ? { tableId } : {}), createdAt: { gte: new Date(now.getTime() - OPEN_WINDOW_MS) }, status: { in: [...PAYABLE_ORDER_STATUSES] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tableId: true,
      orderNumber: true,
      createdAt: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      totalMinor: true,
      items: { orderBy: { id: "asc" }, select: { productNameDefault: true, variantName: true, quantity: true, unitPriceMinor: true, lineTotalMinor: true, modifiers: { orderBy: { sortOrder: "asc" }, select: { modifierName: true } } } },
      payments: { select: { status: true, amountMinor: true, refundedMinor: true, reservedUntil: true } },
    },
  });
}

function toBillInput(orders: Awaited<ReturnType<typeof openOrders>>) {
  return orders.map((o) => ({
    ...o,
    items: o.items.map((i) => ({ name: i.productNameDefault, variant: i.variantName, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, lineTotalMinor: i.lineTotalMinor, modifiers: i.modifiers.map((m) => m.modifierName) })),
  }));
}

export async function loadCashierBoard(scope: TenantScope, now = new Date()): Promise<{ tables: CashierTable[]; currency: string }> {
  const tenantId = scope.tenantId;
  const [tables, orders, requests, pending, settings] = await Promise.all([
    prisma.diningTable.findMany({
      where: { tenantId, active: true, branch: { active: true } },
      orderBy: [{ branch: { name: "asc" } }, { area: { sortOrder: "asc" } }, { sortOrder: "asc" }, { number: "asc" }, { name: "asc" }],
      select: { id: true, name: true, area: { select: { name: true } }, branch: { select: { name: true } } },
    }),
    openOrders(tenantId, now),
    prisma.tableServiceRequest.findMany({ where: { tenantId, type: "BILL", status: { in: [...ACTIVE_REQUEST] } }, orderBy: { createdAt: "asc" }, select: { id: true, tableId: true, createdAt: true, status: true } }),
    prisma.order.groupBy({ by: ["tableId"], where: { tenantId, status: "SUBMITTED", createdAt: { gte: new Date(now.getTime() - OPEN_WINDOW_MS) } }, _count: { _all: true } }),
    prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultCurrency: true } }),
  ]);
  const bills = buildTableBills(toBillInput(orders), now);
  const requestByTable = new Map(requests.map((r) => [r.tableId, { id: r.id, at: r.createdAt, printed: r.status === "ACKNOWLEDGED" }]));
  const pendingByTable = new Map(pending.map((p) => [p.tableId, p._count._all]));
  return {
    currency: settings?.defaultCurrency ?? "TRY",
    tables: tables.map((t) => ({ id: t.id, name: t.name, area: t.area?.name ?? null, branch: t.branch.name, bill: bills.get(t.id) ?? null, billRequest: requestByTable.get(t.id) ?? null, pendingOrders: pendingByTable.get(t.id) ?? 0 })),
  };
}

/** Adisyon basıldı: masanın AÇIK hesap talebi "üstlenildi" olur (yanıp sönme durur, ödeme beklenir). */
export async function markBillPrinted(actor: CashierActor, tableId: string, now = new Date()): Promise<void> {
  const tenantId = actor.scope.tenantId;
  const open = await prisma.tableServiceRequest.findMany({ where: { tenantId, tableId, type: "BILL", status: "OPEN" }, select: { id: true, tableName: true } });
  for (const r of open) {
    const applied = await prisma.$transaction(async (tx) => {
      const u = await tx.tableServiceRequest.updateMany({ where: { id: r.id, tenantId, status: "OPEN" }, data: { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedByUserId: actor.userId, acknowledgedByName: actor.displayName } });
      if (u.count !== 1) return false;
      await tx.tableServiceRequestStatusHistory.create({ data: { tenantId, requestId: r.id, fromStatus: "OPEN", toStatus: "ACKNOWLEDGED", actorType: "STAFF", actorUserId: actor.userId, createdAt: now } });
      await tx.auditLog.create({ data: buildAuditRow({ action: "SERVICE_REQUEST_ACKNOWLEDGED", entity: "TableServiceRequest", entityId: r.id, tenantId, userId: actor.userId, metadata: { type: "BILL", table: r.tableName, via: "cashier_print" } }, actor.meta) });
      return true;
    });
    if (applied) publishServiceRequest({ tenantId, tableId, requestId: r.id, kind: "BILL" }, "ACKNOWLEDGED");
  }
}

export type CloseTableResult = { ok: true; paidMinor: number; orders: number } | { ok: false; reason: PayFailure | "nothing_open" | "partial"; paidMinor: number };

/**
 * Hesabı kapat: masanın açık siparişlerinin TAMAMI seçilen yöntemle ödenir (sipariş başına mevcut kasa kaydı).
 * Her sipariş ayrı idempotency anahtarıyla (çift dokunuşta çift ödeme yok). Hepsi ödendiyse HESAP talepleri tamamlanır.
 */
export async function closeTableBill(actor: CashierActor, input: { tableId: string; method: "CASH" | "CARD_TERMINAL"; key: string }, now = new Date()): Promise<CloseTableResult> {
  const tenantId = actor.scope.tenantId;
  const bill = buildTableBills(toBillInput(await openOrders(tenantId, now, input.tableId)), now).get(input.tableId);
  if (!bill) return { ok: false, reason: "nothing_open", paidMinor: 0 };
  let paidMinor = 0;
  let failure: PayFailure | null = null;
  for (const orderId of bill.orderIds) {
    const r = await recordManualPayment({ scope: actor.scope, userId: actor.userId, meta: actor.meta }, { orderId, method: input.method, amountMinor: null, idempotencyKey: `cashier:${input.key}:${orderId}`, now });
    if (r.ok) paidMinor += r.amountMinor;
    else if (r.reason !== "nothing_due") failure ??= r.reason;
  }
  if (failure) return { ok: false, reason: paidMinor > 0 ? "partial" : failure, paidMinor };

  const requests = await prisma.tableServiceRequest.findMany({ where: { tenantId, tableId: input.tableId, type: "BILL", status: { in: [...ACTIVE_REQUEST] } }, select: { id: true, status: true, tableName: true } });
  for (const r of requests) {
    const applied = await prisma.$transaction(async (tx) => {
      const u = await tx.tableServiceRequest.updateMany({
        where: { id: r.id, tenantId, status: r.status },
        data: { status: "COMPLETED", completedAt: now, completedByUserId: actor.userId, activeSlot: null, ...(r.status === "OPEN" ? { acknowledgedAt: now, acknowledgedByUserId: actor.userId, acknowledgedByName: actor.displayName } : {}) },
      });
      if (u.count !== 1) return false;
      await tx.tableServiceRequestStatusHistory.create({ data: { tenantId, requestId: r.id, fromStatus: r.status, toStatus: "COMPLETED", actorType: "STAFF", actorUserId: actor.userId, createdAt: now } });
      await tx.auditLog.create({ data: buildAuditRow({ action: "SERVICE_REQUEST_COMPLETED", entity: "TableServiceRequest", entityId: r.id, tenantId, userId: actor.userId, metadata: { type: "BILL", table: r.tableName, via: "cashier_close", method: input.method } }, actor.meta) });
      return true;
    });
    if (applied) publishServiceRequest({ tenantId, tableId: input.tableId, requestId: r.id, kind: "BILL" }, "COMPLETED");
  }
  return { ok: true, paidMinor, orders: bill.orderIds.length };
}

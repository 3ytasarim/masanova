import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma, type ServiceRequestStatus, type ServiceRequestType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { PUBLIC_ORDER_WINDOW_MS } from "@/server/repositories/orders.repository";
import { ACTIVE_SLOT, CUSTOMER_RECENT_WINDOW_MS } from "@/lib/service-requests/duplicate";
import { canCustomerCancel } from "@/lib/service-requests/status";
import { publishServiceRequest } from "@/server/realtime/bus";
import { buildAuditRow } from "@/server/services/audit.service";
import { resolveEntitlements } from "@/server/billing/entitlements";

/**
 * Müşteri servis talebi (QR masa; oturum yok). Bağlam YALNIZCA güvenilir QR bağlamından kurulur (eylem katmanı
 * getTableQrContext ile) — tarayıcının gönderdiği kiracı / şube / masa kimliği hiçbir yerde kullanılmaz.
 *
 * Mükerrer koruma: masa + tip başına tek aktif talep. Hızlı yol mevcut aktif talebi döndürür; eşzamanlı gönderimde
 * yarışı veritabanı benzersizliği (table_id, type, active_slot) çözer → P2002 yakalanır ve mevcut talep döner.
 * Olay yalnızca commit sonrası yayınlanır. Denetim kaydında IP / tarayıcı / token tutulmaz.
 */
export type ServiceRequestContext = {
  tenantId: string;
  branchId: string;
  tableId: string;
  areaId: string | null;
  tokenId: string;
  branchName: string;
  areaName: string | null;
  tableName: string;
  /** İsteğe bağlı müşteri ilişkisi (yalnızca kayıt; servis panosunda müşteri iletişimi GÖSTERİLMEZ). */
  customerId?: string | null;
};

/** Müşteriye giden en küçük görünüm — iç kimlik, personel kimliği, e-posta yok. */
export type CustomerServiceRequestView = {
  publicId: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  note: string | null;
  staffName: string | null;
  createdAt: string;
};

export type SubmitServiceResult = { kind: "created" | "duplicate"; request: CustomerServiceRequestView } | { kind: "rejected"; reason: "invalid" | "feature_disabled" };

const viewSelect = { publicId: true, type: true, status: true, note: true, acknowledgedByName: true, createdAt: true } as const;
type ViewRow = { publicId: string; type: ServiceRequestType; status: ServiceRequestStatus; note: string | null; acknowledgedByName: string | null; createdAt: Date };

export function toCustomerView(r: ViewRow): CustomerServiceRequestView {
  return {
    publicId: r.publicId,
    type: r.type,
    status: r.status,
    note: r.note,
    staffName: r.status === "ACKNOWLEDGED" || r.status === "COMPLETED" ? r.acknowledgedByName : null,
    createdAt: r.createdAt.toISOString(),
  };
}

function findActive(ctx: ServiceRequestContext, type: ServiceRequestType) {
  return prisma.tableServiceRequest.findFirst({ where: { tenantId: ctx.tenantId, tableId: ctx.tableId, type, activeSlot: ACTIVE_SLOT }, select: viewSelect });
}

/** Hesap talebi için ilgili sipariş: müşterinin bu cihazda verdiği siparişlerden, AYNI kiracı + masa + 24 saat içinde doğrulanan en yenisi. Tahmin yok. */
async function resolveRelatedOrder(ctx: ServiceRequestContext, publicIds: readonly string[], now: Date): Promise<string | null> {
  if (!publicIds.length) return null;
  const order = await prisma.order.findFirst({
    where: { publicId: { in: [...publicIds] }, tenantId: ctx.tenantId, tableId: ctx.tableId, createdAt: { gte: new Date(now.getTime() - PUBLIC_ORDER_WINDOW_MS) }, status: { notIn: ["REJECTED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return order?.id ?? null;
}

export async function submitServiceRequest(ctx: ServiceRequestContext, input: { type: ServiceRequestType; note: string | null; recentOrderIds: readonly string[] }, now = new Date()): Promise<SubmitServiceResult> {
  const note = input.type === "CUSTOM" ? input.note : null;
  if (input.type === "CUSTOM" && !note) return { kind: "rejected", reason: "invalid" };
  // Paket kapısı (Sprint 20): YENİ talep yetki ister; açık talepler personel tarafından tamamlanmaya devam eder.
  if (!(await resolveEntitlements(ctx.tenantId)).has("service_requests")) return { kind: "rejected", reason: "feature_disabled" };

  const existing = await findActive(ctx, input.type);
  if (existing) return { kind: "duplicate", request: toCustomerView(existing) };

  const relatedOrderId = input.type === "BILL" ? await resolveRelatedOrder(ctx, input.recentOrderIds, now) : null;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.tableServiceRequest.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: ctx.branchId,
          tableId: ctx.tableId,
          diningAreaId: ctx.areaId,
          qrTokenId: ctx.tokenId,
          customerId: ctx.customerId ?? null,
          publicId: randomBytes(16).toString("base64url"),
          type: input.type,
          status: "OPEN",
          activeSlot: ACTIVE_SLOT,
          note,
          relatedOrderId,
          branchName: ctx.branchName,
          areaName: ctx.areaName,
          tableName: ctx.tableName,
          createdAt: now,
        },
        select: { id: true, ...viewSelect },
      });
      await tx.tableServiceRequestStatusHistory.create({ data: { tenantId: ctx.tenantId, requestId: row.id, fromStatus: null, toStatus: "OPEN", actorType: "CUSTOMER", createdAt: now } });
      await tx.auditLog.create({
        data: buildAuditRow(
          {
            action: "SERVICE_REQUEST_CREATED",
            entity: "TableServiceRequest",
            entityId: row.id,
            tenantId: ctx.tenantId,
            userId: null,
            metadata: { source: "qr_table", actor: "customer", type: input.type, branchId: ctx.branchId, tableId: ctx.tableId, hasNote: !!note, relatedOrder: !!relatedOrderId },
          },
          { ipAddress: null, userAgent: null },
        ),
      });
      return row;
    });
    publishServiceRequest({ tenantId: ctx.tenantId, tableId: ctx.tableId, requestId: created.id, kind: input.type }, "OPEN");
    return { kind: "created", request: toCustomerView(created) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Eşzamanlı gönderim: diğer istek kazandı → onun talebini döndür.
      const winner = await findActive(ctx, input.type);
      if (winner) return { kind: "duplicate", request: toCustomerView(winner) };
    }
    throw error;
  }
}

/** Masanın müşteri ekranındaki talepleri: aktifler + son 10 dakikada kapananlar (geri bildirim için). */
export async function listCustomerRequests(ctx: Pick<ServiceRequestContext, "tenantId" | "tableId">, now = new Date()): Promise<CustomerServiceRequestView[]> {
  const since = new Date(now.getTime() - CUSTOMER_RECENT_WINDOW_MS);
  const rows = await prisma.tableServiceRequest.findMany({
    where: {
      tenantId: ctx.tenantId,
      tableId: ctx.tableId,
      OR: [{ activeSlot: ACTIVE_SLOT }, { completedAt: { gte: since } }, { cancelledAt: { gte: since } }],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: viewSelect,
  });
  return rows.map(toCustomerView);
}

/** Müşteri iptali: yalnızca AYNI masa bağlamından ve yalnızca OPEN (personel üstlendiyse iptal yok). */
export async function cancelCustomerRequest(ctx: ServiceRequestContext, publicId: string, now = new Date()): Promise<{ ok: true } | { ok: false; reason: "not_found" | "wrong_status" }> {
  const request = await prisma.tableServiceRequest.findFirst({ where: { publicId, tenantId: ctx.tenantId, tableId: ctx.tableId }, select: { id: true, type: true, status: true } });
  if (!request) return { ok: false, reason: "not_found" };
  if (!canCustomerCancel(request)) return { ok: false, reason: "wrong_status" };
  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.tableServiceRequest.updateMany({
      where: { id: request.id, tenantId: ctx.tenantId, status: "OPEN" },
      data: { status: "CANCELLED", activeSlot: null, cancelledAt: now, cancelledBy: "CUSTOMER" },
    });
    if (updated.count !== 1) return false;
    await tx.tableServiceRequestStatusHistory.create({ data: { tenantId: ctx.tenantId, requestId: request.id, fromStatus: "OPEN", toStatus: "CANCELLED", actorType: "CUSTOMER", createdAt: now } });
    await tx.auditLog.create({
      data: buildAuditRow(
        { action: "SERVICE_REQUEST_CANCELLED", entity: "TableServiceRequest", entityId: request.id, tenantId: ctx.tenantId, userId: null, metadata: { actor: "customer", type: request.type } },
        { ipAddress: null, userAgent: null },
      ),
    });
    return true;
  });
  if (!applied) return { ok: false, reason: "wrong_status" };
  publishServiceRequest({ tenantId: ctx.tenantId, tableId: ctx.tableId, requestId: request.id, kind: request.type }, "CANCELLED");
  return { ok: true };
}


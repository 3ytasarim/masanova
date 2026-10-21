import "server-only";
import type { Prisma, ServiceRequestStatus } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import type { AuditAction } from "@/lib/audit/actions";
import { prisma } from "@/lib/db/prisma";
import type { RequestMeta } from "@/lib/security/request-meta";
import { canClaim, canComplete, canStaffCancel, type ServiceAbilities, type ServiceDecision } from "@/lib/service-requests/status";
import { SERVICE_TYPE_LABELS } from "@/lib/service-requests/types";
import type { TenantScope } from "@/lib/tenant/scope";
import { publishServiceRequest } from "@/server/realtime/bus";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * Personel servis işlemleri — üstlen ("Ben ilgileniyorum"), tamamla, iptal (yönetici).
 * Kapsam her zaman oturumdan; talep yalnızca kapsam içinde aranır. Durum "beklenen önceki durum" koşullu güncellemeyle
 * değişir: iki garson aynı anda üstlenirse yalnızca biri kazanır, diğeri net bir mesaj alır (üzerine yazma yok).
 * Tamamlama: üstlenen kişi ya da yönetici (override); başka bir garson tamamlayamaz (yeniden atama bu sürümde yok).
 */
export type ServiceStaffActor = { userId: string; displayName: string; scope: TenantScope; meta: RequestMeta; abilities: ServiceAbilities };

const MESSAGES = {
  forbidden: "Bu talebi yönetme yetkiniz yok.",
  not_assignee: "Bu talep başka bir personel tarafından üstlenildi; yalnızca o kişi ya da yönetici tamamlayabilir.",
  claimed: "Bu talep başka bir personel tarafından alındı.",
  completed: "Talep zaten tamamlanmış.",
  cancelled: "Talep iptal edilmiş.",
  claimFirst: "Önce talebi üstlenin (“Ben ilgileniyorum”).",
  notFound: "Talep bulunamadı.",
} as const;

function stateMessage(status: ServiceRequestStatus): string {
  return status === "ACKNOWLEDGED" ? MESSAGES.claimed : status === "COMPLETED" ? MESSAGES.completed : status === "CANCELLED" ? MESSAGES.cancelled : MESSAGES.claimFirst;
}

function refuse(decision: Exclude<ServiceDecision, { ok: true }>, status: ServiceRequestStatus): ActionResult {
  return { ok: false, error: decision.reason === "wrong_status" ? stateMessage(status) : MESSAGES[decision.reason] };
}

async function load(actor: ServiceStaffActor, requestId: string) {
  return prisma.tableServiceRequest.findFirst({
    where: { id: requestId, tenantId: actor.scope.tenantId },
    select: { id: true, type: true, status: true, tableId: true, tableName: true, acknowledgedByUserId: true },
  });
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

async function finalize(actor: ServiceStaffActor, request: Loaded, input: { from: ServiceRequestStatus; to: ServiceRequestStatus; action: AuditAction; extra?: Record<string, unknown>; now: Date }, update: (tx: Prisma.TransactionClient) => Promise<{ count: number }>) {
  const applied = await prisma.$transaction(async (tx) => {
    const updated = await update(tx);
    if (updated.count !== 1) return false;
    await tx.tableServiceRequestStatusHistory.create({
      data: { tenantId: actor.scope.tenantId, requestId: request.id, fromStatus: input.from, toStatus: input.to, actorType: "STAFF", actorUserId: actor.userId, createdAt: input.now },
    });
    await tx.auditLog.create({
      data: buildAuditRow(
        { action: input.action, entity: "TableServiceRequest", entityId: request.id, tenantId: actor.scope.tenantId, userId: actor.userId, metadata: { type: request.type, table: request.tableName, from: input.from, to: input.to, ...input.extra } },
        actor.meta,
      ),
    });
    return true;
  });
  if (applied) publishServiceRequest({ tenantId: actor.scope.tenantId, tableId: request.tableId, requestId: request.id, kind: request.type }, input.to);
  return applied;
}

/** "Ben ilgileniyorum": OPEN → ACKNOWLEDGED (atomik; eşzamanlı ikinci tıklama kaybeder). */
export async function claimServiceRequest(actor: ServiceStaffActor, requestId: string, now = new Date()): Promise<ActionResult> {
  const request = await load(actor, requestId);
  if (!request) return { ok: false, error: MESSAGES.notFound };
  const decision = canClaim(actor, request);
  if (!decision.ok) return refuse(decision, request.status);
  const tenantId = actor.scope.tenantId;
  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.tableServiceRequest.updateMany({
      where: { id: request.id, tenantId, status: "OPEN" },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedByUserId: actor.userId, acknowledgedByName: actor.displayName },
    });
    if (updated.count !== 1) return false;
    await tx.tableServiceRequestStatusHistory.create({ data: { tenantId, requestId: request.id, fromStatus: "OPEN", toStatus: "ACKNOWLEDGED", actorType: "STAFF", actorUserId: actor.userId, createdAt: now } });
    await tx.auditLog.create({
      data: buildAuditRow(
        { action: "SERVICE_REQUEST_ACKNOWLEDGED", entity: "TableServiceRequest", entityId: request.id, tenantId, userId: actor.userId, metadata: { type: request.type, table: request.tableName } },
        actor.meta,
      ),
    });
    return true;
  });
  if (!applied) {
    const fresh = await load(actor, requestId);
    return { ok: false, error: stateMessage(fresh?.status ?? "ACKNOWLEDGED") };
  }
  publishServiceRequest({ tenantId, tableId: request.tableId, requestId: request.id, kind: request.type }, "ACKNOWLEDGED");
  return { ok: true, data: undefined, message: `${request.tableName} · ${SERVICE_TYPE_LABELS[request.type]} sizde.` };
}

/** Tamamla: ACKNOWLEDGED → COMPLETED (üstlenen ya da yönetici). Kayıt silinmez; aktif yuva boşalır (yeni talep açılabilir). */
export async function completeServiceRequest(actor: ServiceStaffActor, requestId: string, now = new Date()): Promise<ActionResult> {
  const request = await load(actor, requestId);
  if (!request) return { ok: false, error: MESSAGES.notFound };
  const decision = canComplete(actor, request);
  if (!decision.ok) return refuse(decision, request.status);
  const tenantId = actor.scope.tenantId;
  const applied = await finalize(actor, request, { from: "ACKNOWLEDGED", to: "COMPLETED", action: "SERVICE_REQUEST_COMPLETED", extra: { override: request.acknowledgedByUserId !== actor.userId }, now }, (tx) =>
    tx.tableServiceRequest.updateMany({
      // Üstlenen değiştiyse (ör. başka bir yönetici işlemi) koşul tutmaz → üzerine yazma yok.
      where: { id: request.id, tenantId, status: "ACKNOWLEDGED", acknowledgedByUserId: request.acknowledgedByUserId },
      data: { status: "COMPLETED", completedAt: now, completedByUserId: actor.userId, activeSlot: null },
    }),
  );
  if (!applied) {
    const fresh = await load(actor, requestId);
    return { ok: false, error: stateMessage(fresh?.status ?? "COMPLETED") };
  }
  return { ok: true, data: undefined, message: `${request.tableName} · ${SERVICE_TYPE_LABELS[request.type]} tamamlandı.` };
}

/** Yönetici iptali (yanlışlıkla / mükerrer talep): OPEN | ACKNOWLEDGED → CANCELLED. */
export async function cancelServiceRequestByStaff(actor: ServiceStaffActor, requestId: string, now = new Date()): Promise<ActionResult> {
  const request = await load(actor, requestId);
  if (!request) return { ok: false, error: MESSAGES.notFound };
  const decision = canStaffCancel(actor, request);
  if (!decision.ok) return refuse(decision, request.status);
  const tenantId = actor.scope.tenantId;
  const applied = await finalize(actor, request, { from: request.status, to: "CANCELLED", action: "SERVICE_REQUEST_CANCELLED", extra: { actor: "staff" }, now }, (tx) =>
    tx.tableServiceRequest.updateMany({
      where: { id: request.id, tenantId, status: request.status },
      data: { status: "CANCELLED", cancelledAt: now, cancelledBy: "STAFF", activeSlot: null },
    }),
  );
  if (!applied) {
    const fresh = await load(actor, requestId);
    return { ok: false, error: stateMessage(fresh?.status ?? "CANCELLED") };
  }
  return { ok: true, data: undefined, message: `${request.tableName} · ${SERVICE_TYPE_LABELS[request.type]} iptal edildi.` };
}

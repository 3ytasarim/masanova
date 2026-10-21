import "server-only";
import type { Prisma } from "@prisma/client";
import type { AuditAction, AuditEntity } from "@/lib/audit/actions";
import { prisma } from "@/lib/db/prisma";
import type { OpeningInterval } from "@/lib/reservations/availability";
import type { ReservationPolicy } from "@/lib/reservations/rules";
import { buildAuditRow } from "@/server/services/audit.service";
import { getPolicy } from "@/server/reservations/context";
import type { StaffActor } from "@/server/reservations/booking.service";

/**
 * Rezervasyon ayarları (sahip / müdür): kurallar, şube açılış saatleri, kapalı dönemler, masa birleşimleri.
 * Her değişiklik denetlenir. Kimlikler yalnızca KİRACI (ve şube) içinde aranır.
 */
type Tx = Prisma.TransactionClient;
const auditRow = (actor: StaffActor, entity: AuditEntity, entityId: string, metadata: Record<string, unknown>, action: AuditAction = "RESERVATION_SETTINGS_UPDATED") =>
  buildAuditRow({ action, entity, entityId, tenantId: actor.scope.tenantId, userId: actor.userId, metadata }, actor.meta);

async function ownBranch(tx: Tx, tenantId: string, branchId: string) {
  return tx.branch.findFirst({ where: { id: branchId, tenantId }, select: { id: true } });
}

export async function savePolicy(actor: StaffActor, input: ReservationPolicy): Promise<void> {
  const tenantId = actor.scope.tenantId;
  await prisma.$transaction(async (tx) => {
    const before = await getPolicy(tenantId, tx);
    await tx.reservationSettings.upsert({ where: { tenantId }, create: { tenantId, ...input }, update: input });
    await tx.auditLog.create({ data: auditRow(actor, "ReservationSettings", tenantId, { before, after: input }) });
  });
}

/** Haftalık saatler: gün başına en fazla 3 aralık, çakışmasız (doğrulama eylemde). Tamamen değiştirir. */
export async function setOpeningHours(actor: StaffActor, branchId: string, hours: { weekday: number; intervals: OpeningInterval[] }[]): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    if (!(await ownBranch(tx, tenantId, branchId))) return false;
    await tx.branchOpeningHours.deleteMany({ where: { tenantId, branchId } });
    const rows = hours.flatMap((d) => d.intervals.map((i) => ({ tenantId, branchId, weekday: d.weekday, opensMinute: i.opensMinute, closesMinute: i.closesMinute })));
    if (rows.length) await tx.branchOpeningHours.createMany({ data: rows });
    await tx.auditLog.create({ data: auditRow(actor, "BranchOpeningHours", branchId, { intervals: rows.length }) });
    return true;
  });
}

export async function addBlackout(actor: StaffActor, branchId: string, input: { startsAt: Date; endsAt: Date; reason: string | null }): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    if (!(await ownBranch(tx, tenantId, branchId))) return false;
    const row = await tx.reservationBlackout.create({ data: { tenantId, branchId, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason, createdByUserId: actor.userId }, select: { id: true } });
    await tx.auditLog.create({ data: auditRow(actor, "ReservationBlackout", row.id, { branchId, startsAt: input.startsAt, endsAt: input.endsAt, op: "create" }) });
    return true;
  });
}

export async function deleteBlackout(actor: StaffActor, id: string): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const r = await tx.reservationBlackout.deleteMany({ where: { id, tenantId } });
    if (r.count !== 1) return false;
    await tx.auditLog.create({ data: auditRow(actor, "ReservationBlackout", id, { op: "delete" }) });
    return true;
  });
}

export async function createCombination(actor: StaffActor, branchId: string, name: string, tableIds: string[]): Promise<"ok" | "invalid" | "duplicate"> {
  const tenantId = actor.scope.tenantId;
  const unique = [...new Set(tableIds)];
  if (unique.length < 2 || unique.length > 6) return "invalid";
  return prisma.$transaction(async (tx) => {
    const tables = await tx.diningTable.count({ where: { tenantId, branchId, id: { in: unique } } });
    if (tables !== unique.length) return "invalid";
    if (await tx.tableCombination.findFirst({ where: { tenantId, branchId, name } })) return "duplicate";
    const combo = await tx.tableCombination.create({ data: { tenantId, branchId, name }, select: { id: true } });
    await tx.tableCombinationTable.createMany({ data: unique.map((tableId) => ({ tenantId, branchId, combinationId: combo.id, tableId })) });
    await tx.auditLog.create({ data: auditRow(actor, "TableCombination", combo.id, { branchId, tables: unique.length, op: "create" }) });
    return "ok";
  });
}

export async function deleteCombination(actor: StaffActor, id: string): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const r = await tx.tableCombination.deleteMany({ where: { id, tenantId } });
    if (r.count !== 1) return false;
    await tx.auditLog.create({ data: auditRow(actor, "TableCombination", id, { op: "delete" }) });
    return true;
  });
}

export async function loadSettingsPage(tenantId: string, branchId: string) {
  const [policy, hours, blackouts, combinations, tables] = await Promise.all([
    getPolicy(tenantId),
    prisma.branchOpeningHours.findMany({ where: { tenantId, branchId }, orderBy: [{ weekday: "asc" }, { opensMinute: "asc" }], select: { weekday: true, opensMinute: true, closesMinute: true } }),
    prisma.reservationBlackout.findMany({ where: { tenantId, branchId, endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 50, select: { id: true, startsAt: true, endsAt: true, reason: true } }),
    prisma.tableCombination.findMany({ where: { tenantId, branchId }, orderBy: { name: "asc" }, select: { id: true, name: true, tables: { select: { table: { select: { name: true, capacity: true } } } } } }),
    prisma.diningTable.findMany({ where: { tenantId, branchId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, capacity: true, reservable: true, area: { select: { name: true } } } }),
  ]);
  return { policy, hours, blackouts, combinations, tables };
}

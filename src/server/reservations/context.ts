import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Busy, EngineCombination, EngineTable, Interval, OpeningInterval } from "@/lib/reservations/availability";
import { DEFAULT_POLICY, type ReservationPolicy } from "@/lib/reservations/rules";

/**
 * Rezervasyon için şube bağlamı (masalar, birleşimler, açılış saatleri) ve zaman penceresindeki doluluk.
 * Doluluk sorgusu YALNIZCA istenen pencereyle kesişen etkin satırları okur (geçmiş rezervasyonlar yüklenmez):
 *   reservation_tables WHERE tenant + branch + active AND starts_at < pencere_sonu AND blocked_until > pencere_başı
 * (tenant_id, branch_id, starts_at) indeksi + EXCLUDE kısıtının gist indeksi.
 */
type Db = Prisma.TransactionClient | typeof prisma;

const POLICY_SELECT = {
  enabled: true,
  publicBookingEnabled: true,
  autoConfirm: true,
  defaultDurationMinutes: true,
  slotIntervalMinutes: true,
  minAdvanceMinutes: true,
  maxAdvanceDays: true,
  minPartySize: true,
  maxPartySize: true,
  bufferMinutes: true,
  cancellationCutoffMinutes: true,
  noShowGraceMinutes: true,
} satisfies Prisma.ReservationSettingsSelect;

export async function getPolicy(tenantId: string, db: Db = prisma): Promise<ReservationPolicy> {
  return (await db.reservationSettings.findUnique({ where: { tenantId }, select: POLICY_SELECT })) ?? DEFAULT_POLICY;
}

export type BranchContext = {
  branch: { id: string; name: string; slug: string; timeZone: string };
  tables: EngineTable[];
  combinations: EngineCombination[];
  hoursByWeekday: Map<number, OpeningInterval[]>;
  areas: { id: string; name: string }[];
};

export async function loadBranchContext(tenantId: string, branchId: string, db: Db = prisma): Promise<BranchContext | null> {
  const branch = await db.branch.findFirst({ where: { id: branchId, tenantId, active: true }, select: { id: true, name: true, slug: true, timezone: true } });
  if (!branch) return null;
  const [tables, combos, hours, areas] = await Promise.all([
    db.diningTable.findMany({
      where: { tenantId, branchId, active: true, OR: [{ diningAreaId: null }, { area: { active: true } }] },
      select: { id: true, name: true, diningAreaId: true, capacity: true, capacityMin: true, reservable: true, active: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.tableCombination.findMany({ where: { tenantId, branchId, active: true }, select: { id: true, name: true, active: true, tables: { select: { tableId: true } } } }),
    db.branchOpeningHours.findMany({ where: { tenantId, branchId }, select: { weekday: true, opensMinute: true, closesMinute: true } }),
    db.diningArea.findMany({ where: { tenantId, branchId, active: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const hoursByWeekday = new Map<number, OpeningInterval[]>();
  for (const h of hours) hoursByWeekday.set(h.weekday, [...(hoursByWeekday.get(h.weekday) ?? []), { opensMinute: h.opensMinute, closesMinute: h.closesMinute }]);
  return {
    branch: { id: branch.id, name: branch.name, slug: branch.slug, timeZone: branch.timezone },
    tables: tables.map((t) => ({ id: t.id, name: t.name, areaId: t.diningAreaId, capacity: t.capacity, capacityMin: t.capacityMin, reservable: t.reservable, active: t.active, sortOrder: t.sortOrder })),
    combinations: combos.map((c) => ({ id: c.id, name: c.name, active: c.active, tableIds: c.tables.map((t) => t.tableId) })),
    hoursByWeekday,
    areas,
  };
}

export async function loadBusy(tenantId: string, branchId: string, window: Interval, db: Db = prisma, excludeReservationId?: string): Promise<Busy[]> {
  const rows = await db.reservationTable.findMany({
    where: {
      tenantId,
      branchId,
      active: true,
      startsAt: { lt: new Date(window.end) },
      blockedUntil: { gt: new Date(window.start) },
      ...(excludeReservationId ? { reservationId: { not: excludeReservationId } } : {}),
    },
    select: { tableId: true, startsAt: true, blockedUntil: true },
  });
  return rows.map((r) => ({ tableId: r.tableId, start: r.startsAt.getTime(), end: r.blockedUntil.getTime() }));
}

export async function loadBlackouts(tenantId: string, branchId: string, window: Interval, db: Db = prisma): Promise<Interval[]> {
  const rows = await db.reservationBlackout.findMany({
    where: { tenantId, branchId, startsAt: { lt: new Date(window.end) }, endsAt: { gt: new Date(window.start) } },
    select: { startsAt: true, endsAt: true },
  });
  return rows.map((r) => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() }));
}

/** Kiracının etkin şubeleri (public seçim). Kimlik değil SLUG ile çözülür. */
export async function listReservableBranches(tenantId: string) {
  return prisma.branch.findMany({ where: { tenantId, active: true }, select: { id: true, name: true, slug: true, timezone: true }, orderBy: { name: "asc" } });
}

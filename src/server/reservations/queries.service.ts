import "server-only";
import { prisma } from "@/lib/db/prisma";
import { displayName, maskEmail, maskPhone } from "@/lib/crm/contact";
import { candidateAssignments, occupancy } from "@/lib/reservations/availability";
import { ACTIVE_STATUSES, type ReservationStatusName } from "@/lib/reservations/status";
import { addDays, DATE_RE, localDayBounds, localParts } from "@/lib/reservations/time";
import type { TenantScope } from "@/lib/tenant/scope";
import { loadBranchContext, loadBusy } from "@/server/reservations/context";

/**
 * Panel okuma sorguları. Görünürlük KİRACI düzeyindedir (personel → şube ataması henüz yok); şube seçimi filtredir.
 * Listede iletişim HER ZAMAN maskeli; ayrıntıda yetkili personele tam (destek modunda maskeli).
 * Rezervasyon verisi KDS'e, servis panosuna, sesli AI'ya gitmez.
 */
/** Etkin şubeler; masası olan şube önce gelir (masasız şube varsayılan seçilmesin). */
export async function panelBranches(scope: TenantScope) {
  const rows = await prisma.branch.findMany({ where: { tenantId: scope.tenantId, active: true }, select: { id: true, name: true, timezone: true, _count: { select: { diningTables: { where: { active: true } } } } }, orderBy: { name: "asc" } });
  return [...rows].sort((a, b) => Number(b._count.diningTables > 0) - Number(a._count.diningTables > 0)).map((b) => ({ id: b.id, name: b.name, timezone: b.timezone }));
}

const rowSelect = {
  id: true,
  guestName: true,
  guestPhone: true,
  partySize: true,
  startsAt: true,
  endsAt: true,
  durationMinutes: true,
  status: true,
  source: true,
  customerId: true,
  specialRequest: true,
  overridden: true,
  preferredArea: { select: { name: true } },
  tables: { select: { table: { select: { id: true, name: true, area: { select: { name: true } } } } } },
} as const;

export async function listDay(scope: TenantScope, branch: { id: string; timezone: string }, date: string) {
  const { start, end } = localDayBounds(date, branch.timezone);
  const rows = await prisma.reservation.findMany({ where: { tenantId: scope.tenantId, branchId: branch.id, startsAt: { gte: start, lt: end } }, orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }], select: rowSelect });
  return rows.map((r) => ({
    ...r,
    guestPhone: maskPhone(r.guestPhone),
    localTime: localParts(r.startsAt, branch.timezone).minute,
    tableNames: r.tables.map((t) => t.table.name),
    areaNames: [...new Set(r.tables.map((t) => t.table.area?.name).filter((n): n is string => !!n))],
  }));
}
export type DayRow = Awaited<ReturnType<typeof listDay>>[number];

/** Zaman çizelgesi: bölgelere göre masalar + o gün masalara düşen rezervasyon blokları (yerel dakika). */
export async function timeline(scope: TenantScope, branch: { id: string; timezone: string }, date: string) {
  const { start, end } = localDayBounds(date, branch.timezone);
  const [tables, rows, hours] = await Promise.all([
    prisma.diningTable.findMany({
      where: { tenantId: scope.tenantId, branchId: branch.id, active: true },
      orderBy: [{ area: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, capacity: true, reservable: true, area: { select: { id: true, name: true } } },
    }),
    prisma.reservationTable.findMany({
      where: { tenantId: scope.tenantId, branchId: branch.id, startsAt: { lt: end }, blockedUntil: { gt: start }, reservation: { status: { notIn: ["CANCELLED"] } } },
      select: { tableId: true, reservation: { select: { id: true, guestName: true, partySize: true, status: true, startsAt: true, endsAt: true } } },
    }),
    prisma.branchOpeningHours.findMany({ where: { tenantId: scope.tenantId, branchId: branch.id }, select: { weekday: true, opensMinute: true, closesMinute: true } }),
  ]);
  const dayStart = start.getTime();
  const blocks = rows.map((r) => ({
    tableId: r.tableId,
    id: r.reservation.id,
    guestName: r.reservation.guestName,
    partySize: r.reservation.partySize,
    status: r.reservation.status,
    from: Math.max(0, Math.round((r.reservation.startsAt.getTime() - dayStart) / 60_000)),
    to: Math.min(Math.round((end.getTime() - dayStart) / 60_000), Math.round((r.reservation.endsAt.getTime() - dayStart) / 60_000)),
  }));
  return { tables, blocks, hours };
}

/** Takvim: ayın günleri için toplam / etkin rezervasyon ve kişi sayısı. */
export async function monthSummary(scope: TenantScope, branch: { id: string; timezone: string }, month: string) {
  const first = `${month}-01`;
  if (!DATE_RE.test(first)) return new Map<string, { total: number; active: number; guests: number }>();
  const next = addDays(first, 40).slice(0, 7) + "-01";
  const { start } = localDayBounds(first, branch.timezone);
  const { start: end } = localDayBounds(next, branch.timezone);
  const rows = await prisma.reservation.findMany({ where: { tenantId: scope.tenantId, branchId: branch.id, startsAt: { gte: start, lt: end } }, select: { startsAt: true, status: true, partySize: true } });
  const out = new Map<string, { total: number; active: number; guests: number }>();
  for (const r of rows) {
    const d = localParts(r.startsAt, branch.timezone).date;
    const cur = out.get(d) ?? { total: 0, active: 0, guests: 0 };
    cur.total++;
    if (ACTIVE_STATUSES.includes(r.status) || r.status === "COMPLETED") {
      cur.active++;
      cur.guests += r.partySize;
    }
    out.set(d, cur);
  }
  return out;
}

export async function reservationDetail(scope: TenantScope, id: string, opts: { reveal: boolean }) {
  const r = await prisma.reservation.findFirst({
    where: { id, tenantId: scope.tenantId },
    select: {
      ...rowSelect,
      guestEmail: true,
      bufferMinutes: true,
      internalNote: true,
      createdAt: true,
      branchId: true,
      locale: true,
      branch: { select: { name: true, timezone: true } },
      customer: { select: { id: true, firstName: true, lastName: true, publicId: true } },
      history: { orderBy: { createdAt: "asc" }, select: { id: true, fromStatus: true, toStatus: true, actorType: true, actorUserId: true, reason: true, createdAt: true } },
    },
  });
  if (!r) return null;
  const actorIds = [...new Set(r.history.map((h) => h.actorUserId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const names = new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
  return {
    ...r,
    guestPhone: opts.reveal ? r.guestPhone : maskPhone(r.guestPhone),
    guestEmail: opts.reveal ? r.guestEmail : maskEmail(r.guestEmail),
    masked: !opts.reveal,
    customer: r.customer ? { id: r.customer.id, name: displayName(r.customer) } : null,
    history: r.history.map((h) => ({ ...h, actorName: h.actorUserId ? (names.get(h.actorUserId) ?? "Personel") : h.actorType === "CUSTOMER" ? "Müşteri" : "Sistem" })),
  };
}

/** Masa değiştirme seçenekleri (kendi bloğu hariç tutularak). */
export async function reassignOptions(scope: TenantScope, id: string) {
  const r = await prisma.reservation.findFirst({ where: { id, tenantId: scope.tenantId }, select: { branchId: true, startsAt: true, durationMinutes: true, bufferMinutes: true, partySize: true, preferredAreaId: true, status: true } });
  if (!r || !ACTIVE_STATUSES.includes(r.status)) return [];
  const ctx = await loadBranchContext(scope.tenantId, r.branchId);
  if (!ctx) return [];
  const block = occupancy(r.startsAt, r.durationMinutes, r.bufferMinutes);
  const busy = await loadBusy(scope.tenantId, r.branchId, block, prisma, id);
  return candidateAssignments({ tables: ctx.tables, combinations: ctx.combinations, busy, block, partySize: r.partySize, preferredAreaId: r.preferredAreaId }).slice(0, 12);
}

/** Masalar sayfası: şu an masada oturan rezervasyon bağlamı (yalnız ad + kişi; iletişim yok). */
export async function seatedByTable(scope: TenantScope): Promise<Map<string, { guestName: string; partySize: number }>> {
  const rows = await prisma.reservationTable.findMany({
    where: { tenantId: scope.tenantId, active: true, reservation: { status: "SEATED" } },
    select: { tableId: true, reservation: { select: { guestName: true, partySize: true } } },
  });
  return new Map(rows.map((r) => [r.tableId, r.reservation]));
}

/** Analitik (Sprint 12 eki): toplamlar — kişisel veri yok. */
export async function reservationMetrics(scope: TenantScope, range: { from: Date; to: Date; branchId?: string | null; timeZone: string }) {
  const rows = await prisma.reservation.findMany({
    where: { tenantId: scope.tenantId, startsAt: { gte: range.from, lt: range.to }, ...(range.branchId ? { branchId: range.branchId } : {}) },
    select: { status: true, partySize: true, startsAt: true, source: true },
  });
  const byStatus: Record<ReservationStatusName, number> = { PENDING: 0, CONFIRMED: 0, SEATED: 0, COMPLETED: 0, CANCELLED: 0, NO_SHOW: 0 };
  const byHour = new Array<number>(24).fill(0);
  let guests = 0;
  let walkIns = 0;
  for (const r of rows) {
    byStatus[r.status]++;
    if (r.status !== "CANCELLED") {
      guests += r.partySize;
      byHour[Math.floor(localParts(r.startsAt, range.timeZone).minute / 60)]! += r.partySize;
    }
    if (r.source === "WALK_IN") walkIns++;
  }
  const seatedOrDone = byStatus.SEATED + byStatus.COMPLETED;
  const kept = rows.length - byStatus.CANCELLED;
  return { total: rows.length, byStatus, seated: seatedOrDone, walkIns, guests, avgParty: kept ? guests / kept : null, byHour };
}

import "server-only";
import { Prisma, type ServiceRequestStatus, type ServiceRequestType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ACTIVE_SLOT } from "@/lib/service-requests/duplicate";
import { zonedDayBounds } from "@/lib/service-requests/timing";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * Servis talebi okumaları — her sorgu kapsamın tenantId'siyle süzülür. Tarihsel kayıtlar asla silinmez; "bugün"
 * metrikleri restoran saat dilimine göre (şube filtresi varsa şubenin, yoksa işletmenin) tarih filtresiyle hesaplanır.
 */
export type ServiceBoardFilters = { branchId?: string; areaId?: string; type?: ServiceRequestType; mineUserId?: string; q?: string };

/** Aktif talepler eskise de panodan düşmez (otomatik tamamlama yok); güvenlik sınırı olarak üst limit. */
export const SERVICE_BOARD_ACTIVE_LIMIT = 200;
export const SERVICE_BOARD_DONE_LIMIT = 30;

const boardSelect = {
  id: true,
  type: true,
  status: true,
  note: true,
  tableId: true,
  tableName: true,
  areaName: true,
  branchName: true,
  createdAt: true,
  acknowledgedAt: true,
  completedAt: true,
  cancelledAt: true,
  acknowledgedByUserId: true,
  acknowledgedByName: true,
  relatedOrder: { select: { orderNumber: true } },
} as const;

function boardWhere(scope: TenantScope, f: ServiceBoardFilters): Prisma.TableServiceRequestWhereInput {
  return {
    tenantId: scope.tenantId,
    ...(f.branchId ? { branchId: f.branchId } : {}),
    ...(f.areaId ? { diningAreaId: f.areaId } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.q ? { tableName: { contains: f.q, mode: "insensitive" as const } } : {}),
  };
}

async function timezoneFor(scope: TenantScope, branchId?: string): Promise<string> {
  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId: scope.tenantId }, select: { timezone: true } });
    if (branch?.timezone) return branch.timezone;
  }
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: scope.tenantId }, select: { timezone: true } });
  return settings?.timezone ?? "Europe/Istanbul";
}

export async function getServiceBoard(scope: TenantScope, filters: ServiceBoardFilters, now = new Date()) {
  const timezone = await timezoneFor(scope, filters.branchId);
  const today = zonedDayBounds(timezone, now);
  const base = boardWhere(scope, filters);
  const mine = filters.mineUserId ? { acknowledgedByUserId: filters.mineUserId } : {};
  const [open, acknowledged, done] = await Promise.all([
    filters.mineUserId ? Promise.resolve([]) : prisma.tableServiceRequest.findMany({ where: { ...base, status: "OPEN" }, orderBy: { createdAt: "asc" }, take: SERVICE_BOARD_ACTIVE_LIMIT, select: boardSelect }),
    prisma.tableServiceRequest.findMany({ where: { ...base, ...mine, status: "ACKNOWLEDGED" }, orderBy: { createdAt: "asc" }, take: SERVICE_BOARD_ACTIVE_LIMIT, select: boardSelect }),
    prisma.tableServiceRequest.findMany({
      where: { ...base, ...(filters.mineUserId ? { completedByUserId: filters.mineUserId } : {}), status: "COMPLETED", completedAt: { gte: today.start, lt: today.end } },
      orderBy: { completedAt: "desc" },
      take: SERVICE_BOARD_DONE_LIMIT,
      select: boardSelect,
    }),
  ]);
  return { open, acknowledged, done, timezone };
}
export type ServiceBoardRecord = Awaited<ReturnType<typeof getServiceBoard>>["open"][number];

/**
 * Hafif canlı metrikler (tek sorgu; kısmi sayımlar + ortalama yanıt süresi). Uydurma değer yok: veri yoksa null.
 * Ortalama yanıt = bugün üstlenilen taleplerde (üstlenme − oluşturma).
 */
export async function getServiceMetrics(scope: TenantScope, filters: Pick<ServiceBoardFilters, "branchId">, now = new Date()) {
  const timezone = await timezoneFor(scope, filters.branchId);
  const { start, end } = zonedDayBounds(timezone, now);
  const branch = filters.branchId ? Prisma.sql`AND branch_id = ${filters.branchId}` : Prisma.empty;
  const [row] = await prisma.$queryRaw<{ open: bigint; acknowledged: bigint; completed_today: bigint; avg_response_s: number | null; avg_completion_s: number | null }[]>`
    SELECT
      count(*) FILTER (WHERE status = 'OPEN') AS open,
      count(*) FILTER (WHERE status = 'ACKNOWLEDGED') AS acknowledged,
      count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at >= ${start} AND completed_at < ${end}) AS completed_today,
      avg(EXTRACT(EPOCH FROM (acknowledged_at - created_at))) FILTER (WHERE acknowledged_at >= ${start} AND acknowledged_at < ${end}) AS avg_response_s,
      avg(EXTRACT(EPOCH FROM (completed_at - created_at))) FILTER (WHERE completed_at >= ${start} AND completed_at < ${end}) AS avg_completion_s
    FROM table_service_requests
    WHERE tenant_id = ${scope.tenantId} ${branch}
      AND (active_slot IS NOT NULL OR completed_at >= ${start} OR acknowledged_at >= ${start})`;
  const ms = (s: number | null | undefined) => (s === null || s === undefined ? null : Math.round(Number(s) * 1000));
  return {
    open: Number(row?.open ?? 0),
    acknowledged: Number(row?.acknowledged ?? 0),
    completedToday: Number(row?.completed_today ?? 0),
    avgResponseMs: ms(row?.avg_response_s),
    avgCompletionMs: ms(row?.avg_completion_s),
    timezone,
  };
}
export type ServiceMetrics = Awaited<ReturnType<typeof getServiceMetrics>>;

export type ServiceHistoryFilters = ServiceBoardFilters & { status?: Extract<ServiceRequestStatus, "COMPLETED" | "CANCELLED">; from?: Date; to?: Date };

/** Kapanmış talepler geçmişi (sunucu sayfalaması). */
export async function listServiceHistory(scope: TenantScope, filters: ServiceHistoryFilters & { page: number; pageSize: number }) {
  const where: Prisma.TableServiceRequestWhereInput = {
    ...boardWhere(scope, filters),
    status: filters.status ?? { in: ["COMPLETED", "CANCELLED"] },
    ...(filters.mineUserId ? { acknowledgedByUserId: filters.mineUserId } : {}),
    ...(filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.tableServiceRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize, select: boardSelect }),
    prisma.tableServiceRequest.count({ where }),
  ]);
  return { items, total };
}

/** Masa detayı: açık talepler, son talepler, son 30 günün ortalama yanıt süresi (hafif). */
export async function getTableServiceSummary(scope: TenantScope, tableId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const [active, recent, avg] = await Promise.all([
    prisma.tableServiceRequest.findMany({ where: { tenantId: scope.tenantId, tableId, activeSlot: ACTIVE_SLOT }, orderBy: { createdAt: "asc" }, take: 10, select: boardSelect }),
    prisma.tableServiceRequest.findMany({ where: { tenantId: scope.tenantId, tableId, activeSlot: null }, orderBy: { createdAt: "desc" }, take: 5, select: boardSelect }),
    prisma.$queryRaw<{ avg_response_s: number | null; n: bigint }[]>`
      SELECT avg(EXTRACT(EPOCH FROM (acknowledged_at - created_at))) AS avg_response_s, count(acknowledged_at) AS n
      FROM table_service_requests
      WHERE tenant_id = ${scope.tenantId} AND table_id = ${tableId} AND created_at >= ${since}`,
  ]);
  const s = avg[0]?.avg_response_s;
  return { active, recent, avgResponseMs: s === null || s === undefined ? null : Math.round(Number(s) * 1000), samples: Number(avg[0]?.n ?? 0) };
}

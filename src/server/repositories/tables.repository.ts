import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { PlatformScope, TenantScope } from "@/lib/tenant/scope";

/**
 * Masa / bölge okuma sorguları — her biri TenantScope ile kapsamlı. Liste sorguları QR görseli üretmez;
 * yalnızca etkin token'ın özet bilgisi (okutma sayısı, tarih) okunur. Görsel, istenince ayrı uçtan üretilir.
 */

export function listTableBranches(scope: TenantScope) {
  return prisma.branch.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, active: true },
  });
}

const activeQrSelect = {
  where: { active: true },
  orderBy: { createdAt: "desc" },
  take: 1,
  select: { id: true, createdAt: true, scanCount: true, lastUsedAt: true },
} satisfies Prisma.DiningTable$qrTokensArgs;

const tableRowSelect = {
  id: true,
  name: true,
  number: true,
  code: true,
  capacity: true,
  active: true,
  diningAreaId: true,
  qrTokens: activeQrSelect,
} satisfies Prisma.DiningTableSelect;

export type TableRow = Prisma.DiningTableGetPayload<{ select: typeof tableRowSelect }>;

/** Büyük mekânlar için üst sınır: filtre/arama yoksa ilk N masa gösterilir (sayfa uyarı verir). */
export const TABLE_LIST_LIMIT = 500;

export type TablesOverviewQuery = { areaId?: string | null; q?: string; status?: "active" | "inactive" | "no_qr" };

export async function getTablesOverview(scope: TenantScope, branchId: string, query: TablesOverviewQuery = {}) {
  const where: Prisma.DiningTableWhereInput = {
    tenantId: scope.tenantId,
    branchId,
    ...(query.areaId === "none" ? { diningAreaId: null } : query.areaId ? { diningAreaId: query.areaId } : {}),
    ...(query.q
      ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { code: { contains: query.q, mode: "insensitive" } }, ...(/^\d{1,4}$/.test(query.q) ? [{ number: Number(query.q) }] : [])] }
      : {}),
    ...(query.status === "active" ? { active: true } : query.status === "inactive" ? { active: false } : query.status === "no_qr" ? { qrTokens: { none: { active: true } } } : {}),
  };
  const [areas, tables, total, totals] = await Promise.all([
    prisma.diningArea.findMany({
      where: { tenantId: scope.tenantId, branchId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, slug: true, description: true, active: true, _count: { select: { tables: true } } },
    }),
    prisma.diningTable.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }, { name: "asc" }],
      take: TABLE_LIST_LIMIT,
      select: tableRowSelect,
    }),
    prisma.diningTable.count({ where }),
    prisma.diningTable.aggregate({ where: { tenantId: scope.tenantId, branchId }, _count: { _all: true }, _max: { number: true } }),
  ]);
  const withQr = await prisma.diningTable.count({ where: { tenantId: scope.tenantId, branchId, qrTokens: { some: { active: true } } } });
  return { areas, tables, total, branchTotal: totals._count._all, maxNumber: totals._max.number, withQr };
}

export async function getTableDetail(scope: TenantScope, tableId: string) {
  return prisma.diningTable.findFirst({
    where: { id: tableId, tenantId: scope.tenantId },
    select: {
      id: true,
      name: true,
      number: true,
      code: true,
      capacity: true,
      capacityMin: true,
      reservable: true,
      active: true,
      diningAreaId: true,
      createdAt: true,
      branch: { select: { id: true, name: true, active: true } },
      area: { select: { id: true, name: true, active: true } },
      qrTokens: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, active: true, createdAt: true, revokedAt: true, lastUsedAt: true, scanCount: true },
      },
    },
  });
}

export function listBranchAreas(scope: TenantScope, branchId: string) {
  return prisma.diningArea.findMany({
    where: { tenantId: scope.tenantId, branchId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, active: true },
  });
}

/** Etiket ekranı: şubenin masaları + etkin QR var mı (token değeri değil). */
export function listTablesForLabels(scope: TenantScope, branchId: string) {
  return prisma.diningTable.findMany({
    where: { tenantId: scope.tenantId, branchId },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }, { name: "asc" }],
    take: 1000,
    select: { id: true, name: true, active: true, diningAreaId: true, _count: { select: { qrTokens: { where: { active: true } } } } },
  });
}

/** Super Admin işletme detayı — salt okunur sayılar. */
export async function getTableCountsForTenant(_platform: PlatformScope, scope: TenantScope) {
  const [areas, tables, activeQr, qrTotal] = await Promise.all([
    prisma.diningArea.count({ where: { tenantId: scope.tenantId } }),
    prisma.diningTable.count({ where: { tenantId: scope.tenantId } }),
    prisma.tableQrToken.count({ where: { tenantId: scope.tenantId, active: true } }),
    prisma.tableQrToken.count({ where: { tenantId: scope.tenantId } }),
  ]);
  return { areas, tables, activeQr, qrTotal };
}

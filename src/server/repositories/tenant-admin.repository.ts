import "server-only";
import type { Prisma, TenantPlan, TenantStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { PlatformScope } from "@/lib/tenant/scope";

/**
 * Super Admin (platform geneli) kiracı sorguları. Her fonksiyon PlatformScope ister — yalnızca
 * requireSuperAdmin() sonrası çağrılabilir.
 */

const tenantSummarySelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  plan: true,
  createdAt: true,
} satisfies Prisma.TenantSelect;

export type TenantSummaryRow = Prisma.TenantGetPayload<{ select: typeof tenantSummarySelect }>;

export function findTenantSummaryById(scope: PlatformScope, id: string): Promise<TenantSummaryRow | null> {
  void scope;
  return prisma.tenant.findUnique({ where: { id }, select: tenantSummarySelect });
}

export const TENANT_SORTS = ["created_desc", "created_asc", "name_asc", "name_desc"] as const;
export type TenantSort = (typeof TENANT_SORTS)[number];

const ORDER_BY: Record<TenantSort, Prisma.TenantOrderByWithRelationInput> = {
  created_desc: { createdAt: "desc" },
  created_asc: { createdAt: "asc" },
  name_asc: { name: "asc" },
  name_desc: { name: "desc" },
};

export type TenantListQuery = {
  q?: string;
  status?: TenantStatus;
  plan?: TenantPlan;
  sort: TenantSort;
  page: number;
  pageSize: number;
};

/**
 * Sunucu tarafı arama: işletme adı, kısa ad, alan adı ve işletme sahibi e-postası.
 * Tek sorgu + tek sayım; şube sayısı _count ile, birincil alan adı ilişki seçimiyle gelir (N+1 yok).
 */
export async function listTenants(scope: PlatformScope, query: TenantListQuery) {
  void scope;
  const q = query.q?.trim();
  const where: Prisma.TenantWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.plan ? { plan: query.plan } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q.toLowerCase() } },
            { domains: { some: { hostname: { contains: q.toLowerCase() } } } },
            { users: { some: { role: "TENANT_OWNER", email: { contains: q.toLowerCase() } } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: [ORDER_BY[query.sort], { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        ...tenantSummarySelect,
        _count: { select: { branches: true } },
        domains: { where: { isPrimary: true }, select: { hostname: true }, take: 1 },
      },
    }),
    prisma.tenant.count({ where }),
  ]);
  return { items, total };
}

/** Şube oluşturma gibi akışlarda kiracı seçici (en fazla 10 sonuç). */
export function searchTenantsForPicker(scope: PlatformScope, q: string) {
  void scope;
  const term = q.trim();
  return prisma.tenant.findMany({
    where: term
      ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { slug: { contains: term.toLowerCase() } }] }
      : {},
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, name: true, slug: true, status: true },
  });
}

export function findTenantDetail(scope: PlatformScope, id: string) {
  void scope;
  return prisma.tenant.findUnique({
    where: { id },
    select: {
      ...tenantSummarySelect,
      updatedAt: true,
      settings: true,
      _count: { select: { branches: true, users: true, domains: true } },
      domains: { where: { isPrimary: true }, select: { hostname: true }, take: 1 },
    },
  });
}

export async function isTenantSlugTaken(slug: string, excludeTenantId?: string): Promise<boolean> {
  const found = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return !!found && found.id !== excludeTenantId;
}

// ─── Gösterge paneli ────────────────────────────────────────────────────────

export type DashboardStats = {
  tenantsTotal: number;
  byStatus: Record<TenantStatus, number>;
  branchesTotal: number;
  tenantUsersTotal: number;
  newTenantsThisMonth: number;
  monthStart: Date;
};

/** Ayın başlangıcı, platformun iş saat diliminde (Europe/Istanbul) hesaplanır. */
function startOfMonthIstanbul(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  // İstanbul UTC+3 (yaz saati yok): ayın ilk günü 00:00 İstanbul = önceki gün 21:00 UTC.
  return new Date(Date.UTC(year, month - 1, 1, -3, 0, 0));
}

export async function getDashboardStats(scope: PlatformScope): Promise<DashboardStats> {
  void scope;
  const monthStart = startOfMonthIstanbul();
  const [grouped, branchesTotal, tenantUsersTotal, newTenantsThisMonth] = await Promise.all([
    prisma.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.branch.count(),
    prisma.user.count({ where: { tenantId: { not: null } } }),
    prisma.tenant.count({ where: { createdAt: { gte: monthStart } } }),
  ]);
  const byStatus: Record<TenantStatus, number> = { TRIAL: 0, ACTIVE: 0, SUSPENDED: 0, CANCELLED: 0 };
  for (const row of grouped) byStatus[row.status] = row._count._all;
  const tenantsTotal = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  return { tenantsTotal, byStatus, branchesTotal, tenantUsersTotal, newTenantsThisMonth, monthStart };
}

export function listRecentTenants(scope: PlatformScope, take = 6) {
  void scope;
  return prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: { ...tenantSummarySelect, _count: { select: { branches: true } } },
  });
}

/** Tüm şubeler (Super Admin › Şubeler). */
export async function listAllBranches(scope: PlatformScope, query: { q?: string; page: number; pageSize: number }) {
  void scope;
  const q = query.q?.trim();
  const where: Prisma.BranchWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
          { tenant: { name: { contains: q, mode: "insensitive" } } },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    prisma.branch.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        district: true,
        active: true,
        createdAt: true,
        tenant: { select: { id: true, name: true, status: true } },
      },
    }),
    prisma.branch.count({ where }),
  ]);
  return { items, total };
}

export async function findTenantIdBySlug(scope: PlatformScope, slug: string): Promise<string | null> {
  void scope;
  return (await prisma.tenant.findUnique({ where: { slug }, select: { id: true } }))?.id ?? null;
}

/** Listelerde kiracı adları için toplu eşleme (tek sorgu). */
export async function mapTenantNames(scope: PlatformScope, ids: string[]): Promise<Map<string, string>> {
  void scope;
  if (ids.length === 0) return new Map();
  const rows = await prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

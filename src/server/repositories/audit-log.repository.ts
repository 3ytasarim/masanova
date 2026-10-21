import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { PlatformScope, TenantScope } from "@/lib/tenant/scope";

export type AuditLogInsert = Prisma.AuditLogCreateManyInput;

export function insertAuditLog(data: AuditLogInsert) {
  return prisma.auditLog.create({ data, select: { id: true } });
}

const auditListSelect = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  userId: true,
  tenantId: true,
  ipAddress: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

export type AuditListItem = Prisma.AuditLogGetPayload<{ select: typeof auditListSelect }>;

/** Bir kiracının kendi denetim kayıtları (panel özeti). */
export function listTenantAuditLogs(scope: TenantScope, take = 20) {
  return prisma.auditLog.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: { createdAt: "desc" },
    take,
    select: auditListSelect,
  });
}

export type AuditQuery = {
  tenantId?: string;
  userId?: string;
  action?: string;
  entity?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
};

function auditWhere(query: Omit<AuditQuery, "page" | "pageSize">): Prisma.AuditLogWhereInput {
  return {
    ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
  };
}

/** Platform genelinde filtreli + sayfalı denetim sorgusu (Super Admin). */
export async function queryAuditLogs(scope: PlatformScope, query: AuditQuery) {
  void scope;
  const where = auditWhere(query);
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: auditListSelect,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total };
}

/** Kiracı kapsamlı sayfalı denetim (Super Admin › İşletme › Audit). */
export async function queryTenantAuditLogs(scope: TenantScope, query: { page: number; pageSize: number }) {
  const where = { tenantId: scope.tenantId };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: auditListSelect,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total };
}

export function listRecentAuditLogs(scope: PlatformScope, take = 8) {
  void scope;
  return prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take, select: auditListSelect });
}

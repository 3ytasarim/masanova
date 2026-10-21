import "server-only";
import type { DomainType, DomainVerificationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { PlatformScope, TenantScope } from "@/lib/tenant/scope";

/** Doğrulama token'ı bu katmanda bile yalnızca gerektiği yerde seçilir (talimat ekranı + kontrol). */
const domainListSelect = {
  id: true,
  hostname: true,
  type: true,
  verified: true,
  isPrimary: true,
  createdAt: true,
  verification: { select: { status: true, lastCheckedAt: true, verifiedAt: true, failureReason: true, attempts: true } },
} satisfies Prisma.TenantDomainSelect;

export type DomainListItem = Prisma.TenantDomainGetPayload<{ select: typeof domainListSelect }>;

export function listTenantDomains(scope: TenantScope): Promise<DomainListItem[]> {
  return prisma.tenantDomain.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: [{ isPrimary: "desc" }, { type: "asc" }, { createdAt: "asc" }],
    select: domainListSelect,
  });
}

/** Kiracı kapsamlı tekil alan adı (doğrulama token'ı dahil — DNS talimatı ve kontrol için). */
export function findTenantDomain(scope: TenantScope, domainId: string) {
  return prisma.tenantDomain.findFirst({
    where: { id: domainId, tenantId: scope.tenantId },
    select: { ...domainListSelect, tenantId: true, verification: { select: { id: true, token: true, status: true, attempts: true } } },
  });
}

export async function isHostnameTaken(hostname: string): Promise<boolean> {
  return !!(await prisma.tenantDomain.findUnique({ where: { hostname }, select: { id: true } }));
}

export type DomainVerificationFilter = DomainVerificationStatus | "NONE";

/** Super Admin › Domainler: tüm kiracıların alan adları, sunucu tarafı filtre + sayfalama. */
export async function listAllDomains(
  scope: PlatformScope,
  query: { q?: string; type?: DomainType; verification?: DomainVerificationFilter; page: number; pageSize: number },
) {
  void scope;
  const q = query.q?.trim().toLowerCase();
  const where: Prisma.TenantDomainWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.verification === "NONE"
      ? { verification: { is: null } }
      : query.verification
        ? { verification: { is: { status: query.verification } } }
        : {}),
    ...(q ? { OR: [{ hostname: { contains: q } }, { tenant: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.tenantDomain.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { ...domainListSelect, tenant: { select: { id: true, name: true, status: true } } },
    }),
    prisma.tenantDomain.count({ where }),
  ]);
  return { items, total };
}

/**
 * Doğrulanmamış özel alan adlarının challenge token'ları — yalnızca DNS talimatını göstermek için
 * (token DNS'te zaten herkese açık yayınlanacak bir değerdir; loglanmaz).
 */
export async function mapPendingChallenges(scope: TenantScope): Promise<Map<string, string>> {
  const rows = await prisma.domainVerification.findMany({
    where: { domain: { tenantId: scope.tenantId, verified: false, type: "CUSTOM_DOMAIN" } },
    select: { domainId: true, token: true },
  });
  return new Map(rows.map((r) => [r.domainId, r.token]));
}

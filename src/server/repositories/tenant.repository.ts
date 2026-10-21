import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { TenantScope } from "@/lib/tenant/scope";

/** Kiracının kendi profil + ayar bilgisi (panel başlığı, tema). */
export function getTenantProfile(scope: TenantScope) {
  return prisma.tenant.findUnique({
    where: { id: scope.tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      plan: true,
      settings: { select: { logoUrl: true, logoAssetId: true, primaryColor: true, defaultLocale: true, defaultCurrency: true, timezone: true } },
      domains: { where: { isPrimary: true }, select: { hostname: true, type: true }, take: 1 },
    },
  });
}

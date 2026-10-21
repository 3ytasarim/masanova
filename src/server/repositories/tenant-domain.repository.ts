import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { TenantDomainLookup } from "@/lib/tenant/resolve-tenant";

/**
 * Host çözümlemesi için tek global (kapsamsız) sorgu. Kiracı henüz bilinmediğinden kapsamsız olmak
 * ZORUNDA; yalnızca resolve-tenant.ts tarafından kullanılır ve sadece public kiracı özetini döner.
 */
export const tenantDomainLookup: TenantDomainLookup = {
  findByHostname(hostname) {
    return prisma.tenantDomain.findUnique({
      where: { hostname },
      select: {
        hostname: true,
        type: true,
        verified: true,
        isPrimary: true,
        tenant: { select: { id: true, name: true, slug: true, status: true, plan: true } },
      },
    });
  },
};

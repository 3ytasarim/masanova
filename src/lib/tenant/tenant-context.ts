import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { ROOT_HOSTNAME } from "@/lib/domain/root-domain";
import { PLATFORM_HOST_ALIASES } from "@/lib/domain/platform-aliases";
import { resolveTenantByHost, type ResolvedTenant, type TenantResolution } from "@/lib/tenant/resolve-tenant";
import { createTenantScope, type TenantScope } from "@/lib/tenant/scope";
import { TenantNotFoundError, TenantUnavailableError } from "@/lib/tenant/tenant-errors";
import { tenantDomainLookup } from "@/server/repositories/tenant-domain.repository";

/**
 * İsteğin kiracı bağlamı — sunucu tarafında, yalnızca güvenilir kaynaktan (Host başlığı → TenantDomain).
 *
 * Host başlığı neden güvenilir? Kiracıyı istemci "seçemez": yalnızca DNS'i bize yönlendirilmiş ve
 * TenantDomain tablosunda kayıtlı (özel alan adları için doğrulanmış) host'lar bir kiracıya çözümlenir.
 * Sahte bir Host başlığı en fazla o host'un PUBLIC sayfasını gösterir; panel verisine erişim ayrıca
 * oturum ister (bkz. auth/guards.ts → requireTenantUser).
 */
export const getRequestHost = cache(async (): Promise<string | null> => {
  return (await headers()).get("host");
});

/** İstek başına bir kez çözümlenir (React cache). */
export const getTenantContext = cache(async (): Promise<TenantResolution> => {
  return resolveTenantByHost(await getRequestHost(), { lookup: tenantDomainLookup, rootHostname: ROOT_HOSTNAME, platformAliases: PLATFORM_HOST_ALIASES });
});

export type TenantContext = { tenant: ResolvedTenant; scope: TenantScope };

/**
 * Kiracı alan adından gelen istekler için (public kiracı sitesi, kiracı API'leri).
 * Platform host'u, bilinmeyen host → TenantNotFoundError (404); askıda / iptal → TenantUnavailableError (403).
 */
export async function requireTenant(): Promise<TenantContext> {
  const resolution = await getTenantContext();
  switch (resolution.kind) {
    case "tenant":
      return { tenant: resolution.tenant, scope: createTenantScope(resolution.tenant.id) };
    case "unavailable":
      throw new TenantUnavailableError();
    default:
      throw new TenantNotFoundError();
  }
}

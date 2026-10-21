import type { DomainType, TenantPlan, TenantStatus } from "@prisma/client";
import { classifyHost } from "@/lib/tenant/host";

/**
 * Host → kiracı çözümlemesinin TEK doğruluk kaynağı.
 *
 * Saf ve bağımlılığı enjekte edilebilir: veritabanı erişimi `TenantDomainLookup` arayüzü üzerinden gelir,
 * böylece aynı kural seti hem üretimde (Prisma) hem testlerde (bellek içi) birebir çalışır ve ileride
 * önbellek (LRU / Redis) katmanı lookup'ı sarmalayarak eklenebilir.
 */

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: TenantPlan;
};

export type TenantDomainRecord = {
  hostname: string;
  type: DomainType;
  verified: boolean;
  isPrimary: boolean;
  tenant: TenantSummary;
};

export interface TenantDomainLookup {
  findByHostname(hostname: string): Promise<TenantDomainRecord | null>;
}

export type ResolvedTenant = TenantSummary & {
  domain: { hostname: string; type: DomainType; isPrimary: boolean };
};

export type TenantNotFoundReason =
  | "malformed_host"
  | "reserved_host"
  | "nested_subdomain"
  | "unknown_host"
  | "unverified_domain"
  | "domain_type_mismatch";

export type TenantResolution =
  | { kind: "platform"; hostname: string }
  | { kind: "tenant"; tenant: ResolvedTenant }
  | { kind: "not_found"; hostname: string | null; reason: TenantNotFoundReason }
  | { kind: "unavailable"; tenant: TenantSummary };

/** Normal (public site + panel) erişime izin verilen durumlar. */
export const ACCESSIBLE_TENANT_STATUSES: ReadonlySet<TenantStatus> = new Set<TenantStatus>(["TRIAL", "ACTIVE"]);

export function isTenantAccessible(status: TenantStatus): boolean {
  return ACCESSIBLE_TENANT_STATUSES.has(status);
}

export async function resolveTenantByHost(
  rawHost: string | null | undefined,
  deps: { lookup: TenantDomainLookup; rootHostname: string; platformAliases?: ReadonlySet<string> },
): Promise<TenantResolution> {
  const host = classifyHost(rawHost, deps.rootHostname, deps.platformAliases);

  switch (host.kind) {
    case "platform":
      return { kind: "platform", hostname: host.hostname };
    case "invalid": {
      const reason: TenantNotFoundReason =
        host.reason === "malformed" ? "malformed_host" : host.reason === "reserved" ? "reserved_host" : "nested_subdomain";
      return { kind: "not_found", hostname: host.hostname, reason };
    }
  }

  const record = await deps.lookup.findByHostname(host.hostname);
  if (!record) return { kind: "not_found", hostname: host.hostname, reason: "unknown_host" };

  // Kayıt tipi, host'un gerçekte nasıl geldiğiyle eşleşmeli: kök alan altındaki bir host'u
  // CUSTOM_DOMAIN olarak kaydettirip doğrulamayı atlamak (ya da tersi) mümkün olmasın.
  const expectedType: DomainType = host.kind === "subdomain" ? "SUBDOMAIN" : "CUSTOM_DOMAIN";
  if (record.type !== expectedType) {
    return { kind: "not_found", hostname: host.hostname, reason: "domain_type_mismatch" };
  }
  if (record.type === "CUSTOM_DOMAIN" && !record.verified) {
    return { kind: "not_found", hostname: host.hostname, reason: "unverified_domain" };
  }

  if (!isTenantAccessible(record.tenant.status)) {
    return { kind: "unavailable", tenant: record.tenant };
  }

  return {
    kind: "tenant",
    tenant: {
      ...record.tenant,
      domain: { hostname: record.hostname, type: record.type, isPrimary: record.isPrimary },
    },
  };
}

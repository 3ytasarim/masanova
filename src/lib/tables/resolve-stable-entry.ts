import { hashQrToken, isWellFormedQrToken, qrTokenPath } from "@/lib/tables/qr-token";
import { isTenantAccessible } from "@/lib/tenant/resolve-tenant";
import type { DomainType, TenantStatus } from "@prisma/client";

/**
 * Kararlı QR girişi (/q/<token>) çözümleyicisi — DAR kapsamlı ve kiracı host'una bağlı DEĞİL.
 *
 * Tek işi: token'ı doğrulamak ve sahibinin o anki birincil alan adındaki /t/<token> adresini bulmak. Masa / menü
 * bağlamı DÖNMEZ; o bağlam yalnızca yönlendirilen kiracı host'unda, host'a bağlı resolveTableQrToken ile kurulur
 * (orada tüm kontroller yeniden yapılır). Böylece giriş adresi hiçbir kiracı verisini sızdırmaz.
 *
 * Kiracı sayımı (enumeration) önlemi: her başarısızlık dışarıya aynı nötr sonuçla döner (`reason` yalnızca testler ve
 * iç teşhis içindir, kullanıcıya gösterilmez); 128 bit token tahmin edilemez; giriş ucu ayrıca hız sınırlıdır.
 */

export type StableEntryRecord = {
  active: boolean;
  revokedAt: Date | null;
  expiresAt: Date | null;
  table: {
    active: boolean;
    branch: { active: boolean };
    area: { active: boolean } | null;
    tenant: {
      status: TenantStatus;
      domains: { hostname: string; type: DomainType; verified: boolean; isPrimary: boolean }[];
    };
  };
};

export interface StableEntryLookup {
  findByTokenHash(tokenHash: string): Promise<StableEntryRecord | null>;
}

export type StableEntryFailure = "malformed" | "unknown" | "revoked" | "expired" | "inactive" | "tenant_unavailable" | "no_domain";

export type StableEntryResult = { ok: true; hostname: string; path: string } | { ok: false; reason: StableEntryFailure };

/**
 * Kiracının o anki yayın alan adı: birincil kayıt (alt alan ya da DOĞRULANMIŞ özel alan), yoksa ilk alt alan adı.
 * Doğrulanmamış özel alan adına asla yönlendirilmez (orada çözümlenmez).
 */
export function currentTenantHostname(domains: StableEntryRecord["table"]["tenant"]["domains"]): string | null {
  const servable = domains.filter((d) => d.type === "SUBDOMAIN" || d.verified);
  return (servable.find((d) => d.isPrimary) ?? servable.find((d) => d.type === "SUBDOMAIN") ?? servable[0])?.hostname ?? null;
}

export async function resolveStableQrEntry(input: { token: string | null | undefined; now?: Date }, deps: { lookup: StableEntryLookup }): Promise<StableEntryResult> {
  if (!isWellFormedQrToken(input.token)) return { ok: false, reason: "malformed" };
  const record = await deps.lookup.findByTokenHash(hashQrToken(input.token));
  if (!record) return { ok: false, reason: "unknown" };
  if (!record.active || record.revokedAt) return { ok: false, reason: "revoked" };
  if (record.expiresAt && record.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) return { ok: false, reason: "expired" };
  const { table } = record;
  if (!isTenantAccessible(table.tenant.status)) return { ok: false, reason: "tenant_unavailable" };
  if (!table.active || !table.branch.active || (table.area && !table.area.active)) return { ok: false, reason: "inactive" };
  const hostname = currentTenantHostname(table.tenant.domains);
  if (!hostname) return { ok: false, reason: "no_domain" };
  return { ok: true, hostname, path: qrTokenPath(input.token) };
}

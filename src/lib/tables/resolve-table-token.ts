import { hashQrToken, isWellFormedQrToken } from "@/lib/tables/qr-token";
import type { ResolvedTenant, TenantResolution } from "@/lib/tenant/resolve-tenant";

/**
 * QR token → masa bağlamı çözümlemesinin TEK doğruluk kaynağı (gelecekteki public menü ve sipariş akışı da
 * bunu kullanır). Saf ve bağımlılığı enjekte edilebilir: veritabanı erişimi `QrTokenLookup` üzerinden gelir.
 *
 * Kiracı HER ZAMAN istek host'undan gelir (resolveTenantByHost sonucu); token yalnızca o kiracının masalarında
 * geçerlidir. A kiracısının token'ı B'nin alan adında "bilinmeyen token" ile aynı şekilde reddedilir.
 */

export type QrTokenRecord = {
  id: string;
  tenantId: string;
  active: boolean;
  revokedAt: Date | null;
  expiresAt: Date | null;
  table: {
    id: string;
    name: string;
    number: number | null;
    active: boolean;
    branch: { id: string; name: string; active: boolean };
    area: { id: string; name: string; active: boolean } | null;
  };
};

export interface QrTokenLookup {
  findByTokenHash(tokenHash: string): Promise<QrTokenRecord | null>;
}

export type TableQrFailureReason =
  | "malformed_token"
  | "host_not_tenant"
  | "tenant_unavailable"
  | "unknown_token"
  | "tenant_mismatch"
  | "revoked"
  | "expired"
  | "branch_inactive"
  | "table_inactive"
  | "area_inactive";

/** Güvenilir masa bağlamı. Kimlikler yalnızca sunucu içi kullanım içindir; public HTML'e yazılmaz. */
export type TableQrContext = {
  tenant: ResolvedTenant;
  branch: { id: string; name: string };
  area: { id: string; name: string } | null;
  table: { id: string; name: string; number: number | null };
  token: { id: string; status: "active" };
};

export type TableQrResolution = { ok: true; context: TableQrContext } | { ok: false; reason: TableQrFailureReason };

export async function resolveTableQrToken(
  input: { host: TenantResolution; token: string | null | undefined; now?: Date },
  deps: { lookup: QrTokenLookup },
): Promise<TableQrResolution> {
  const { host } = input;
  if (host.kind === "unavailable") return { ok: false, reason: "tenant_unavailable" };
  if (host.kind !== "tenant") return { ok: false, reason: "host_not_tenant" };
  // Biçimsiz değerler veritabanına hiç gitmez.
  if (!isWellFormedQrToken(input.token)) return { ok: false, reason: "malformed_token" };

  const record = await deps.lookup.findByTokenHash(hashQrToken(input.token));
  if (!record) return { ok: false, reason: "unknown_token" };
  if (record.tenantId !== host.tenant.id) return { ok: false, reason: "tenant_mismatch" };
  if (!record.active || record.revokedAt) return { ok: false, reason: "revoked" };
  if (record.expiresAt && record.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) return { ok: false, reason: "expired" };

  const { table } = record;
  if (!table.branch.active) return { ok: false, reason: "branch_inactive" };
  if (!table.active) return { ok: false, reason: "table_inactive" };
  if (table.area && !table.area.active) return { ok: false, reason: "area_inactive" };

  return {
    ok: true,
    context: {
      tenant: host.tenant,
      branch: { id: table.branch.id, name: table.branch.name },
      area: table.area ? { id: table.area.id, name: table.area.name } : null,
      table: { id: table.id, name: table.name, number: table.number },
      token: { id: record.id, status: "active" },
    },
  };
}

import "server-only";
import { cache } from "react";
import { resolveTableQrToken, type TableQrContext, type TableQrFailureReason } from "@/lib/tables/resolve-table-token";
import { getTenantContext } from "@/lib/tenant/tenant-context";
import { createTenantScope, type TenantScope } from "@/lib/tenant/scope";
import { qrTokenLookup } from "@/server/repositories/table-qr.repository";

/**
 * Public QR isteğinin güvenilir masa bağlamı: kiracı istek host'undan, masa token'dan. Gelecekteki public menü
 * ve sipariş akışı (Sprint 5+) masa bilgisini YALNIZCA buradan alır; URL'deki masa numarası vb. asla kullanılmaz.
 * İstek başına bir kez çözümlenir (React cache).
 */
export type TrustedTableContext = TableQrContext & { scope: TenantScope };

export const getTableQrContext = cache(
  async (token: string): Promise<{ ok: true; context: TrustedTableContext } | { ok: false; reason: TableQrFailureReason }> => {
    const result = await resolveTableQrToken({ host: await getTenantContext(), token }, { lookup: qrTokenLookup });
    if (!result.ok) return result;
    return { ok: true, context: { ...result.context, scope: createTenantScope(result.context.tenant.id) } };
  },
);

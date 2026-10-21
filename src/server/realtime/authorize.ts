import "server-only";
import { getCurrentSession, SUPPORT_MODE_TTL_MS } from "@/lib/auth/session";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { hasPermission, type Permission } from "@/lib/permissions/roles";
import { isTenantAccessible } from "@/lib/tenant/resolve-tenant";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import { findPublicOrderStreamRef, PUBLIC_ORDER_WINDOW_MS } from "@/server/repositories/orders.repository";

/**
 * Gerçek zamanlı akış yetkilendirmesi. Kanal ve kiracı ASLA istemciden gelmez:
 *  - Panel: oturum (requireTenantUser ile aynı kapı: kiracı erişilebilir, host eşleşmesi, destek modu salt okunur) +
 *    "orders.view" ya da "kds.view". Her heartbeat'te oturum veritabanından yeniden doğrulanır (çıkış, pasif kullanıcı,
 *    rol değişikliği, kiracı askıya alma → akış kapanır).
 *  - Müşteri: QR bağlamı (token + host) + public kimlik + aynı masa + 24 saat; süre dolunca akış kapanır.
 */
const STREAM_PERMISSIONS: Permission[] = ["orders.view", "kds.view"];

export type PanelStreamAuth = { tenantId: string; stillAuthorized: () => Promise<boolean> };

export async function authorizePanelStream(): Promise<PanelStreamAuth | null> {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch {
    // redirect / notFound fırlatır — akış için 401/404 yerine tek tip ret.
    return null;
  }
  const role = ctx.support ? "TENANT_OWNER" : ctx.user.role;
  if (!STREAM_PERMISSIONS.some((p) => hasPermission(role, p))) return null;
  const session = await getCurrentSession();
  if (!session) return null;
  const sessionId = session.id;
  const tenantId = ctx.tenant.id;

  return {
    tenantId,
    stillAuthorized: async () => {
      const row = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { expiresAt: true, supportTenantId: true, supportStartedAt: true, user: { select: { active: true, role: true, tenantId: true, tenant: { select: { status: true } } } } },
      });
      const now = Date.now();
      if (!row || row.expiresAt.getTime() <= now || !row.user.active) return false;
      if (row.user.role === "SUPER_ADMIN") {
        return row.supportTenantId === tenantId && !!row.supportStartedAt && now - row.supportStartedAt.getTime() < SUPPORT_MODE_TTL_MS;
      }
      if (row.user.tenantId !== tenantId || !row.user.tenant || !isTenantAccessible(row.user.tenant.status)) return false;
      return STREAM_PERMISSIONS.some((p) => hasPermission(row.user.role, p));
    },
  };
}

/**
 * Masa akışı (müşteri QR menüsü): yalnızca geçerli QR bağlamı. Kanal sunucuda masa kimliğinden üretilir; istemci
 * masa / kiracı / talep kimliği gönderemez. QR iptal edilir ya da masa pasifleşirse heartbeat'te kapanır.
 */
export type TableStreamAuth = { tableId: string; stillAuthorized: () => Promise<boolean> };

export async function authorizeTableStream(token: string): Promise<TableStreamAuth | null> {
  const result = await getTableQrContext(token);
  if (!result.ok) return null;
  const { tenant, table, token: qrToken } = result.context;
  return {
    tableId: table.id,
    stillAuthorized: async () => {
      const qr = await prisma.tableQrToken.findFirst({ where: { id: qrToken.id, tenantId: tenant.id, tableId: table.id, revokedAt: null, active: true }, select: { table: { select: { active: true } } } });
      return !!qr?.table.active;
    },
  };
}

export type CustomerStreamAuth = { orderId: string; expiresAt: number; stillAuthorized: () => Promise<boolean> };

export async function authorizeCustomerStream(token: string, publicId: string): Promise<CustomerStreamAuth | null> {
  const result = await getTableQrContext(token);
  if (!result.ok) return null;
  const scope = { tenantId: result.context.tenant.id, tableId: result.context.table.id };
  const ref = await findPublicOrderStreamRef(scope, publicId);
  if (!ref) return null;
  const expiresAt = ref.createdAt.getTime() + PUBLIC_ORDER_WINDOW_MS;
  const tokenId = result.context.token.id;
  return {
    orderId: ref.id,
    expiresAt,
    // QR iptal / yenilenirse ya da masa pasifleşirse akış kapanır.
    stillAuthorized: async () => {
      if (Date.now() >= expiresAt) return false;
      const qr = await prisma.tableQrToken.findFirst({ where: { id: tokenId, tenantId: scope.tenantId, tableId: scope.tableId, revokedAt: null, active: true }, select: { table: { select: { active: true } } } });
      return !!qr?.table.active;
    },
  };
}

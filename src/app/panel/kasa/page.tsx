import type { Metadata } from "next";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { loadCashierBoard } from "@/server/services/cashier/cashier.service";
import { CashierBoard, type CashierTableView } from "@/components/cashier/cashier-board";

export const metadata: Metadata = { title: "Kasa" };
export const dynamic = "force-dynamic";

/**
 * Kasa / adisyon ekranı — payments.view (işlem: payments.manage + yazma). Dokunmatik POS için tam ekran kullanılabilir.
 * Canlı akışla güncellenir (yeni sipariş, "Hesap" talebi); her olayda veri sunucudan kiracı kapsamında yeniden çekilir.
 */
export default async function CashierPage() {
  const ctx = await requireTenantUser({ permission: "payments.view" });
  const role = ctx.support ? "TENANT_OWNER" : ctx.user.role;
  const now = new Date();
  const board = await loadCashierBoard(ctx.scope, now);
  const tables: CashierTableView[] = board.tables.map((t) => ({
    id: t.id,
    name: t.name,
    area: t.area,
    branch: t.branch,
    pendingOrders: t.pendingOrders,
    billRequest: t.billRequest ? { at: t.billRequest.at.getTime(), printed: t.billRequest.printed } : null,
    bill: t.bill ? { ...t.bill, openedAt: t.bill.openedAt.getTime() } : null,
  }));
  return <CashierBoard restaurantName={ctx.tenant.name} currency={board.currency} tables={tables} serverNow={now.getTime()} canAct={!ctx.support && hasPermission(role, "payments.manage")} />;
}

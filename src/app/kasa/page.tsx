import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { getCurrentSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/permissions/roles";
import { loadCashierBoard } from "@/server/services/cashier/cashier.service";
import { CashierBoard, type CashierTableView } from "@/components/cashier/cashier-board";

export const dynamic = "force-dynamic";

/**
 * Kasa terminali (/kasa) — kasadaki dokunmatik ekranda açık kalan ayrı adres. Oturum yoksa kasa girişine gider,
 * girişten sonra buraya döner. Yetki: payments.view (işlem payments.manage). Ekran açıkken oturum düzenli uzatılır.
 */
export default async function CashierTerminalPage() {
  if (!(await getCurrentSession())) redirect("/giris?sonra=kasa");
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
  return (
    <CashierBoard
      standalone
      restaurantName={ctx.tenant.name}
      userName={[ctx.user.firstName, ctx.user.lastName].filter(Boolean).join(" ") || ctx.user.email}
      currency={board.currency}
      tables={tables}
      serverNow={now.getTime()}
      canAct={!ctx.support && hasPermission(role, "payments.manage")}
    />
  );
}

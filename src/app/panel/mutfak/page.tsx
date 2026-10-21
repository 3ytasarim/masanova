import type { Metadata } from "next";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { listKdsTickets, listStationsByBranch } from "@/server/repositories/kds.repository";
import { KdsBoard, type KdsTicket } from "@/components/kds/kds-board";

export const metadata: Metadata = { title: "Mutfak Ekranı" };
export const dynamic = "force-dynamic";

/**
 * Mutfak ekranı (KDS) — kds.view. Fiş ilerletme kds.manage + yazma (mutfak / bar / sahip / müdür; destek modunda
 * salt okunur). Ekran canlı akışla güncellenir; her olayda veri sunucudan (kiracı kapsamında) yeniden çekilir.
 * Fiyat gösterilmez; içerik sipariş kopyalarından gelir.
 */
export default async function KitchenPage() {
  const ctx = await requireTenantUser({ permission: "kds.view" });
  const role = ctx.support ? "TENANT_OWNER" : ctx.user.role;
  const now = new Date();
  const [branches, records] = await Promise.all([listStationsByBranch(ctx.scope), listKdsTickets(ctx.scope, now)]);
  const stations = branches.flatMap((b) => b.stations.map((s) => ({ id: s.id, name: s.name, branchName: b.name, active: s.active })));
  const tickets: KdsTicket[] = records.map((t) => ({
    id: t.id,
    stationId: t.stationId,
    stationName: t.stationName,
    status: t.status as KdsTicket["status"],
    createdAt: t.createdAt.getTime(),
    startedAt: t.startedAt?.getTime() ?? null,
    readyAt: t.readyAt?.getTime() ?? null,
    orderNumber: t.order.orderNumber,
    tableName: t.order.tableName,
    areaName: t.order.areaName,
    branchName: t.order.branchName,
    customerNote: t.order.customerNote,
    items: t.items.map(({ orderItem: i }) => ({
      id: i.id,
      quantity: i.quantity,
      name: i.productNameDefault,
      variant: i.variantName,
      note: i.note,
      modifiers: i.modifiers.map((m) => m.modifierName),
    })),
  }));

  return (
    <>
      <header className="pb-5">
        <h1 className="text-title font-semibold text-fg">Mutfak Ekranı</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">Kabul edilen siparişler istasyon fişleri olarak burada belirir. Tüm fişler hazır olunca sipariş “Hazır” olur.</p>
      </header>
      <KdsBoard
        stations={stations}
        tickets={tickets}
        serverNow={now.getTime()}
        canAct={!ctx.support && hasPermission(role, "kds.manage")}
        canManageStations={!ctx.support && hasPermission(role, "stations.manage")}
      />
    </>
  );
}

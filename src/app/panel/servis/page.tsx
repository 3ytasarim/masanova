import type { Metadata } from "next";
import { SERVICE_REQUEST_TYPES, SERVICE_TYPE_LABELS } from "@/lib/service-requests/types";
import { serviceAbilities } from "@/lib/service-requests/status";
import { requireTenantUser } from "@/lib/auth/guards";
import { enumParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { listOrderFilterOptions } from "@/server/repositories/orders.repository";
import { getServiceBoard, getServiceMetrics, type ServiceBoardRecord } from "@/server/repositories/service-requests.repository";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { ServiceBoard, type ServiceCard } from "@/components/service/service-board";

export const metadata: Metadata = { title: "Canlı Pano" };
export const dynamic = "force-dynamic";

/**
 * Ön salon servis panosu — service.view (sahip, müdür, garson, kasiyer; mutfak / bar değil). Üstlenme / tamamlama
 * yetkisi sunucuda (serviceAbilities); destek modu salt okunur. Canlı akışla güncellenir (veri her seferinde sunucudan).
 */
function toCard(r: ServiceBoardRecord, userId: string): ServiceCard {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    note: r.note,
    tableName: r.tableName,
    areaName: r.areaName,
    branchName: r.branchName,
    createdAt: r.createdAt.getTime(),
    acknowledgedAt: r.acknowledgedAt?.getTime() ?? null,
    completedAt: r.completedAt?.getTime() ?? null,
    assigneeName: r.acknowledgedByName,
    isMine: r.acknowledgedByUserId === userId,
    orderNumber: r.relatedOrder?.orderNumber ?? null,
  };
}

export default async function ServiceBoardPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireTenantUser({ permission: "service.view" });
  const role = ctx.support ? "TENANT_OWNER" : ctx.user.role;
  const abilities = serviceAbilities(role, { readOnly: !!ctx.support });
  const params = await searchParams;
  const [branches, areas] = await listOrderFilterOptions(ctx.scope);
  const pick = <T extends { id: string }>(list: T[], key: string) => {
    const v = param(params, key, 40);
    return list.some((x) => x.id === v) ? v : undefined;
  };
  const branchId = pick(branches, "sube");
  const areaId = pick(areas, "bolge");
  const type = enumParam(params, "tip", SERVICE_REQUEST_TYPES);
  const mine = param(params, "benim", 2) === "1" && !ctx.support;
  const q = param(params, "q", 40);
  const filters = { branchId, areaId, type, q, mineUserId: mine ? ctx.user.id : undefined };
  const now = new Date();
  const [board, metrics] = await Promise.all([getServiceBoard(ctx.scope, filters, now), getServiceMetrics(ctx.scope, { branchId }, now)]);
  const hasFilters = !!(branchId || areaId || type || mine || q);

  return (
    <>
      <details open={hasFilters} className="group mb-4 [&>summary::-webkit-details-marker]:hidden" data-testid="service-filters">
        <summary className="mb-3 flex min-h-12 cursor-pointer list-none items-center justify-between rounded-lg border border-border bg-bg px-4 text-sm font-medium shadow-xs">
          <span>Filtreler ve arama{hasFilters ? " · etkin" : ""}</span>
          <span aria-hidden="true" className="text-fg-subtle transition-transform group-open:rotate-180">▾</span>
        </summary>
      <FilterBar action="/panel/servis" query={q} searchPlaceholder="Masa ara (ör. Masa 12)" searchLabel="Masa ara" hasFilters={hasFilters}>
        {branches.length > 1 ? <FilterSelect id="s-sube" name="sube" label="Şube" value={branchId} options={[{ value: "", label: "Tümü" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} /> : null}
        <FilterSelect id="s-bolge" name="bolge" label="Bölge" value={areaId} options={[{ value: "", label: "Tümü" }, ...areas.filter((a) => !branchId || a.branchId === branchId).map((a) => ({ value: a.id, label: a.name }))]} />
        <FilterSelect id="s-tip" name="tip" label="Talep" value={type} options={[{ value: "", label: "Tümü" }, ...SERVICE_REQUEST_TYPES.map((t) => ({ value: t, label: SERVICE_TYPE_LABELS[t] }))]} />
        {!ctx.support ? <FilterSelect id="s-benim" name="benim" label="Gösterim" value={mine ? "1" : ""} options={[{ value: "", label: "Tüm talepler" }, { value: "1", label: "Yalnızca benim" }]} /> : null}
      </FilterBar>
      </details>
      <ServiceBoard
        open={board.open.map((r) => toCard(r, ctx.user.id))}
        acknowledged={board.acknowledged.map((r) => toCard(r, ctx.user.id))}
        done={board.done.map((r) => toCard(r, ctx.user.id))}
        metrics={{ open: metrics.open, acknowledged: metrics.acknowledged, completedToday: metrics.completedToday, avgResponseMs: metrics.avgResponseMs }}
        abilities={abilities}
        serverNow={now.getTime()}
        readOnly={!!ctx.support}
        timezone={board.timezone}
      />
    </>
  );
}

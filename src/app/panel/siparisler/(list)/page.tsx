import type { Metadata } from "next";
import type { OrderStatus } from "@prisma/client";
import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { formatMoney } from "@/lib/menu/money";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, formatOrderNumber } from "@/lib/orders/status";
import { formatDateTime } from "@/lib/utils/format";
import { dateParam, enumParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { listOrderFilterOptions, listOrdersPage } from "@/server/repositories/orders.repository";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { LiveRefresh } from "@/components/realtime/live-refresh";
import { OrderSoundToggle } from "@/components/realtime/new-order-alerts";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Siparişler" };

const PAGE_SIZE = 25;
const STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];
const inputClass =
  "h-11 w-full min-w-0 rounded-md border border-border-strong bg-bg px-3 text-sm focus-visible:border-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10";

/**
 * Sipariş listesi (canlı: olay geldiğinde sunucudan yeniden çekilir). Tüm görünür bilgiler sipariş
 * kopyalarından gelir. Yetki: orders.view (tüm kiracı rolleri). Şube atama modeli olmadığından liste kiracı geneli.
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { scope } = await requireTenantUser({ permission: "orders.view" });
  const params = await searchParams;
  const [branches, areas, tables] = await listOrderFilterOptions(scope);
  const pick = <T extends { id: string }>(list: T[], key: string) => {
    const v = param(params, key, 40);
    return list.some((x) => x.id === v) ? v : undefined;
  };
  const branchId = pick(branches, "sube");
  const areaId = pick(areas, "bolge");
  const tableId = pick(tables, "masa");
  const status = enumParam(params, "durum", STATUSES);
  const qRaw = param(params, "q", 10)?.replace(/^#/, "");
  const orderNumber = qRaw && /^\d{1,7}$/.test(qRaw) ? Number(qRaw) : undefined;
  const from = dateParam(params, "baslangic");
  const to = dateParam(params, "bitis", true);
  const page = pageParam(params);

  const { items, total } = await listOrdersPage(scope, { branchId, status, areaId, tableId, from, to, orderNumber, page, pageSize: PAGE_SIZE });
  const hasFilters = !!(branchId || areaId || tableId || status || qRaw || from || to);

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Siparişler</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[0.9375rem] text-fg-subtle">QR masa siparişleri — yeni siparişler ve durum değişiklikleri canlı güncellenir. <LiveRefresh /> <OrderSoundToggle /></p>
      </header>

      <FilterBar action="/panel/siparisler" query={qRaw} searchPlaceholder="Sipariş no (ör. 1042)" searchLabel="Sipariş numarası ara" hasFilters={hasFilters}>
        {branches.length > 1 ? <FilterSelect id="o-sube" name="sube" label="Şube" value={branchId} options={[{ value: "", label: "Tümü" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} /> : null}
        <FilterSelect id="o-durum" name="durum" label="Durum" value={status} options={[{ value: "", label: "Tümü" }, ...STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))]} />
        <FilterSelect id="o-bolge" name="bolge" label="Bölge" value={areaId} options={[{ value: "", label: "Tümü" }, ...areas.filter((a) => !branchId || a.branchId === branchId).map((a) => ({ value: a.id, label: a.name }))]} />
        <FilterSelect id="o-masa" name="masa" label="Masa" value={tableId} options={[{ value: "", label: "Tümü" }, ...tables.filter((t) => !branchId || t.branchId === branchId).map((t) => ({ value: t.id, label: t.name }))]} />
        <div className="grid min-w-0 gap-1">
          <label htmlFor="o-from" className="text-xs font-medium text-fg-subtle">
            Başlangıç
          </label>
          <input id="o-from" name="baslangic" type="date" defaultValue={param(params, "baslangic", 10)} className={inputClass} />
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor="o-to" className="text-xs font-medium text-fg-subtle">
            Bitiş
          </label>
          <input id="o-to" name="bitis" type="date" defaultValue={param(params, "bitis", 10)} className={inputClass} />
        </div>
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState icon={ShoppingBag} title={hasFilters ? "Sonuç yok" : "Henüz sipariş yok"} description={hasFilters ? "Filtreleri değiştirin." : "Müşteriler masadaki QR kodla sipariş verdiğinde burada görünür."} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Sipariş</TH>
                <TH>Masa</TH>
                <TH>Bölge</TH>
                <TH className="text-right">Ürün</TH>
                <TH className="text-right">Toplam</TH>
                <TH>Durum</TH>
                <TH>Zaman</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((o) => (
                <TR key={o.id} data-order-number={o.orderNumber}>
                  <TD label="Sipariş">
                    <Link href={`/panel/siparisler/${o.id}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                      {formatOrderNumber(o.orderNumber)}
                    </Link>
                    {branches.length > 1 ? <span className="block text-xs text-fg-subtle">{o.branchName}</span> : null}
                  </TD>
                  <TD label="Masa">{o.tableName}</TD>
                  <TD label="Bölge">{o.areaName ?? "—"}</TD>
                  <TD label="Ürün" className="text-right tabular-nums">
                    {o.itemCount}
                  </TD>
                  <TD label="Toplam" className="text-right tabular-nums font-medium text-fg">
                    {formatMoney(o.totalMinor, o.currency)}
                  </TD>
                  <TD label="Durum">
                    <Badge tone={ORDER_STATUS_TONES[o.status]} dot>
                      {ORDER_STATUS_LABELS[o.status]}
                    </Badge>
                  </TD>
                  <TD label="Zaman" className="whitespace-nowrap">
                    {formatDateTime(o.createdAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination
            basePath="/panel/siparisler"
            query={{ sube: branchId, durum: status, bolge: areaId, masa: tableId, q: qRaw, baslangic: param(params, "baslangic", 10), bitis: param(params, "bitis", 10) }}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}

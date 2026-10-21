import type { Metadata } from "next";
import { History } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { completionMs, formatDurationShort, responseMs } from "@/lib/service-requests/timing";
import { SERVICE_REQUEST_TYPES, SERVICE_STATUS_LABELS, SERVICE_STATUS_TONES, SERVICE_TYPE_LABELS } from "@/lib/service-requests/types";
import { formatDateTime } from "@/lib/utils/format";
import { dateParam, enumParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { listOrderFilterOptions } from "@/server/repositories/orders.repository";
import { listServiceHistory } from "@/server/repositories/service-requests.repository";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Geçmiş" };

const PAGE_SIZE = 25;
const CLOSED = ["COMPLETED", "CANCELLED"] as const;
const inputClass =
  "h-11 w-full min-w-0 rounded-md border border-border-strong bg-bg px-3 text-sm focus-visible:border-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10";

/**
 * Kapanmış servis talepleri (tamamlanan / iptal edilen) — sunucu sayfalaması. Masa / bölge / şube adları talep
 * anındaki kopyadır (masa sonradan yeniden adlandırılsa da geçmiş anlamlı kalır). Talepler silinmez.
 */
export default async function ServiceHistoryPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireTenantUser({ permission: "service.view" });
  const params = await searchParams;
  const [branches, areas] = await listOrderFilterOptions(ctx.scope);
  const pick = <T extends { id: string }>(list: T[], key: string) => {
    const v = param(params, key, 40);
    return list.some((x) => x.id === v) ? v : undefined;
  };
  const branchId = pick(branches, "sube");
  const areaId = pick(areas, "bolge");
  const type = enumParam(params, "tip", SERVICE_REQUEST_TYPES);
  const status = enumParam(params, "durum", CLOSED);
  const q = param(params, "q", 40);
  const from = dateParam(params, "baslangic");
  const to = dateParam(params, "bitis", true);
  const page = pageParam(params);
  const { items, total } = await listServiceHistory(ctx.scope, { branchId, areaId, type, status, q, from, to, page, pageSize: PAGE_SIZE });
  const hasFilters = !!(branchId || areaId || type || status || q || from || to);

  return (
    <>
      <FilterBar action="/panel/servis/gecmis" query={q} searchPlaceholder="Masa ara" searchLabel="Masa ara" hasFilters={hasFilters}>
        {branches.length > 1 ? <FilterSelect id="h-sube" name="sube" label="Şube" value={branchId} options={[{ value: "", label: "Tümü" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} /> : null}
        <FilterSelect id="h-bolge" name="bolge" label="Bölge" value={areaId} options={[{ value: "", label: "Tümü" }, ...areas.filter((a) => !branchId || a.branchId === branchId).map((a) => ({ value: a.id, label: a.name }))]} />
        <FilterSelect id="h-tip" name="tip" label="Talep" value={type} options={[{ value: "", label: "Tümü" }, ...SERVICE_REQUEST_TYPES.map((t) => ({ value: t, label: SERVICE_TYPE_LABELS[t] }))]} />
        <FilterSelect id="h-durum" name="durum" label="Durum" value={status} options={[{ value: "", label: "Tümü" }, ...CLOSED.map((s) => ({ value: s, label: SERVICE_STATUS_LABELS[s] }))]} />
        <div className="grid min-w-0 gap-1">
          <label htmlFor="h-bas" className="text-xs font-medium text-fg-subtle">
            Başlangıç
          </label>
          <input id="h-bas" type="date" name="baslangic" defaultValue={param(params, "baslangic", 10)} className={inputClass} />
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor="h-bit" className="text-xs font-medium text-fg-subtle">
            Bitiş
          </label>
          <input id="h-bit" type="date" name="bitis" defaultValue={param(params, "bitis", 10)} className={inputClass} />
        </div>
      </FilterBar>

      {items.length ? (
        <>
          <p className="mb-3 text-sm text-fg-subtle">{total} kayıt</p>
          <Table>
            <THead>
              <TR>
                <TH>Masa</TH>
                <TH>Talep</TH>
                <TH>Oluşturuldu</TH>
                <TH>Üstlenildi</TH>
                <TH>Kapandı</TH>
                <TH className="text-right">Yanıt</TH>
                <TH className="text-right">Tamamlanma</TH>
                <TH>İlgilenen</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((r) => (
                <TR key={r.id} data-testid="service-history-row" data-table={r.tableName} data-type={r.type}>
                  <TD label="Masa" className="font-medium text-fg">
                    {r.tableName}
                    <span className="block text-xs font-normal text-fg-subtle">
                      {r.areaName ?? "Bölgesiz"} · {r.branchName}
                    </span>
                  </TD>
                  <TD label="Talep">
                    {SERVICE_TYPE_LABELS[r.type]}{" "}
                    <Badge tone={SERVICE_STATUS_TONES[r.status]} dot>
                      {SERVICE_STATUS_LABELS[r.status]}
                    </Badge>
                    {r.note ? <span className="mt-0.5 block max-w-xs break-words text-xs text-fg-subtle">“{r.note}”</span> : null}
                  </TD>
                  <TD label="Oluşturuldu" className="tabular-nums">{formatDateTime(r.createdAt)}</TD>
                  <TD label="Üstlenildi" className="tabular-nums">{r.acknowledgedAt ? formatDateTime(r.acknowledgedAt) : "—"}</TD>
                  <TD label="Kapandı" className="tabular-nums">{formatDateTime(r.completedAt ?? r.cancelledAt ?? r.createdAt)}</TD>
                  <TD label="Yanıt" className="text-right tabular-nums" data-testid="service-history-response">
                    {formatDurationShort(responseMs(r))}
                  </TD>
                  <TD label="Tamamlanma" className="text-right tabular-nums">{formatDurationShort(completionMs(r))}</TD>
                  <TD label="İlgilenen">{r.acknowledgedByName ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/panel/servis/gecmis" query={{ sube: branchId, bolge: areaId, tip: type, durum: status, q, baslangic: param(params, "baslangic", 10), bitis: param(params, "bitis", 10) }} />
        </>
      ) : (
        <EmptyState icon={History} title={hasFilters ? "Sonuç yok" : "Henüz kapanmış talep yok"} description={hasFilters ? "Filtreleri değiştirerek tekrar deneyin." : "Tamamlanan ve iptal edilen servis talepleri burada listelenir."} />
      )}
    </>
  );
}

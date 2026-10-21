import type { Metadata } from "next";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { PLANS } from "@/config/plans";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { formatTenantAddress } from "@/lib/domain/get-tenant-url";
import { STATUS_LABELS } from "@/lib/tenant/status";
import { formatDateTime } from "@/lib/utils/format";
import { enumParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { TENANT_SORTS, listTenants, type TenantSort } from "@/server/repositories/tenant-admin.repository";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { TenantStatusActions } from "@/components/dashboard/tenant-status-actions";
import { TenantStatusBadge } from "@/components/dashboard/tenant-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "İşletmeler" };

const PAGE_SIZE = 20;
const SORT_LABELS: Record<TenantSort, string> = {
  created_desc: "En yeni",
  created_asc: "En eski",
  name_asc: "Ad (A→Z)",
  name_desc: "Ad (Z→A)",
};

export default async function TenantsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { platform } = await requireSuperAdmin();
  const params = await searchParams;
  const q = param(params, "q", 120);
  const status = enumParam(params, "durum", ["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"] as const);
  const plan = enumParam(params, "paket", ["STARTER", "VOICE_MENU", "PRO", "AI"] as const);
  const sort = enumParam(params, "sirala", TENANT_SORTS) ?? "created_desc";
  const page = pageParam(params);

  const { items, total } = await listTenants(platform, { q, status, plan, sort, page, pageSize: PAGE_SIZE });
  const hasFilters = !!(q || status || plan || sort !== "created_desc");

  return (
    <>
      <PageHeader
        title="İşletmeler"
        description="Restoran müşterilerinizi arayın, filtreleyin ve yönetin."
        actions={
          <Link href="/admin/isletmeler/yeni" className={buttonVariants({ size: "sm" })}>
            <Plus aria-hidden="true" /> Yeni İşletme
          </Link>
        }
      />

      <FilterBar action="/admin/isletmeler" query={q} searchPlaceholder="Ad, kısa ad, alan adı veya sahip e-postası" searchLabel="İşletme ara" hasFilters={hasFilters}>
        <FilterSelect id="f-durum" name="durum" label="Durum" value={status} options={[{ value: "", label: "Tümü" }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))]} />
        <FilterSelect id="f-paket" name="paket" label="Paket" value={plan} options={[{ value: "", label: "Tümü" }, ...Object.entries(PLANS).map(([value, p]) => ({ value, label: p.label }))]} />
        <FilterSelect id="f-sirala" name="sirala" label="Sıralama" value={sort} options={TENANT_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }))} />
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={hasFilters ? "Eşleşen işletme yok" : "Henüz işletme yok"}
          description={hasFilters ? "Arama ya da filtreleri değiştirin." : "İlk restoran müşterinizi oluşturarak başlayın."}
          action={!hasFilters ? <Link href="/admin/isletmeler/yeni" className={buttonVariants({ size: "sm" })}>Yeni İşletme</Link> : undefined}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>İşletme</TH>
                <TH>Kısa ad</TH>
                <TH>Durum</TH>
                <TH>Paket</TH>
                <TH className="text-right">Şube</TH>
                <TH>Alan adı</TH>
                <TH>Kayıt</TH>
                <TH><span className="sr-only">İşlemler</span></TH>
              </TR>
            </THead>
            <TBody>
              {items.map((t) => (
                <TR key={t.id}>
                  <TD label="İşletme">
                    <Link href={`/admin/isletmeler/${t.id}`} className="font-medium text-fg hover:underline">
                      {t.name}
                    </Link>
                  </TD>
                  <TD label="Kısa ad" className="font-mono text-xs">{t.slug}</TD>
                  <TD label="Durum"><TenantStatusBadge status={t.status} /></TD>
                  <TD label="Paket"><Badge>{PLANS[t.plan].label}</Badge></TD>
                  <TD label="Şube" className="text-right tabular-nums">{t._count.branches}</TD>
                  <TD label="Alan adı" className="max-w-56 truncate font-mono text-xs">{t.domains[0] ? formatTenantAddress(t.domains[0].hostname) : "—"}</TD>
                  <TD label="Kayıt" className="whitespace-nowrap">{formatDateTime(t.createdAt)}</TD>
                  <TD label="İşlemler" className="text-right">
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      <Link href={`/admin/isletmeler/${t.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                        Görüntüle
                      </Link>
                      <Link href={`/admin/isletmeler/${t.id}#genel-duzenle`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                        Düzenle
                      </Link>
                      <TenantStatusActions tenant={t} />
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination basePath="/admin/isletmeler" query={{ q, durum: status, paket: plan, sirala: sort === "created_desc" ? undefined : sort }} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}

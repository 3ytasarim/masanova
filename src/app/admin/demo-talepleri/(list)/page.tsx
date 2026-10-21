import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { enumParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { listDemoRequests } from "@/server/repositories/demo-request.repository";
import { DEMO_STATUS, DemoRequestBadge } from "@/components/dashboard/demo-request-badge";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Demo Talepleri" };

const PAGE_SIZE = 25;

export default async function DemoRequestsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { platform } = await requireSuperAdmin();
  const params = await searchParams;
  const q = param(params, "q", 120);
  const status = enumParam(params, "durum", ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const);
  const page = pageParam(params);
  const { items, total, newCount } = await listDemoRequests(platform, { q, status, page, pageSize: PAGE_SIZE });

  return (
    <>
      <PageHeader
        title="Demo Talepleri"
        description={`Landing sayfasındaki formdan gelen talepler. ${newCount > 0 ? `${formatNumber(newCount)} yeni talep bekliyor.` : "Bekleyen yeni talep yok."}`}
      />
      <FilterBar action="/admin/demo-talepleri" query={q} searchPlaceholder="İşletme, kişi, e-posta veya şehir" searchLabel="Talep ara" hasFilters={!!(q || status)}>
        <FilterSelect id="dr-durum" name="durum" label="Durum" value={status} options={[{ value: "", label: "Tümü" }, ...Object.entries(DEMO_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState icon={Inbox} title={q || status ? "Eşleşen talep yok" : "Henüz demo talebi yok"} description="Talepler landing sayfasındaki “Demo Talep Et” formundan gelir." />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>İşletme</TH>
                <TH>Kişi</TH>
                <TH>İletişim</TH>
                <TH>Şehir</TH>
                <TH className="text-right">Masa</TH>
                <TH>Durum</TH>
                <TH>Tarih</TH>
                <TH><span className="sr-only">İşlemler</span></TH>
              </TR>
            </THead>
            <TBody>
              {items.map((r) => (
                <TR key={r.id}>
                  <TD label="İşletme" className="font-medium text-fg">{r.businessName}</TD>
                  <TD label="Kişi">{r.name}</TD>
                  <TD label="İletişim" className="break-all text-xs">
                    {r.email}
                    <br />
                    {r.phone}
                  </TD>
                  <TD label="Şehir">{r.city ?? "—"}</TD>
                  <TD label="Masa" className="text-right tabular-nums">{r.tableCount ?? "—"}</TD>
                  <TD label="Durum"><DemoRequestBadge status={r.status} /></TD>
                  <TD label="Tarih" className="whitespace-nowrap">{formatDateTime(r.createdAt)}</TD>
                  <TD label="İşlemler" className="text-right">
                    <Link href={`/admin/demo-talepleri/${r.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      Aç<span className="sr-only">: {r.businessName}</span>
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination basePath="/admin/demo-talepleri" query={{ q, durum: status }} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}

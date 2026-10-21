import type { Metadata } from "next";
import { MapPin, Plus } from "lucide-react";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/utils/format";
import { pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { listAllBranches } from "@/server/repositories/tenant-admin.repository";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { TenantStatusBadge } from "@/components/dashboard/tenant-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Şubeler" };

const PAGE_SIZE = 25;

export default async function AllBranchesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { platform } = await requireSuperAdmin();
  const params = await searchParams;
  const q = param(params, "q", 120);
  const page = pageParam(params);
  const { items, total } = await listAllBranches(platform, { q, page, pageSize: PAGE_SIZE });

  return (
    <>
      <PageHeader
        title="Şubeler"
        description="Tüm işletmelerin şubeleri."
        actions={
          <Link href="/admin/subeler/yeni" className={buttonVariants({ size: "sm" })}>
            <Plus aria-hidden="true" /> Yeni Şube
          </Link>
        }
      />
      <FilterBar action="/admin/subeler" query={q} searchPlaceholder="Şube, şehir veya işletme adı" searchLabel="Şube ara" hasFilters={!!q} />
      {items.length === 0 ? (
        <EmptyState icon={MapPin} title={q ? "Eşleşen şube yok" : "Şube yok"} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Şube</TH>
                <TH>İşletme</TH>
                <TH>Konum</TH>
                <TH>Durum</TH>
                <TH>Kayıt</TH>
                <TH><span className="sr-only">İşlemler</span></TH>
              </TR>
            </THead>
            <TBody>
              {items.map((b) => (
                <TR key={b.id}>
                  <TD label="Şube"><span className="font-medium text-fg">{b.name}</span> <span className="font-mono text-xs text-fg-subtle">{b.slug}</span></TD>
                  <TD label="İşletme">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Link href={`/admin/isletmeler/${b.tenant.id}`} className="hover:underline">{b.tenant.name}</Link>
                      <TenantStatusBadge status={b.tenant.status} />
                    </span>
                  </TD>
                  <TD label="Konum">{[b.district, b.city].filter(Boolean).join(", ") || "—"}</TD>
                  <TD label="Durum">{b.active ? <Badge tone="success" dot>Aktif</Badge> : <Badge dot>Pasif</Badge>}</TD>
                  <TD label="Kayıt" className="whitespace-nowrap">{formatDateTime(b.createdAt)}</TD>
                  <TD label="İşlemler" className="text-right">
                    <Link href={`/admin/isletmeler/${b.tenant.id}/subeler/${b.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      Düzenle<span className="sr-only">: {b.name}</span>
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination basePath="/admin/subeler" query={{ q }} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}

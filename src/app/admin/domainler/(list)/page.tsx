import type { Metadata } from "next";
import { Globe } from "lucide-react";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { ROOT_HOSTNAME } from "@/lib/domain/root-domain";
import { formatTenantAddress } from "@/lib/domain/get-tenant-url";
import { formatDateTime } from "@/lib/utils/format";
import { enumParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { listAllDomains } from "@/server/repositories/domain.repository";
import { DomainStateBadge, DomainTypeBadge } from "@/components/dashboard/domains/domain-badges";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { TenantStatusBadge } from "@/components/dashboard/tenant-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Domainler" };

const PAGE_SIZE = 25;

export default async function DomainsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { platform } = await requireSuperAdmin();
  const params = await searchParams;
  const q = param(params, "q", 253);
  const type = enumParam(params, "tur", ["SUBDOMAIN", "CUSTOM_DOMAIN"] as const);
  const verification = enumParam(params, "dogrulama", ["PENDING", "VERIFIED", "FAILED", "NONE"] as const);
  const page = pageParam(params);
  const { items, total } = await listAllDomains(platform, { q, type, verification, page, pageSize: PAGE_SIZE });
  const hasFilters = !!(q || type || verification);

  return (
    <>
      <PageHeader
        title="Domainler"
        description={
          <>
            Tüm işletmelerin alan adları. Platform alt alanları <code className="font-mono">*.{ROOT_HOSTNAME}</code> altında; özel alan adları DNS TXT
            doğrulamasıyla yayına çıkar. İşlemler işletmenin Domainler sekmesinden yapılır.
          </>
        }
      />
      <FilterBar action="/admin/domainler" query={q} searchPlaceholder="Alan adı veya işletme adı" searchLabel="Alan adı ara" hasFilters={hasFilters}>
        <FilterSelect id="d-tur" name="tur" label="Tür" value={type} options={[{ value: "", label: "Tümü" }, { value: "SUBDOMAIN", label: "Alt alan" }, { value: "CUSTOM_DOMAIN", label: "Özel alan" }]} />
        <FilterSelect
          id="d-dogrulama"
          name="dogrulama"
          label="Doğrulama"
          value={verification}
          options={[
            { value: "", label: "Tümü" },
            { value: "PENDING", label: "Bekliyor" },
            { value: "FAILED", label: "Başarısız" },
            { value: "VERIFIED", label: "Doğrulandı" },
            { value: "NONE", label: "Gerekmiyor (alt alan)" },
          ]}
        />
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState icon={Globe} title={hasFilters ? "Eşleşen alan adı yok" : "Alan adı yok"} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Alan adı</TH>
                <TH>Tür</TH>
                <TH>Durum</TH>
                <TH>İşletme</TH>
                <TH>Eklendi</TH>
                <TH><span className="sr-only">İşlemler</span></TH>
              </TR>
            </THead>
            <TBody>
              {items.map((d) => (
                <TR key={d.id}>
                  <TD label="Alan adı" className="break-all">
                    <span className="font-mono text-xs text-fg">{d.type === "SUBDOMAIN" ? formatTenantAddress(d.hostname) : d.hostname}</span>
                    {d.isPrimary ? <Badge tone="accent" className="ml-2">Birincil</Badge> : null}
                  </TD>
                  <TD label="Tür"><DomainTypeBadge type={d.type} /></TD>
                  <TD label="Durum"><DomainStateBadge verified={d.verified} status={d.verification?.status} /></TD>
                  <TD label="İşletme">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Link href={`/admin/isletmeler/${d.tenant.id}`} className="font-medium text-fg hover:underline">{d.tenant.name}</Link>
                      <TenantStatusBadge status={d.tenant.status} />
                    </span>
                  </TD>
                  <TD label="Eklendi" className="whitespace-nowrap">{formatDateTime(d.createdAt)}</TD>
                  <TD label="İşlemler" className="text-right">
                    <Link href={`/admin/isletmeler/${d.tenant.id}/domainler`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      Yönet<span className="sr-only">: {d.hostname}</span>
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination basePath="/admin/domainler" query={{ q, tur: type, dogrulama: verification }} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}

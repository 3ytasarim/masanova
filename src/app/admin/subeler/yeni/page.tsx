import type { Metadata } from "next";
import { Building2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { searchTenantsForPicker } from "@/server/repositories/tenant-admin.repository";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { TenantStatusBadge } from "@/components/dashboard/tenant-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Yeni Şube" };

/** Hızlı eylem "Yeni Şube": önce işletme seçilir (sunucu tarafı arama), sonra işletmenin şube formuna gidilir. */
export default async function PickTenantForBranchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { platform } = await requireSuperAdmin();
  const q = param(await searchParams, "q", 120);
  const tenants = await searchTenantsForPicker(platform, q ?? "");

  return (
    <>
      <PageHeader eyebrow="Şubeler" title="Yeni şube" description="Şubenin ekleneceği işletmeyi seçin." />
      <FilterBar action="/admin/subeler/yeni" query={q} searchPlaceholder="İşletme adı veya kısa ad" searchLabel="İşletme ara" hasFilters={!!q} />
      {tenants.length === 0 ? (
        <EmptyState icon={Building2} title="İşletme bulunamadı" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-bg">
          {tenants.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/isletmeler/${t.id}/subeler/yeni`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{t.name}</span>
                  <span className="block font-mono text-xs text-fg-subtle">{t.slug}</span>
                </span>
                <TenantStatusBadge status={t.status} />
                <ChevronRight aria-hidden="true" className="size-4 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

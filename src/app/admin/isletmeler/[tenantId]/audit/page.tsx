import { ScrollText } from "lucide-react";
import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { pageParam, type RawSearchParams } from "@/lib/utils/search-params";
import { queryTenantAuditLogs } from "@/server/repositories/audit-log.repository";
import { mapUserEmails } from "@/server/repositories/user.repository";
import { AuditTable } from "@/components/dashboard/audit-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

export const metadata = { title: "Audit" };

const PAGE_SIZE = 25;

export default async function TenantAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { tenant, scope } = await requireSuperAdminTenant((await params).tenantId);
  const page = pageParam(await searchParams);
  const { items, total } = await queryTenantAuditLogs(scope, { page, pageSize: PAGE_SIZE });
  const actors = await mapUserEmails([...new Set(items.map((l) => l.userId).filter((id): id is string => !!id))]);

  return (
    <section aria-labelledby="audit-title">
      <h2 id="audit-title" className="mb-4 text-lg font-semibold tracking-tight">
        Denetim kayıtları
      </h2>
      {items.length === 0 ? (
        <EmptyState icon={ScrollText} title="Kayıt yok" />
      ) : (
        <>
          <AuditTable logs={items} actors={actors} />
          <Pagination basePath={`/admin/isletmeler/${tenant.id}/audit`} query={{}} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </section>
  );
}

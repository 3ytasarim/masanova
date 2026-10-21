import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, AUDIT_ENTITIES } from "@/lib/audit/actions";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { dateParam, enumParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { queryAuditLogs } from "@/server/repositories/audit-log.repository";
import { findTenantIdBySlug, mapTenantNames } from "@/server/repositories/tenant-admin.repository";
import { findUserIdByEmail, mapUserEmails } from "@/server/repositories/user.repository";
import { AuditTable } from "@/components/dashboard/audit-table";
import { FilterSelect } from "@/components/dashboard/filter-bar";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import Link from "next/link";

export const metadata: Metadata = { title: "Audit Logs" };

const PAGE_SIZE = 50;
const inputClass =
  "h-11 w-full rounded-md border border-border-strong bg-bg px-3 text-sm focus-visible:border-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10";

export default async function AdminAuditLogsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { platform } = await requireSuperAdmin();
  const params = await searchParams;
  const tenantSlug = param(params, "isletme", 63)?.toLowerCase();
  const actorEmail = param(params, "aktor", 254)?.toLowerCase();
  const action = enumParam(params, "eylem", AUDIT_ACTIONS);
  const entity = enumParam(params, "varlik", AUDIT_ENTITIES);
  const fromRaw = param(params, "baslangic", 10);
  const toRaw = param(params, "bitis", 10);
  const from = dateParam(params, "baslangic");
  const to = dateParam(params, "bitis", true);
  const page = pageParam(params);

  // Metin filtreleri kimliğe çevrilir; bulunamazsa sonuç boş olmalı (filtre yok sayılmamalı).
  const [tenantId, userId] = await Promise.all([
    tenantSlug ? findTenantIdBySlug(platform, tenantSlug) : Promise.resolve(undefined),
    actorEmail ? findUserIdByEmail(actorEmail) : Promise.resolve(undefined),
  ]);
  const unmatched = (tenantSlug && !tenantId) || (actorEmail && !userId);

  const { items, total } = unmatched
    ? { items: [], total: 0 }
    : await queryAuditLogs(platform, { tenantId: tenantId ?? undefined, userId: userId ?? undefined, action, entity, from, to, page, pageSize: PAGE_SIZE });

  const [actors, tenants] = await Promise.all([
    mapUserEmails([...new Set(items.map((l) => l.userId).filter((id): id is string => !!id))]),
    mapTenantNames(platform, [...new Set(items.map((l) => l.tenantId).filter((id): id is string => !!id))]),
  ]);
  const hasFilters = !!(tenantSlug || actorEmail || action || entity || fromRaw || toRaw);

  return (
    <>
      <PageHeader title="Audit Logs" description="Platform genelindeki denetim kayıtları. Parola, token ve oturum bilgileri asla kaydedilmez." />

      <form action="/admin/audit-logs" method="get" role="search" aria-label="Denetim kayıtlarını filtrele" className="mb-4 grid gap-3 rounded-lg border border-border bg-bg p-3 shadow-xs sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div className="grid gap-1">
          <label htmlFor="a-tenant" className="text-xs font-medium text-fg-subtle">İşletme (kısa ad)</label>
          <input id="a-tenant" name="isletme" defaultValue={tenantSlug} placeholder="demo-restoran" className={`${inputClass} font-mono`} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="a-actor" className="text-xs font-medium text-fg-subtle">Aktör (e-posta)</label>
          <input id="a-actor" name="aktor" type="email" defaultValue={actorEmail} className={inputClass} />
        </div>
        <FilterSelect id="a-action" name="eylem" label="Eylem" value={action} options={[{ value: "", label: "Tümü" }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] }))]} />
        <FilterSelect id="a-entity" name="varlik" label="Varlık" value={entity} options={[{ value: "", label: "Tümü" }, ...AUDIT_ENTITIES.map((e) => ({ value: e, label: e }))]} />
        <div className="grid gap-1">
          <label htmlFor="a-from" className="text-xs font-medium text-fg-subtle">Başlangıç</label>
          <input id="a-from" name="baslangic" type="date" defaultValue={fromRaw} className={inputClass} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="a-to" className="text-xs font-medium text-fg-subtle">Bitiş</label>
          <input id="a-to" name="bitis" type="date" defaultValue={toRaw} className={inputClass} />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit">Filtrele</Button>
          {hasFilters ? (
            <Link href="/admin/audit-logs" className={buttonVariants({ variant: "ghost" })}>
              Temizle
            </Link>
          ) : null}
        </div>
      </form>

      {items.length === 0 ? (
        <EmptyState icon={ScrollText} title={hasFilters ? "Eşleşen kayıt yok" : "Kayıt yok"} description={unmatched ? "Belirtilen işletme ya da aktör bulunamadı." : undefined} />
      ) : (
        <>
          <AuditTable logs={items} actors={actors} tenants={tenants} />
          <Pagination
            basePath="/admin/audit-logs"
            query={{ isletme: tenantSlug, aktor: actorEmail, eylem: action, varlik: entity, baslangic: fromRaw, bitis: toRaw }}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}

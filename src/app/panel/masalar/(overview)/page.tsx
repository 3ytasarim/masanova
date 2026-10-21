import { MapPin } from "lucide-react";
import { nextTableNumber } from "@/lib/tables/naming";
import { enumParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { TABLE_LIST_LIMIT, getTablesOverview } from "@/server/repositories/tables.repository";
import { getTablesPageContext, pickBranch } from "@/server/tables-page-context";
import { seatedByTable } from "@/server/reservations/queries.service";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { TablesManager } from "@/components/tables/tables-manager";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Masalar" };

const STATUSES = ["active", "inactive", "no_qr"] as const;

export default async function TablesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { scope, canManage, branches } = await getTablesPageContext();
  const params = await searchParams;
  const branch = pickBranch(branches, param(params, "sube", 40));
  if (!branch) {
    return <EmptyState icon={MapPin} title="Henüz şube yok" description="Masalar bir şubeye bağlıdır. Şube eklendiğinde buradan bölge ve masa oluşturabilirsiniz." />;
  }

  const q = param(params, "q", 60);
  const areaParam = param(params, "bolge", 40);
  const status = enumParam(params, "durum", STATUSES);
  const overview = await getTablesOverview(scope, branch.id, { areaId: areaParam, q, status });
  // Rezervasyon bağlamı (yalnız ad + kişi). QR / sipariş bundan bağımsız çalışır.
  const seated = await seatedByTable(scope);
  const areaId = areaParam === "none" || overview.areas.some((a) => a.id === areaParam) ? areaParam : undefined;
  const hasFilters = !!(q || areaId || status);
  const dialog = enumParam(params, "yeni", ["bolge", "masa", "toplu"] as const);

  return (
    <>
      <FilterBar action="/panel/masalar" query={q} searchPlaceholder="Masa adı, numara ya da kod" searchLabel="Masa ara" hasFilters={hasFilters}>
        {branches.length > 1 ? (
          <FilterSelect id="t-sube" name="sube" label="Şube" value={branch.id} options={branches.map((b) => ({ value: b.id, label: b.active ? b.name : `${b.name} (pasif)` }))} />
        ) : (
          <input type="hidden" name="sube" value={branch.id} />
        )}
        <FilterSelect
          id="t-bolge"
          name="bolge"
          label="Bölge"
          value={areaId}
          options={[{ value: "", label: "Tümü" }, ...overview.areas.map((a) => ({ value: a.id, label: a.name })), { value: "none", label: "Bölgesiz" }]}
        />
        <FilterSelect
          id="t-durum"
          name="durum"
          label="Durum"
          value={status}
          options={[
            { value: "", label: "Tümü" },
            { value: "active", label: "Aktif" },
            { value: "inactive", label: "Pasif" },
            { value: "no_qr", label: "QR kodu yok" },
          ]}
        />
      </FilterBar>

      {overview.total > TABLE_LIST_LIMIT ? (
        <p role="status" className="mb-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          {overview.total} masadan ilk {TABLE_LIST_LIMIT} tanesi gösteriliyor. Bölge filtresi ya da arama kullanın.
        </p>
      ) : null}

      <TablesManager
        key={branch.id}
        branch={{ id: branch.id, name: branch.name, active: branch.active }}
        canManage={canManage}
        filtered={hasFilters}
        openDialog={canManage ? (dialog ?? null) : null}
        stats={{ total: overview.branchTotal, withQr: overview.withQr, shown: overview.total }}
        nextNumber={nextTableNumber([overview.maxNumber])}
        areas={overview.areas.map((a) => ({ id: a.id, name: a.name, slug: a.slug, description: a.description, active: a.active, tableCount: a._count.tables }))}
        tables={overview.tables.map((t) => {
          const qr = t.qrTokens[0];
          return {
            id: t.id,
            name: t.name,
            number: t.number,
            code: t.code,
            capacity: t.capacity,
            active: t.active,
            areaId: t.diningAreaId,
            qr: qr ? { scanCount: qr.scanCount, lastUsedAt: qr.lastUsedAt?.toISOString() ?? null } : null,
            seated: seated.get(t.id) ?? null,
          };
        })}
      />
    </>
  );
}

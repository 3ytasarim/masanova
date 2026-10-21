import { MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { listBranchAreas, listTablesForLabels } from "@/server/repositories/tables.repository";
import { getTenantProfile } from "@/server/repositories/tenant.repository";
import { getTablesPageContext, pickBranch } from "@/server/tables-page-context";
import { LabelDesigner } from "@/components/tables/label-designer";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "QR Etiketleri" };

/**
 * Etiket tasarımcısı + toplu A4 baskı. QR adresi içerdiğinden yalnızca masa yönetim yetkisiyle (destek modu hariç).
 */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { scope, canManage, branches } = await getTablesPageContext();
  if (!canManage) notFound();
  const params = await searchParams;
  const branch = pickBranch(branches, param(params, "sube", 40));
  if (!branch) return <EmptyState icon={MapPin} title="Henüz şube yok" description="Etiket basmak için önce şube ve masa oluşturun." />;

  const [areas, tables, profile] = await Promise.all([listBranchAreas(scope, branch.id), listTablesForLabels(scope, branch.id), getTenantProfile(scope)]);
  const requested = param(params, "masa", 40);

  return (
    <LabelDesigner
      key={branch.id}
      branches={branches.map((b) => ({ id: b.id, name: b.name }))}
      branchId={branch.id}
      areas={areas.map((a) => ({ id: a.id, name: a.name }))}
      tables={tables.map((t) => ({ id: t.id, name: t.name, areaId: t.diningAreaId, active: t.active, hasQr: t._count.qrTokens > 0 }))}
      initialTableId={tables.some((t) => t.id === requested) ? requested! : null}
      hasLogo={!!(profile?.settings?.logoUrl || profile?.settings?.logoAssetId)}
      hasBrandColor={!!profile?.settings?.primaryColor}
    />
  );
}

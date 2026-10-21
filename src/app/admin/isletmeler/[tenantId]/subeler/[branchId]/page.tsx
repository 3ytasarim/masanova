import { notFound } from "next/navigation";
import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { getLocaleOptions } from "@/lib/validation/intl";
import { updateBranchAction } from "@/server/actions/tenant-admin.actions";
import { findBranchById } from "@/server/repositories/branch.repository";
import { BranchForm } from "@/components/dashboard/branch-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Şubeyi Düzenle" };

/**
 * Şube düzenleme. Şube YALNIZCA URL'deki kiracının kapsamında aranır: A'nın şube id'si B'nin rotasında
 * (/admin/isletmeler/B/subeler/<A-şubesi>) 404 döner ve güncelleme eylemi de aynı kapsamla reddeder.
 */
export default async function EditBranchPage({ params }: { params: Promise<{ tenantId: string; branchId: string }> }) {
  const { tenantId, branchId } = await params;
  const { tenant, scope } = await requireSuperAdminTenant(tenantId);
  const branch = await findBranchById(scope, branchId);
  if (!branch) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{branch.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <BranchForm
          options={getLocaleOptions()}
          mode="edit"
          action={updateBranchAction.bind(null, tenant.id, branch.id)}
          cancelHref={`/admin/isletmeler/${tenant.id}/subeler`}
          defaults={branch}
        />
      </CardContent>
    </Card>
  );
}

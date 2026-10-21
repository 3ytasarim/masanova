import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { getLocaleOptions } from "@/lib/validation/intl";
import { createBranchAction } from "@/server/actions/tenant-admin.actions";
import { BranchForm } from "@/components/dashboard/branch-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Yeni Şube" };

export default async function NewBranchPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenant } = await requireSuperAdminTenant((await params).tenantId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Yeni şube</CardTitle>
      </CardHeader>
      <CardContent>
        <BranchForm
          options={getLocaleOptions()}
          mode="create"
          action={createBranchAction.bind(null, tenant.id)}
          cancelHref={`/admin/isletmeler/${tenant.id}/subeler`}
          defaults={{ country: "TR", timezone: "Europe/Istanbul", currency: "TRY", locale: "tr" }}
        />
      </CardContent>
    </Card>
  );
}

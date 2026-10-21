import type { Metadata } from "next";
import { requireTenantUser } from "@/lib/auth/guards";
import { getLocaleOptions } from "@/lib/validation/intl";
import { createOwnBranchAction } from "@/server/actions/settings.actions";
import { BranchForm } from "@/components/dashboard/branch-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Yeni Şube" };

export default async function NewOwnBranchPage() {
  await requireTenantUser({ permission: "settings.manage", write: true });
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Yeni şube</CardTitle>
      </CardHeader>
      <CardContent>
        <BranchForm
          options={getLocaleOptions()}
          mode="create"
          action={createOwnBranchAction}
          cancelHref="/panel/ayarlar"
          defaults={{ country: "TR", timezone: "Europe/Istanbul", currency: "TRY", locale: "tr" }}
        />
      </CardContent>
    </Card>
  );
}

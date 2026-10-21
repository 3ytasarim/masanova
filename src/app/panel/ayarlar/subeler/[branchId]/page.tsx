import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { getLocaleOptions } from "@/lib/validation/intl";
import { updateOwnBranchAction } from "@/server/actions/settings.actions";
import { findBranchById } from "@/server/repositories/branch.repository";
import { BranchForm } from "@/components/dashboard/branch-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Şubeyi Düzenle" };

/** Şube YALNIZCA oturumdaki kiracının kapsamında aranır: başka kiracının şube id'si 404 döner. */
export default async function EditOwnBranchPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const ctx = await requireTenantUser({ permission: "settings.manage", write: true });
  if (!/^[a-z0-9]{20,40}$/.test(branchId)) notFound();
  const branch = await findBranchById(ctx.scope, branchId);
  if (!branch) notFound();

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{branch.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <BranchForm options={getLocaleOptions()} mode="edit" action={updateOwnBranchAction.bind(null, branch.id)} cancelHref="/panel/ayarlar" defaults={branch} />
      </CardContent>
    </Card>
  );
}

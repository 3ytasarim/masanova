import { LifeBuoy } from "lucide-react";
import Link from "next/link";
import { PLANS } from "@/config/plans";
import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { isTenantAccessible } from "@/lib/tenant/resolve-tenant";
import { startSupportModeAction } from "@/server/actions/tenant-admin.actions";
import { TenantStatusActions } from "@/components/dashboard/tenant-status-actions";
import { TenantStatusBadge } from "@/components/dashboard/tenant-status-badge";
import { TenantTabs } from "@/components/dashboard/tenant-tabs";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Props = { children: React.ReactNode; params: Promise<{ tenantId: string }> };

export async function generateMetadata({ params }: Omit<Props, "children">) {
  const { tenant } = await requireSuperAdminTenant((await params).tenantId);
  return { title: tenant.name };
}

export default async function TenantDetailLayout({ children, params }: Props) {
  const { tenant } = await requireSuperAdminTenant((await params).tenantId);
  const supportAction = startSupportModeAction.bind(null, tenant.id);

  return (
    <>
      <header className="flex flex-col gap-4 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link href="/admin/isletmeler" className="text-xs font-medium uppercase tracking-wider text-fg-subtle hover:text-fg">
            İşletmeler
          </Link>
          <h1 className="mt-2 text-title font-semibold">{tenant.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-subtle">
            <TenantStatusBadge status={tenant.status} />
            <Badge>{PLANS[tenant.plan].label}</Badge>
            <code className="font-mono text-xs">{tenant.slug}</code>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isTenantAccessible(tenant.status) || tenant.status === "SUSPENDED" ? (
            <ConfirmDialog
              action={supportAction}
              triggerLabel={
                <>
                  <LifeBuoy aria-hidden="true" /> Destek Modu
                </>
              }
              title={`${tenant.name} — Destek Modu`}
              description="İşletmenin panelini, işletme sahibi görünürlüğüyle SALT OKUNUR olarak açarsınız. Başlangıç ve bitiş denetim kaydına yazılır, panelde sürekli bir uyarı bandı görünür ve mod en fazla 60 dakika açık kalır."
              confirmLabel="Destek modunu başlat"
            />
          ) : null}
          <TenantStatusActions tenant={tenant} size="sm" />
        </div>
      </header>
      <TenantTabs tenantId={tenant.id} />
      {children}
    </>
  );
}

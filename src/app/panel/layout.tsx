import type { Metadata } from "next";
import { requireTenantUser } from "@/lib/auth/guards";
import { PERMISSIONS, ROLE_LABELS, hasPermission } from "@/lib/permissions/roles";
import { SupportBanner } from "@/components/dashboard/support-banner";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ToastProvider } from "@/components/ui/toast";
import { prisma } from "@/lib/db/prisma";
import { MEDIA_ASSET_SELECT, resolveImage } from "@/server/media/urls";
import { getTenantEntitlements } from "@/server/billing/entitlements";
import { BillingWarning } from "@/components/billing/feature-gate";
import { FEATURES } from "@/config/plans";
import { NewOrderAlerts } from "@/components/realtime/new-order-alerts";

export const metadata: Metadata = {
  title: { default: "Genel Bakış", template: "%s · MasaNova Panel" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant, support } = await requireTenantUser({ permission: "panel.view" });
  // Destek modunda menü, işletme sahibi görünürlüğüyle (salt okunur) gösterilir.
  const effectiveRole = support ? "TENANT_OWNER" : user.role;
  const permissions = PERMISSIONS.filter((permission) => hasPermission(effectiveRole, permission));
  const roleLabel = support ? `${ROLE_LABELS[user.role]} · Destek` : ROLE_LABELS[user.role];
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: tenant.id }, select: { logoUrl: true, logoAsset: { select: MEDIA_ASSET_SELECT } } });
  const logoUrl = resolveImage(settings?.logoAsset, settings?.logoUrl)?.url ?? null;
  // Paket yetkileri: gezinmede kilitli öğeler + yalnızca SAHİBE abonelik uyarısı (personel / müşteri görmez).
  const ent = await getTenantEntitlements(tenant.id);
  const features = FEATURES.filter((f) => ent.has(f));
  const billingBanner = permissions.includes("billing.view") ? <BillingWarning ent={ent} /> : null;

  return (
    <ToastProvider>
      <DashboardShell
        area="panel"
        permissions={permissions}
        features={features}
        contextLabel={tenant.name}
        contextLogoUrl={logoUrl}
        contextMeta={roleLabel}
        user={{ name: `${user.firstName} ${user.lastName}`, email: user.email, roleLabel }}
        banner={
          support || billingBanner ? (
            <>
              {support ? <SupportBanner tenantName={tenant.name} startedAt={support.startedAt} area="panel" /> : null}
              {billingBanner}
            </>
          ) : undefined
        }
      >
        {children}
      </DashboardShell>
      {/* Yeni sipariş: anında sesli + görsel bildirim (sipariş görme yetkisi + sipariş paketi olanlara). */}
      {permissions.includes("orders.view") && ent.has("ordering") ? <NewOrderAlerts /> : null}
    </ToastProvider>
  );
}

import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { getCurrentSession } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/permissions/roles";
import { findTenantSummaryById } from "@/server/repositories/tenant-admin.repository";
import { SupportBanner } from "@/components/dashboard/support-banner";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "Genel Bakış", template: "%s · MasaNova Admin" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, platform } = await requireSuperAdmin();
  const session = await getCurrentSession();
  const supportTenant = session?.support ? await findTenantSummaryById(platform, session.support.tenantId) : null;

  return (
    <ToastProvider>
      <DashboardShell
        area="admin"
        contextLabel="Platform Yönetimi"
        contextMeta="3Y Tasarım & Yazılım"
        user={{ name: `${user.firstName} ${user.lastName}`, email: user.email, roleLabel: ROLE_LABELS[user.role] }}
        banner={
          session?.support && supportTenant ? (
            <SupportBanner tenantName={supportTenant.name} startedAt={session.support.startedAt} area="admin" />
          ) : undefined
        }
      >
        {children}
      </DashboardShell>
    </ToastProvider>
  );
}

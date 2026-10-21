import { BellRing, CircleCheck, Globe, Lightbulb, MapPin, ScrollText, Timer, Users } from "lucide-react";
import Link from "next/link";
import { hasPermission } from "@/lib/permissions/roles";
import { formatDurationShort } from "@/lib/service-requests/timing";
import { getServiceMetrics } from "@/server/repositories/service-requests.repository";
import { advisorOverview } from "@/server/services/advisor/advisor.service";
import { auditActionLabel } from "@/lib/audit/actions";
import { requireTenantUser } from "@/lib/auth/guards";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils/format";
import { listTenantAuditLogs } from "@/server/repositories/audit-log.repository";
import { listBranches } from "@/server/repositories/branch.repository";
import { getTenantProfile } from "@/server/repositories/tenant.repository";
import { countTenantUsers } from "@/server/repositories/user.repository";
import { TenantStatusBadge } from "@/components/dashboard/tenant-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { getTenantEntitlements } from "@/server/billing/entitlements";
import { EFFECTIVE_STATE_LABELS } from "@/lib/billing/labels";
import { PLANS } from "@/config/plans";

export default async function PanelOverviewPage() {
  const { user, scope, support } = await requireTenantUser({ permission: "panel.view" });
  const showService = hasPermission(support ? "TENANT_OWNER" : user.role, "service.view");
  const [profile, branches, staffCount, activity] = await Promise.all([
    getTenantProfile(scope),
    listBranches(scope),
    countTenantUsers(scope),
    listTenantAuditLogs(scope, 8),
  ]);
  const service = showService ? await getServiceMetrics(scope, {}) : null;
  const effectiveRole = support ? "TENANT_OWNER" : user.role;
  // Paket kartı: herkes paket rozetini görür; dönem / kullanım ayrıntısı yalnızca sahibe (billing.view).
  const ent = await getTenantEntitlements(scope.tenantId);
  const owner = hasPermission(effectiveRole, "billing.view");
  // İşletme Danışmanı özeti (yalnızca sayaç + en önemli başlık; panoyu doldurmaz). Hata panoyu bozmaz.
  const advisor = hasPermission(effectiveRole, "advisor.view") ? await advisorOverview({ scope, userId: user.id, canMutate: !support && hasPermission(effectiveRole, "advisor.manage") }).catch(() => null) : null;
  if (!profile) throw new Error("Oturumdaki kiracı bulunamadı.");

  const primaryDomain = profile.domains[0]?.hostname;
  const activeBranches = branches.filter((b) => b.active).length;

  return (
    <>
      <PageHeader
        eyebrow={profile.name}
        title={`Hoş geldiniz, ${user.firstName}`}
        description="İşletmenizin genel durumu. Sipariş, menü ve masa modülleri sonraki sprintlerde bu ekrana eklenecek."
        actions={<TenantStatusBadge status={profile.status} />}
      />

      <section aria-label="Özet" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Aktif şube" value={formatNumber(activeBranches)} hint={`Toplam ${formatNumber(branches.length)} şube`} icon={MapPin} />
        <StatCard label="Aktif personel" value={formatNumber(staffCount)} icon={Users} />
        <StatCard
          label="Paket"
          value={
            <span className="text-xl" data-testid="dashboard-plan" data-plan={ent.subscribedPlan} data-state={ent.state}>
              {PLANS[ent.subscribedPlan].label}
            </span>
          }
          icon={CircleCheck}
          hint={
            owner ? (
              <Link href="/panel/abonelik" className="underline-offset-4 hover:underline">
                {EFFECTIVE_STATE_LABELS[ent.state]}
                {ent.endsAt ? ` · ${formatDate(ent.endsAt)} tarihine kadar` : ""}
              </Link>
            ) : undefined
          }
        />
        <StatCard
          label="QR menü adresi"
          value={<span className="block truncate text-base font-medium">{primaryDomain ?? "—"}</span>}
          icon={Globe}
          hint={profile.settings ? `${profile.settings.defaultLocale.toUpperCase()} · ${profile.settings.defaultCurrency} · ${profile.settings.timezone}` : undefined}
        />
      </section>

      {advisor && advisor.total > 0 ? (
        <section aria-label="İşletme Danışmanı" className="mt-4" data-testid="overview-advisor">
          <Link href="/panel/ai/danisman" className="flex items-start gap-3 rounded-lg border border-border bg-bg p-4 shadow-xs transition-colors hover:bg-surface">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-strong">
              <Lightbulb aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">
                İşletme Danışmanı · {advisor.newCount > 0 ? `${formatNumber(advisor.newCount)} yeni içgörü` : `${formatNumber(advisor.total)} içgörü`}
              </span>
              {advisor.top ? <span className="mt-0.5 block truncate text-sm text-fg-muted">{advisor.top}</span> : null}
            </span>
          </Link>
        </section>
      ) : null}

      {service ? (
        <section aria-label="Servis özeti" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="overview-service">
          <StatCard label="Açık servis talebi" value={formatNumber(service.open + service.acknowledged)} hint={<Link href="/panel/servis" className="underline underline-offset-2">Servis panosu</Link>} icon={BellRing} />
          <StatCard label="Ortalama yanıt (bugün)" value={<span className="text-xl">{formatDurationShort(service.avgResponseMs)}</span>} hint={`Bugün tamamlanan: ${formatNumber(service.completedToday)}`} icon={Timer} />
        </section>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Şubeler</CardTitle>
            <CardDescription>Şube yönetimi Ayarlar modülüyle gelecek.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {branches.length === 0 ? (
              <EmptyState icon={MapPin} title="Şube yok" className="m-5" />
            ) : (
              <ul className="divide-y divide-border">
                {branches.map((branch) => (
                  <li key={branch.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-fg">{branch.name}</div>
                      <div className="truncate text-xs text-fg-subtle">{[branch.district, branch.city].filter(Boolean).join(", ") || branch.slug}</div>
                    </div>
                    {branch.active ? <Badge tone="success" dot>Açık</Badge> : <Badge dot>Kapalı</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Son etkinlik</CardTitle>
            <CardDescription>İşletmenize ait denetim kayıtları.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {activity.length === 0 ? (
              <EmptyState icon={ScrollText} title="Henüz etkinlik yok" className="m-5" />
            ) : (
              <ul className="divide-y divide-border">
                {activity.map((log) => (
                  <li key={log.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="truncate text-sm text-fg">{auditActionLabel(log.action)}</span>
                    <span className="shrink-0 text-xs text-fg-subtle">{formatDateTime(log.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

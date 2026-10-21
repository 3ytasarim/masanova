import { Activity, Building2, CalendarPlus, CircleCheck, CirclePause, Clock, Globe, MapPin, Plus, ScrollText, Users } from "lucide-react";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { STATUS_LABELS } from "@/lib/tenant/status";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { listRecentAuditLogs } from "@/server/repositories/audit-log.repository";
import { getDashboardStats, listRecentTenants } from "@/server/repositories/tenant-admin.repository";
import { mapUserEmails } from "@/server/repositories/user.repository";
import { checkDatabase } from "@/server/services/system.service";
import { AuditTimelineItem } from "@/components/dashboard/audit-row";
import { TenantStatusBadge } from "@/components/dashboard/tenant-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

const STATUS_BAR: Record<string, string> = { TRIAL: "bg-info", ACTIVE: "bg-success", SUSPENDED: "bg-warning", CANCELLED: "bg-fg-subtle" };

export default async function AdminOverviewPage() {
  const { platform } = await requireSuperAdmin();
  const [stats, recentTenants, recentAudit, database] = await Promise.all([
    getDashboardStats(platform),
    listRecentTenants(platform),
    listRecentAuditLogs(platform, 8),
    checkDatabase(),
  ]);
  const actors = await mapUserEmails([...new Set(recentAudit.map((l) => l.userId).filter((id): id is string => !!id))]);
  const statuses = (["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"] as const).map((s) => ({ status: s, count: stats.byStatus[s] }));

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Genel Bakış"
        description="MasaNova AI üzerindeki işletmelerin ve sistemin anlık durumu."
        actions={
          <>
            <Link href="/admin/domainler" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Globe aria-hidden="true" /> Domain Yönetimi
            </Link>
            <Link href="/admin/subeler/yeni" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Plus aria-hidden="true" /> Yeni Şube
            </Link>
            <Link href="/admin/isletmeler/yeni" className={buttonVariants({ size: "sm" })}>
              <Plus aria-hidden="true" /> Yeni İşletme
            </Link>
          </>
        }
      />

      <section aria-label="Özet" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Toplam İşletme" value={formatNumber(stats.tenantsTotal)} icon={Building2} />
        <StatCard label="Aktif İşletme" value={formatNumber(stats.byStatus.ACTIVE)} icon={CircleCheck} />
        <StatCard label="Deneme (Trial)" value={formatNumber(stats.byStatus.TRIAL)} icon={Clock} />
        <StatCard label="Askıdaki İşletme" value={formatNumber(stats.byStatus.SUSPENDED)} icon={CirclePause} />
        <StatCard label="Toplam Şube" value={formatNumber(stats.branchesTotal)} icon={MapPin} />
        <StatCard label="Toplam Kullanıcı" value={formatNumber(stats.tenantUsersTotal)} icon={Users} hint="İşletme kullanıcıları" />
        <StatCard label="Bu Ay Yeni İşletme" value={formatNumber(stats.newTenantsThisMonth)} icon={CalendarPlus} hint="İstanbul saatiyle ay başından beri" />
        <StatCard
          label="Sistem Durumu"
          icon={Activity}
          value={database.status === "connected" ? <Badge tone="success" dot className="text-sm">Çalışıyor</Badge> : <Badge tone="danger" dot className="text-sm">Sorun var</Badge>}
          hint={database.status === "connected" ? `Veritabanı ${database.latencyMs} ms` : "Veritabanına erişilemiyor"}
        />
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Son eklenen işletmeler</CardTitle>
              <CardDescription>En yeni 6 işletme</CardDescription>
            </div>
            <Link href="/admin/isletmeler" className="text-sm font-medium text-fg underline underline-offset-4">
              Tümü
            </Link>
          </CardHeader>
          <CardContent className="p-4 md:p-5">
            {recentTenants.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="Henüz işletme yok"
                description="İlk restoran müşterinizi oluşturun."
                action={<Link href="/admin/isletmeler/yeni" className={buttonVariants({ size: "sm" })}>Yeni İşletme</Link>}
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>İşletme</TH>
                    <TH>Durum</TH>
                    <TH className="text-right">Şube</TH>
                    <TH>Kayıt</TH>
                  </TR>
                </THead>
                <TBody>
                  {recentTenants.map((tenant) => (
                    <TR key={tenant.id}>
                      <TD label="İşletme">
                        <Link href={`/admin/isletmeler/${tenant.id}`} className="font-medium text-fg hover:underline">
                          {tenant.name}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-fg-subtle">{tenant.slug}</span>
                      </TD>
                      <TD label="Durum"><TenantStatusBadge status={tenant.status} /></TD>
                      <TD label="Şube" className="text-right tabular-nums">{tenant._count.branches}</TD>
                      <TD label="Kayıt" className="whitespace-nowrap">{formatDateTime(tenant.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Durum dağılımı</CardTitle>
            <CardDescription>İşletmelerin yaşam döngüsü durumu</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.tenantsTotal === 0 ? (
              <p className="text-sm text-fg-subtle">Veri yok.</p>
            ) : (
              <ul className="grid gap-4">
                {statuses.map(({ status, count }) => {
                  const pct = Math.round((count / stats.tenantsTotal) * 100);
                  return (
                    <li key={status}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-fg-muted">{STATUS_LABELS[status]}</span>
                        <span className="tabular-nums text-fg">
                          {formatNumber(count)} <span className="text-fg-subtle">· %{pct}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                        <div className={`h-full rounded-full ${STATUS_BAR[status]}`} style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Son denetim kayıtları</CardTitle>
            <CardDescription>Platformdaki son işlemler</CardDescription>
          </div>
          <Link href="/admin/audit-logs" className="text-sm font-medium text-fg underline underline-offset-4">
            Tümü
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentAudit.length === 0 ? (
            <EmptyState icon={ScrollText} title="Kayıt yok" className="m-5" />
          ) : (
            <ul className="divide-y divide-border">
              {recentAudit.map((log) => (
                <AuditTimelineItem key={log.id} log={log} actor={log.userId ? actors.get(log.userId) : undefined} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

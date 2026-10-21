import { Globe } from "lucide-react";
import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { formatTenantAddress, getTenantUrl } from "@/lib/domain/get-tenant-url";
import { formatDateTime } from "@/lib/utils/format";
import { addCustomDomainAction, domainOperationAction } from "@/server/actions/tenant-admin.actions";
import { listTenantDomains, mapPendingChallenges } from "@/server/repositories/domain.repository";
import { OUTCOME_LABELS, verificationChallenge } from "@/server/services/domain-verification.service";
import { AddCustomDomainForm, CopyValue, DomainOpConfirm, VerifyDomainButton } from "@/components/dashboard/domains/domain-actions";
import { DomainStateBadge, DomainTypeBadge } from "@/components/dashboard/domains/domain-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Domainler" };

export default async function TenantDomainsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenant, scope } = await requireSuperAdminTenant((await params).tenantId);
  const [domains, challenges] = await Promise.all([listTenantDomains(scope), mapPendingChallenges(scope)]);
  const op = domainOperationAction.bind(null, tenant.id);

  return (
    <div className="grid gap-6">
      <section aria-labelledby="domains-title" className="grid gap-4">
        <h2 id="domains-title" className="text-lg font-semibold tracking-tight">
          Alan adları
        </h2>
        {domains.length === 0 ? (
          <EmptyState icon={Globe} title="Alan adı yok" />
        ) : (
          <ul className="grid gap-4">
            {domains.map((d) => {
              const token = challenges.get(d.id);
              const challenge = token ? verificationChallenge(d.hostname, token) : null;
              const reason = d.verification?.failureReason as keyof typeof OUTCOME_LABELS | null | undefined;
              return (
                <li key={d.id}>
                  <Card>
                    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {d.verified ? (
                            <a href={getTenantUrl(d.hostname)} target="_blank" rel="noreferrer" className="break-all font-mono text-sm font-medium text-fg underline-offset-4 hover:underline">
                              {formatTenantAddress(d.hostname)}
                            </a>
                          ) : (
                            <span className="break-all font-mono text-sm font-medium text-fg">{d.hostname}</span>
                          )}
                          {d.isPrimary ? <Badge tone="accent">Birincil</Badge> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <DomainTypeBadge type={d.type} />
                          <DomainStateBadge verified={d.verified} status={d.verification?.status} />
                          <span className="text-xs text-fg-subtle">Eklendi: {formatDateTime(d.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {d.verified && !d.isPrimary ? (
                          <DomainOpConfirm action={op} domainId={d.id} op="primary" label="Birincil yap" title={`${d.hostname} birincil olsun mu?`} description="İşletmenin varsayılan adresi bu alan adı olur. Diğer alan adları çalışmaya devam eder." />
                        ) : null}
                        {d.type === "CUSTOM_DOMAIN" && !d.isPrimary ? (
                          <DomainOpConfirm action={op} domainId={d.id} op="remove" label="Kaldır" title={`${d.hostname} kaldırılsın mı?`} description="Alan adı ve doğrulama kaydı silinir; bu adres artık işletmeye çözümlenmez. İşletme ve diğer veriler etkilenmez." destructive />
                        ) : null}
                      </div>
                    </div>

                    {challenge ? (
                      <div className="border-t border-border bg-surface px-5 py-4">
                        <h3 className="text-sm font-semibold">DNS doğrulaması</h3>
                        <p className="mt-1 text-[0.8125rem] text-fg-muted">
                          Alan adınızın DNS yönetim panelinde aşağıdaki <strong>TXT</strong> kaydını oluşturun, ardından kontrol edin. Doğrulama
                          yalnızca gerçek DNS sorgusu bu değeri döndürdüğünde tamamlanır.
                        </p>
                        <dl className="mt-3 grid gap-3 md:grid-cols-[6rem_minmax(0,1fr)] md:items-center">
                          <dt className="text-xs font-medium text-fg-subtle">Tür</dt>
                          <dd className="font-mono text-xs">TXT</dd>
                          <dt className="text-xs font-medium text-fg-subtle">Ad (host)</dt>
                          <dd><CopyValue value={challenge.name} label="Kayıt adını" /></dd>
                          <dt className="text-xs font-medium text-fg-subtle">Değer</dt>
                          <dd><CopyValue value={challenge.value} label="Kayıt değerini" /></dd>
                        </dl>
                        <p className="mt-3 text-[0.8125rem] text-fg-subtle">
                          {d.verification?.lastCheckedAt
                            ? `Son kontrol: ${formatDateTime(d.verification.lastCheckedAt)} · ${d.verification.attempts} deneme${reason && reason in OUTCOME_LABELS ? ` · ${OUTCOME_LABELS[reason]}` : ""}`
                            : "Henüz kontrol edilmedi."}
                        </p>
                        <p className="mt-1 text-[0.8125rem] text-fg-subtle">
                          Yayın için ayrıca alan adının platforma yönlendirilmesi (CNAME/A kaydı) gerekir; bu adım bir sonraki sprintte otomatik kontrol edilecek.
                        </p>
                        <div className="mt-4 flex flex-wrap items-start gap-2">
                          <VerifyDomainButton action={op} domainId={d.id} />
                          <DomainOpConfirm action={op} domainId={d.id} op="regenerate" label="Yeni kod üret" title="Doğrulama kodunu yenile" description="Yeni bir TXT değeri üretilir; eski değer geçersiz olur ve DNS kaydının güncellenmesi gerekir." />
                        </div>
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Özel alan adı ekle</CardTitle>
          <CardDescription>Eklenen alan adı DNS doğrulaması tamamlanana kadar yayına çıkmaz ve birincil yapılamaz.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddCustomDomainForm action={addCustomDomainAction.bind(null, tenant.id)} />
        </CardContent>
      </Card>
    </div>
  );
}

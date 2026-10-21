import { notFound } from "next/navigation";
import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { buildSubdomainHostname, formatTenantAddress, getTenantUrl } from "@/lib/domain/get-tenant-url";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { getLocaleOptions } from "@/lib/validation/intl";
import { changeTenantSlugAction, invalidateTenantMenuCacheAction, updateTenantBrandingAction, updateTenantGeneralAction } from "@/server/actions/tenant-admin.actions";
import { getTableCountsForTenant } from "@/server/repositories/tables.repository";
import { findTenantDetail } from "@/server/repositories/tenant-admin.repository";
import { TenantBrandingForm, TenantGeneralForm } from "@/components/dashboard/tenant-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Props = { params: Promise<{ tenantId: string }> };

export default async function TenantGeneralPage({ params }: Props) {
  const { platform, tenant, scope } = await requireSuperAdminTenant((await params).tenantId);
  const [detail, tables] = await Promise.all([findTenantDetail(platform, tenant.id), getTableCountsForTenant(platform, scope)]);
  if (!detail) notFound();
  const settings = detail.settings;
  const primary = detail.domains[0]?.hostname;

  const facts: [string, React.ReactNode][] = [
    ["Tenant ID", <code key="id" className="font-mono text-xs">{detail.id}</code>],
    ["Birincil adres", primary ? <a key="d" href={getTenantUrl(primary)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4">{formatTenantAddress(primary)}</a> : "—"],
    ["Şube / kullanıcı / alan adı", `${formatNumber(detail._count.branches)} / ${formatNumber(detail._count.users)} / ${formatNumber(detail._count.domains)}`],
    // Salt okunur: Super Admin buradan (ve destek modundan) QR oluşturamaz / yenileyemez / göremez.
    ["Bölge / masa", `${formatNumber(tables.areas)} / ${formatNumber(tables.tables)}`],
    ["QR kodu (etkin / toplam)", `${formatNumber(tables.activeQr)} / ${formatNumber(tables.qrTotal)}`],
    ["Oluşturulma", formatDateTime(detail.createdAt)],
    ["Son güncelleme", formatDateTime(detail.updatedAt)],
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="grid gap-6 xl:col-span-2">
        <Card id="genel-duzenle" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Genel bilgiler</CardTitle>
            <CardDescription>İşletme adı ve varsayılan yerel ayarlar.</CardDescription>
          </CardHeader>
          <CardContent>
            <TenantGeneralForm
              action={updateTenantGeneralAction.bind(null, tenant.id)}
              options={getLocaleOptions()}
              defaults={{
                name: detail.name,
                defaultLocale: settings?.defaultLocale ?? "tr",
                defaultCurrency: settings?.defaultCurrency ?? "TRY",
                timezone: settings?.timezone ?? "Europe/Istanbul",
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Marka</CardTitle>
            <CardDescription>QR menü ve panelde kullanılacak logo ve renkler.</CardDescription>
          </CardHeader>
          <CardContent>
            <TenantBrandingForm
              action={updateTenantBrandingAction.bind(null, tenant.id)}
              defaults={{
                logoUrl: settings?.logoUrl ?? "",
                primaryColor: settings?.primaryColor ?? "",
                secondaryColor: settings?.secondaryColor ?? "",
                accentColor: settings?.accentColor ?? "",
              }}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Özet</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <dl className="divide-y divide-border">
              {facts.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5 px-5 py-3">
                  <dt className="text-xs text-fg-subtle">{label}</dt>
                  <dd className="break-all text-sm text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Menü önbelleği</CardTitle>
            <CardDescription>Panel değişiklikleri önbelleği anında yeniler. Yalnızca veritabanında doğrudan (SQL) düzenleme yapıldıysa gerekir.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={invalidateTenantMenuCacheAction.bind(null, tenant.id)}>
              <button type="submit" data-testid="invalidate-menu-cache" className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-2">
                Menü önbelleğini temizle
              </button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kısa ad (slug)</CardTitle>
            <CardDescription>
              Mevcut: <code className="font-mono">{detail.slug}</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-fg-muted">Kısa ad değişikliği adresleri etkileyebilir; yalnızca gerektiğinde ve onayla yapılır.</p>
            <div className="mt-4">
              <ConfirmDialog
                action={changeTenantSlugAction.bind(null, tenant.id)}
                triggerLabel="Kısa adı değiştir"
                title="Kısa adı değiştir"
                description={
                  <>
                    Kısa ad işletmenin kalıcı kimliklerinden biridir. Alt alan adını da taşırsanız eski adres (
                    <code className="font-mono">{formatTenantAddress(buildSubdomainHostname(detail.slug))}</code>) artık çalışmaz ve basılı QR kodlar
                    yeni adrese yönlenmez.
                  </>
                }
                confirmLabel="Kısa adı değiştir"
                destructive
              >
                <Field id="slug-new" label="Yeni kısa ad" required>
                  <Input id="slug-new" name="slug" required maxLength={63} defaultValue={detail.slug} className="font-mono" autoCapitalize="none" spellCheck={false} />
                </Field>
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" name="moveSubdomain" className="mt-0.5 size-[18px] accent-primary" />
                  <span>Platform alt alan adını da yeni kısa ada taşı</span>
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" name="confirm" required className="mt-0.5 size-[18px] accent-primary" />
                  <span>Bu değişikliğin adresleri etkileyebileceğini anladım.</span>
                </label>
              </ConfirmDialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

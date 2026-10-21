import type { Metadata } from "next";
import { requireTenantUser } from "@/lib/auth/guards";
import { savePaymentSettingsAction } from "@/server/actions/payment.actions";
import { getPaymentSettings } from "@/server/payments/payment.service";
import { providerStatus } from "@/server/payments/providers";
import { PaymentSettingsForm } from "@/components/payments/payment-settings-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Ödeme ayarları" };

/**
 * Ödeme ayarları — görüntüleme payments.view, değiştirme yalnızca sahip / şube müdürü (kasiyer salt okunur; destek
 * modu salt okunur). Sağlayıcı GİZLİ anahtarları hiçbir zaman gösterilmez / girilmez: yalnızca "yapılandırıldı mı".
 */
export default async function PaymentSettingsPage() {
  const ctx = await requireTenantUser({ permission: "payments.view" });
  const settings = await getPaymentSettings(ctx.scope.tenantId);
  const provider = providerStatus();
  const canManage = !ctx.support && (ctx.user.role === "TENANT_OWNER" || ctx.user.role === "BRANCH_MANAGER");

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Ödeme ayarları</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Online ödeme, kasada ödeme kaydı ve ödeme ayırma süresi.</p>
      </header>
      {ctx.support ? (
        <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">
          Destek modu: salt okunur.
        </p>
      ) : null}

      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Ödeme sağlayıcısı</CardTitle>
            <CardDescription>Sağlayıcı ve anahtarları sunucu ortam değişkenleriyle yapılandırılır; gizli anahtarlar panelde görünmez.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-sm" data-testid="payment-provider-status" data-configured={provider.configured}>
            {provider.configured ? <Badge tone="success" dot>Yapılandırıldı</Badge> : <Badge tone="neutral" dot>Yapılandırılmadı</Badge>}
            {provider.test ? <Badge tone="warning">Test sağlayıcısı — gerçek para çekilmez</Badge> : null}
            {!provider.configured ? <span className="text-fg-subtle">Online ödeme müşteriye gösterilmez; kasada ödeme kaydı yine kullanılabilir.</span> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ayarlar</CardTitle>
            <CardDescription>{canManage ? "Varsayılan olarak kapalıdır." : "Yalnızca işletme sahibi ya da şube müdürü değiştirebilir."}</CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentSettingsForm action={savePaymentSettingsAction} disabled={!canManage} providerConfigured={provider.configured} defaults={settings} />
            <ul className="mt-6 grid gap-1.5 border-t border-border pt-4 text-sm text-fg-subtle">
              <li>• Tutar her zaman sunucuda, siparişin kaydedilmiş toplamından (indirim dahil) hesaplanır; fazla ödeme veritabanı düzeyinde engellenir.</li>
              <li>• Online ödeme yalnızca sağlayıcının imzalı bildirimi ya da sağlayıcı sorgusuyla “Başarılı” olur.</li>
              <li>• Kart numarası / CVV hiçbir zaman saklanmaz; yalnızca kart markası ve son 4 hane.</li>
              <li>• İade bakiyeyi yeniden açmaz ve sadakat puanı / kupon kullanımını değiştirmez.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

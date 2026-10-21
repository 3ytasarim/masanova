import type { Metadata } from "next";
import { Gift, Sparkles } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/permissions/roles";
import { formatNumber } from "@/lib/utils/format";
import { saveLoyaltySettingsAction } from "@/server/actions/crm.actions";
import { getLoyaltySettings } from "@/server/crm/loyalty.service";
import { LoyaltySettingsForm } from "@/components/crm/loyalty-settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "Sadakat" };

/**
 * Sadakat programı ayarları — görüntüleme loyalty.view, değiştirme loyalty.manage (sahip / müdür; destek modu salt
 * okunur). Varsayılan KAPALI; puan kuralı işletme belirleyene kadar boş. Bakiye her zaman defterden türetilir.
 */
export default async function LoyaltyPage() {
  const ctx = await requireTenantUser({ permission: "loyalty.view" });
  const tenantId = ctx.scope.tenantId;
  const canManage = !ctx.support && hasPermission(ctx.user.role, "loyalty.manage");
  const [settings, tenantSettings, members, earned, adjusted] = await Promise.all([
    getLoyaltySettings(tenantId),
    prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultCurrency: true } }),
    prisma.loyaltyAccount.count({ where: { tenantId, active: true } }),
    prisma.loyaltyLedger.aggregate({ where: { tenantId, type: "EARN" }, _sum: { points: true }, _count: { _all: true } }),
    prisma.loyaltyLedger.aggregate({ where: { tenantId, type: "ADJUSTMENT" }, _sum: { points: true } }),
  ]);
  const currency = tenantSettings?.defaultCurrency ?? "TRY";
  const symbol = new Intl.NumberFormat("tr-TR", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  const outstanding = (earned._sum.points ?? 0) + (adjusted._sum.points ?? 0);

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Sadakat</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Müşterileriniz isteğe bağlı olarak katılır ve servis edilen siparişlerinden puan kazanır. Kupon ve ödül kullanımı sonraki sürümde.</p>
      </header>

      {ctx.support ? (
        <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">
          Destek modu: salt okunur.
        </p>
      ) : null}

      <section aria-label="Sadakat özeti" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Aktif üye" value={formatNumber(members)} icon={Gift} />
        <StatCard label="Kazanılan puan" value={formatNumber(earned._sum.points ?? 0)} hint={`${formatNumber(earned._count._all)} siparişten`} icon={Sparkles} />
        <StatCard label="Dolaşımdaki puan" value={formatNumber(outstanding)} hint="Kazanım + düzeltmeler" />
      </section>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Program ayarları</CardTitle>
          <CardDescription>Varsayılan olarak kapalıdır. Açmak için önce puan kuralını belirleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoyaltySettingsForm
            action={saveLoyaltySettingsAction}
            disabled={!canManage}
            currencySymbol={symbol}
            defaults={{ enabled: settings.enabled, amountPerPoint: settings.minorPerPoint ? String(settings.minorPerPoint / 100) : "", earnOn: settings.earnOn }}
          />
          <ul className="mt-6 grid gap-1.5 border-t border-border pt-4 text-sm text-fg-subtle">
            <li>• Her sipariş en fazla bir kez puan kazanır (veritabanı düzeyinde garanti).</li>
            <li>• Puan yalnızca sadakate katılmış ve sipariş anında tanınan müşterinin siparişine yazılır; anonim siparişler sonradan puanlanmaz.</li>
            <li>• Sipariş reddedilir / iptal edilirse kazanılan puan geri alınır ve kullanılan ödül puanı iade edilir (yeni defter satırı, tek kez).</li>
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

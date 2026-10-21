import type { Metadata } from "next";
import { Gift, Plus } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { formatPercent } from "@/lib/promotions/engine";
import { formatMoney } from "@/lib/menu/money";
import { rewardStateAction } from "@/server/actions/campaign.actions";
import { getLoyaltySettings } from "@/server/crm/loyalty.service";
import { listRewards } from "@/server/promotions/admin.service";
import { formOptions } from "@/server/promotions/form-options";
import { StateButton } from "@/components/campaigns/campaign-forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Sadakat ödülleri" };

/** Puanla alınan ödüller. Kullanım = geri alınmamış REDEEM satırları. */
export default async function RewardsPage() {
  const ctx = await requireTenantUser({ permission: "campaigns.view" });
  const canManage = !ctx.support && hasPermission(ctx.user.role, "campaigns.manage");
  const [rewards, opts, loyalty] = await Promise.all([listRewards(ctx.scope), formOptions(ctx.scope.tenantId), getLoyaltySettings(ctx.scope.tenantId)]);
  const money = (m: number) => formatMoney(m, opts.currency);
  return (
    <>
      <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-title font-semibold text-fg">Sadakat ödülleri</h1>
          <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Üyeler QR sepetinde “Puanlarını kullan” ile ödül alır; puan siparişle aynı anda düşer, sipariş reddedilir / iptal edilirse geri yüklenir.</p>
        </div>
        {canManage ? (
          <Link href="/panel/kampanyalar/oduller/yeni" className={buttonVariants({ variant: "primary" })} data-testid="reward-new">
            <Plus aria-hidden="true" /> Yeni ödül
          </Link>
        ) : null}
      </header>
      {!loyalty.enabled ? <p role="note" className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm">Sadakat programı kapalı; ödüller müşteriye gösterilmez. <Link href="/panel/sadakat" className="font-medium underline">Sadakat ayarları</Link></p> : null}
      {rewards.length === 0 ? (
        <EmptyState icon={Gift} title="Henüz ödül yok" description="Örn. 500 puan = 50 ₺ indirim ya da ücretsiz tatlı." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Ödül</TH>
              <TH className="text-right">Puan</TH>
              <TH>Karşılığı</TH>
              <TH className="text-right">Kullanım</TH>
              <TH>Durum</TH>
              {canManage ? <TH>İşlem</TH> : null}
            </TR>
          </THead>
          <TBody>
            {rewards.map((r) => (
              <TR key={r.id} data-reward-row={r.name}>
                <TD label="Ödül">
                  {r.archivedAt ? <span className="font-semibold">{r.name}</span> : (
                    <Link href={`/panel/kampanyalar/oduller/${r.id}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                  )}
                  {r.description ? <span className="block text-xs text-fg-subtle">{r.description}</span> : null}
                </TD>
                <TD label="Puan" className="text-right tabular-nums">
                  {r.pointsCost}
                </TD>
                <TD label="Karşılığı">{r.rewardType === "FIXED_AMOUNT" ? money(r.fixedDiscountMinor ?? 0) : r.rewardType === "PERCENTAGE" ? formatPercent(r.percentageBps ?? 0) : `Ücretsiz: ${r.freeProduct?.name ?? "—"}`}</TD>
                <TD label="Kullanım" className="text-right tabular-nums">
                  {r.redeemed}
                </TD>
                <TD label="Durum">
                  <Badge tone={r.archivedAt ? "neutral" : r.isActive ? "success" : "neutral"}>{r.archivedAt ? "Arşiv" : r.isActive ? "Etkin" : "Durduruldu"}</Badge>
                </TD>
                {canManage ? (
                  <TD label="İşlem">
                    {r.archivedAt ? null : (
                      <div className="flex flex-wrap gap-1.5">
                        {r.isActive ? <StateButton action={rewardStateAction.bind(null, r.id, "inactive")} label="Durdur" /> : <StateButton action={rewardStateAction.bind(null, r.id, "active")} label="Etkinleştir" variant="primary" />}
                        <StateButton action={rewardStateAction.bind(null, r.id, "archived")} label="Arşivle" variant="ghost" confirmText="Ödül arşivlensin mi? Geçmiş kullanımlar korunur." />
                      </div>
                    )}
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

import type { Metadata } from "next";
import { Plus, Ticket } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { formatPercent } from "@/lib/promotions/engine";
import { formatMoney } from "@/lib/menu/money";
import { formatDateTime } from "@/lib/utils/format";
import { couponStatusAction } from "@/server/actions/campaign.actions";
import { listCoupons } from "@/server/promotions/admin.service";
import { formOptions } from "@/server/promotions/form-options";
import { StateButton } from "@/components/campaigns/campaign-forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Kuponlar" };

const STATUS = { ACTIVE: { label: "Etkin", tone: "success" }, INACTIVE: { label: "Durduruldu", tone: "neutral" }, ARCHIVED: { label: "Arşiv", tone: "neutral" } } as const;
const AUDIENCE = { ANYONE: "Herkes", IDENTIFIED: "Kayıtlı müşteri", LOYALTY_MEMBER: "Sadakat üyesi", REPEAT_CUSTOMER: "Tekrar gelen" } as const;

/** Kupon listesi — kullanım sayısı yalnızca iptal / ret OLMAYAN siparişlerden. Destek modu salt okunur. */
export default async function CouponsPage() {
  const ctx = await requireTenantUser({ permission: "campaigns.view" });
  const canManage = !ctx.support && hasPermission(ctx.user.role, "campaigns.manage");
  const [coupons, opts] = await Promise.all([listCoupons(ctx.scope), formOptions(ctx.scope.tenantId)]);
  const money = (m: number) => formatMoney(m, opts.currency);
  return (
    <>
      <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-title font-semibold text-fg">Kuponlar</h1>
          <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Müşteri QR sepetinde kodu girer; indirim sipariş gönderilirken sunucuda kesinleşir. Siparişte tek kupon ya da tek ödül.</p>
        </div>
        {canManage ? (
          <Link href="/panel/kampanyalar/kuponlar/yeni" className={buttonVariants({ variant: "primary" })} data-testid="coupon-new">
            <Plus aria-hidden="true" /> Yeni kupon
          </Link>
        ) : null}
      </header>
      {ctx.support ? <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">Destek modu: salt okunur.</p> : null}
      {coupons.length === 0 ? (
        <EmptyState icon={Ticket} title="Henüz kupon yok" description="Sabit tutar, yüzde ya da ücretsiz ürün kuponu oluşturun." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Kod</TH>
              <TH>İndirim</TH>
              <TH>Koşullar</TH>
              <TH className="text-right">Kullanım</TH>
              <TH>Durum</TH>
              {canManage ? <TH>İşlem</TH> : null}
            </TR>
          </THead>
          <TBody>
            {coupons.map((c) => (
              <TR key={c.id} data-coupon={c.codeNormalized}>
                <TD label="Kod">
                  <Link href={`/panel/kampanyalar/kuponlar/${c.id}`} className="font-mono font-semibold text-fg underline-offset-4 hover:underline">
                    {c.code}
                  </Link>
                  <span className="block text-xs text-fg-subtle">{c.name}</span>
                </TD>
                <TD label="İndirim" className="whitespace-nowrap">
                  {c.type === "FIXED_AMOUNT" ? money(c.valueMinor ?? 0) : c.type === "PERCENTAGE" ? `${formatPercent(c.percentageBps ?? 0)}${c.maxDiscountMinor ? ` (en fazla ${money(c.maxDiscountMinor)})` : ""}` : `Ücretsiz: ${c.freeProduct?.name ?? "—"}`}
                </TD>
                <TD label="Koşullar" className="text-xs text-fg-muted">
                  {[c.minimumOrderMinor ? `En az ${money(c.minimumOrderMinor)}` : null, c.branch ? c.branch.name : "Tüm şubeler", AUDIENCE[c.audience], c.scope !== "ALL" ? (c.scope === "PRODUCTS" ? "Belirli ürünler" : "Belirli kategoriler") : null, c.endsAt ? `Bitiş ${formatDateTime(c.endsAt)}` : null].filter(Boolean).join(" · ")}
                </TD>
                <TD label="Kullanım" className="text-right tabular-nums">
                  {c.used}
                  {c.usageLimit ? ` / ${c.usageLimit}` : ""}
                  <span className="block text-xs text-fg-subtle">{money(c.discountTotalMinor)} indirim</span>
                </TD>
                <TD label="Durum">
                  <Badge tone={STATUS[c.status].tone} data-status={c.status}>
                    {STATUS[c.status].label}
                  </Badge>
                </TD>
                {canManage ? (
                  <TD label="İşlem">
                    {c.status === "ARCHIVED" ? null : (
                      <div className="flex flex-wrap gap-1.5">
                        {c.status === "ACTIVE" ? <StateButton action={couponStatusAction.bind(null, c.id, "INACTIVE")} label="Durdur" testId="coupon-deactivate" /> : <StateButton action={couponStatusAction.bind(null, c.id, "ACTIVE")} label="Etkinleştir" variant="primary" testId="coupon-activate" />}
                        <StateButton action={couponStatusAction.bind(null, c.id, "ARCHIVED")} label="Arşivle" variant="ghost" confirmText="Kupon arşivlensin mi? Geçmiş kullanım kayıtları korunur; kupon artık kullanılamaz." />
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

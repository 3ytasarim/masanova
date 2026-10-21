import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { saveCouponAction } from "@/server/actions/campaign.actions";
import { getCoupon } from "@/server/promotions/admin.service";
import { couponDefaults, EMPTY_COUPON, formOptions } from "@/server/promotions/form-options";
import { CouponForm } from "@/components/campaigns/campaign-forms";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Kupon" };

/** Kupon oluştur (/yeni) ya da düzenle — campaigns.manage; destek modunda erişilemez. */
export default async function CouponEditPage({ params }: { params: Promise<{ couponId: string }> }) {
  const ctx = await requireTenantUser({ permission: "campaigns.manage" });
  if (ctx.support) notFound();
  const { couponId } = await params;
  const opts = await formOptions(ctx.scope.tenantId);
  const isNew = couponId === "yeni";
  if (!isNew && !/^[a-z0-9]{1,40}$/i.test(couponId)) notFound();
  const coupon = isNew ? null : await getCoupon(ctx.scope, couponId);
  if (!isNew && (!coupon || coupon.status === "ARCHIVED")) notFound();
  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">{isNew ? "Yeni kupon" : `Kupon: ${coupon!.code}`}</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">Tutarlar ₺ (kuruşa çevrilir), yüzde baz puan olarak saklanır. Tarihler işletme saat dilimindedir ({opts.timeZone}).</p>
      </header>
      <Card className="max-w-4xl">
        <CardContent className="pt-6">
          <CouponForm action={saveCouponAction.bind(null, isNew ? null : coupon!.id)} defaults={coupon ? couponDefaults(coupon, opts.timeZone) : EMPTY_COUPON} products={opts.products} categories={opts.categories} branches={opts.branches} mode={isNew ? "create" : "edit"} />
        </CardContent>
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { saveRewardAction } from "@/server/actions/campaign.actions";
import { EMPTY_REWARD, formOptions, rewardDefaults } from "@/server/promotions/form-options";
import { RewardForm } from "@/components/campaigns/campaign-forms";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Sadakat ödülü" };

export default async function RewardEditPage({ params }: { params: Promise<{ rewardId: string }> }) {
  const ctx = await requireTenantUser({ permission: "campaigns.manage" });
  if (ctx.support) notFound();
  const { rewardId } = await params;
  const isNew = rewardId === "yeni";
  if (!isNew && !/^[a-z0-9]{1,40}$/i.test(rewardId)) notFound();
  const opts = await formOptions(ctx.scope.tenantId);
  const reward = isNew ? null : await prisma.loyaltyReward.findFirst({ where: { id: rewardId, tenantId: ctx.scope.tenantId, archivedAt: null } });
  if (!isNew && !reward) notFound();
  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">{isNew ? "Yeni sadakat ödülü" : `Ödül: ${reward!.name}`}</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">Yalnızca sadakat üyeleri yeterli puanla kullanabilir. Siparişte tek kupon ya da tek ödül.</p>
      </header>
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <RewardForm action={saveRewardAction.bind(null, isNew ? null : reward!.id)} defaults={reward ? rewardDefaults(reward, opts.timeZone) : EMPTY_REWARD} products={opts.products} mode={isNew ? "create" : "edit"} />
        </CardContent>
      </Card>
    </>
  );
}

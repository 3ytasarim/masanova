import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/permissions/roles";
import { CHANNEL_LABELS, SEGMENT_LABELS } from "@/lib/promotions/segments";
import { renderTemplate } from "@/lib/promotions/template";
import { campaignStatusAction, saveCampaignAction } from "@/server/actions/campaign.actions";
import { campaignAudience } from "@/server/promotions/admin.service";
import { CampaignForm, StateButton } from "@/components/campaigns/campaign-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "Kampanya" };

/**
 * Kampanya taslağı + kitle önizlemesi (yalnızca SAYILAR; iletişim listesi / dışa aktarma yok). Kitle her açılışta
 * GÜNCEL onaylardan hesaplanır → geri alınan izin hemen düşer. "Hazır" işareti gönderim DEĞİLDİR.
 */
export default async function CampaignPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const isNew = campaignId === "yeni";
  const ctx = await requireTenantUser({ permission: isNew ? "campaigns.manage" : "campaigns.view" });
  if (isNew && ctx.support) notFound();
  if (!isNew && !/^[a-z0-9]{1,40}$/i.test(campaignId)) notFound();
  const tenantId = ctx.scope.tenantId;
  const canManage = !ctx.support && hasPermission(ctx.user.role, "campaigns.manage");
  const [campaign, coupons, tenant] = await Promise.all([
    isNew ? null : prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, include: { coupon: { select: { code: true } } } }),
    prisma.coupon.findMany({ where: { tenantId, status: { not: "ARCHIVED" } }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);
  if (!isNew && !campaign) notFound();
  const audience = campaign ? await campaignAudience(tenantId, campaign.segment, campaign.channel) : null;
  const editable = canManage && campaign?.status !== "ARCHIVED";

  return (
    <>
      <header className="flex flex-col gap-3 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-title font-semibold text-fg">{campaign ? campaign.name : "Yeni kampanya"}</h1>
          {campaign ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.9375rem] text-fg-subtle">
              {CHANNEL_LABELS[campaign.channel]} · {SEGMENT_LABELS[campaign.segment]}
              <Badge tone={campaign.status === "READY" ? "info" : "neutral"} data-status={campaign.status}>
                {campaign.status === "READY" ? "Hazır (gönderilmedi)" : campaign.status === "DRAFT" ? "Taslak" : "Arşiv"}
              </Badge>
            </p>
          ) : null}
        </div>
        {campaign && editable ? (
          <div className="flex flex-wrap gap-2">
            {campaign.status === "DRAFT" ? <StateButton action={campaignStatusAction.bind(null, campaign.id, "READY")} label="Hazır olarak işaretle" variant="primary" testId="campaign-ready" /> : <StateButton action={campaignStatusAction.bind(null, campaign.id, "DRAFT")} label="Taslağa al" />}
            <StateButton action={campaignStatusAction.bind(null, campaign.id, "ARCHIVED")} label="Arşivle" variant="ghost" confirmText="Kampanya arşivlensin mi?" />
          </div>
        ) : null}
      </header>
      {ctx.support ? <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">Destek modu: salt okunur.</p> : null}

      {audience && campaign ? (
        <section aria-label="Kitle önizlemesi" className="mb-6" data-testid="audience-preview" data-eligible={audience.eligible} data-no-consent={audience.noConsent} data-missing-contact={audience.missingContact}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Uygun kitle" value={audience.eligible} hint={`${CHANNEL_LABELS[campaign.channel]} izni + iletişim var`} />
            <StatCard label="Segmentte" value={audience.inSegment} />
            <StatCard label="İzin yok (hariç)" value={audience.noConsent} hint="Hiç vermemiş ya da geri almış" />
            <StatCard label="İletişim eksik (hariç)" value={audience.missingContact} />
          </div>
          <p className="mt-2 text-xs text-fg-subtle">Sayılar her açılışta güncel onaylardan hesaplanır. Veri silme talebi olan {audience.deletionRequested} müşteri her zaman hariç. Mesaj gönderimi bu sürümde yoktur.</p>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Card>
          <CardHeader>
            <CardTitle>{isNew ? "Taslak" : "Taslağı düzenle"}</CardTitle>
            <CardDescription>Düzenleme kampanyayı taslağa geri alır. Kampanya hiçbir müşteriye izin VERMEZ.</CardDescription>
          </CardHeader>
          <CardContent>
            {isNew || editable ? (
              <CampaignForm
                action={saveCampaignAction.bind(null, campaign?.id ?? null)}
                coupons={coupons}
                mode={isNew ? "create" : "edit"}
                defaults={campaign ? { name: campaign.name, channel: campaign.channel, segment: campaign.segment, couponId: campaign.couponId ?? "", messageTemplate: campaign.messageTemplate } : { name: "", channel: "EMAIL", segment: "ALL_OPTED_IN", couponId: "", messageTemplate: "Merhaba {{firstName}}, {{restaurantName}} sizi bekliyor! Kupon kodunuz: {{couponCode}}" }}
              />
            ) : (
              <p className="whitespace-pre-line text-sm">{campaign?.messageTemplate}</p>
            )}
          </CardContent>
        </Card>
        {campaign ? (
          <Card>
            <CardHeader>
              <CardTitle>Önizleme (örnek)</CardTitle>
              <CardDescription>Örnek ad ile; gerçek kişi verisi kullanılmaz.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line break-words rounded-md bg-surface p-3 text-sm" data-testid="template-preview">
                {renderTemplate(campaign.messageTemplate, { firstName: "Ayşe", restaurantName: tenant?.name ?? "", couponCode: campaign.coupon?.code ?? "" })}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { Megaphone, Plus } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { CHANNEL_LABELS, SEGMENT_LABELS } from "@/lib/promotions/segments";
import { formatDateTime } from "@/lib/utils/format";
import { listCampaigns } from "@/server/promotions/admin.service";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Kampanyalar" };

const STATUS = { DRAFT: { label: "Taslak", tone: "neutral" }, READY: { label: "Hazır (gönderilmedi)", tone: "info" }, ARCHIVED: { label: "Arşiv", tone: "neutral" } } as const;

/**
 * Kampanya taslakları — GÖNDERİM YOK (SMS / e-posta / WhatsApp sağlayıcısı bağlı değil). "Hazır" yalnızca işarettir.
 * Kitle her zaman güncel pazarlama onayıyla hesaplanır; kampanya onay vermez.
 */
export default async function CampaignsPage() {
  const ctx = await requireTenantUser({ permission: "campaigns.view" });
  const canManage = !ctx.support && hasPermission(ctx.user.role, "campaigns.manage");
  const campaigns = await listCampaigns(ctx.scope);
  return (
    <>
      <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-title font-semibold text-fg">Kampanyalar</h1>
          <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Segment + kanal seçin; yalnızca o kanala güncel pazarlama izni veren müşteriler kitleye girer. Mesaj gönderimi henüz yok — taslak ve kitle önizlemesi.</p>
        </div>
        {canManage ? (
          <Link href="/panel/kampanyalar/yeni" className={buttonVariants({ variant: "primary" })} data-testid="campaign-new">
            <Plus aria-hidden="true" /> Yeni kampanya
          </Link>
        ) : null}
      </header>
      {ctx.support ? <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">Destek modu: salt okunur.</p> : null}
      {campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title="Henüz kampanya yok" description="Örn. “30 gündür gelmeyenlere %10 kupon” taslağı oluşturun." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Kampanya</TH>
              <TH>Kanal</TH>
              <TH>Segment</TH>
              <TH>Kupon</TH>
              <TH>Durum</TH>
              <TH>Güncelleme</TH>
            </TR>
          </THead>
          <TBody>
            {campaigns.map((c) => (
              <TR key={c.id} data-campaign={c.name}>
                <TD label="Kampanya">
                  <Link href={`/panel/kampanyalar/${c.id}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                    {c.name}
                  </Link>
                </TD>
                <TD label="Kanal">{CHANNEL_LABELS[c.channel]}</TD>
                <TD label="Segment" className="text-sm">
                  {SEGMENT_LABELS[c.segment]}
                </TD>
                <TD label="Kupon" className="font-mono text-sm">
                  {c.coupon?.code ?? "—"}
                </TD>
                <TD label="Durum">
                  <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                </TD>
                <TD label="Güncelleme" className="whitespace-nowrap">
                  {formatDateTime(c.updatedAt)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

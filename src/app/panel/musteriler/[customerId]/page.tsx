import type { Metadata } from "next";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { CONSENT_KINDS } from "@/lib/crm/consent";
import { CONSENT_SOURCE_LABELS, CONSENT_TYPE_LABELS, CUSTOMER_SOURCE_LABELS, LEDGER_TYPE_LABELS, MARKETING_STATE_LABELS, MARKETING_STATE_TONES } from "@/lib/crm/labels";
import { formatMoney } from "@/lib/menu/money";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES, formatOrderNumber } from "@/lib/orders/status";
import { hasPermission } from "@/lib/permissions/roles";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { prisma } from "@/lib/db/prisma";
import { adjustPointsAction, updateCustomerAction } from "@/server/actions/crm.actions";
import { getCustomerDetail } from "@/server/crm/crm-panel.service";
import { getLoyaltySettings } from "@/server/crm/loyalty.service";
import { customerPromotions } from "@/server/promotions/admin.service";
import { AdjustPointsForm, CustomerForm, RevokeConsentButton } from "@/components/crm/customer-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Müşteri" };

/**
 * Müşteri ayrıntısı — crm.view. Tam iletişim yalnızca yetkili sahip / müdüre ve destek modu DIŞINDA; destek modunda her
 * zaman maskeli ve salt okunur. Teknik kimlikler (iç id, oturum, doğrulama kayıtları) gösterilmez.
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ customerId: string }> }) {
  const ctx = await requireTenantUser({ permission: "crm.view" });
  const { customerId } = await params;
  if (!/^[a-z0-9]{1,40}$/i.test(customerId)) notFound();
  const support = !!ctx.support;
  const canManage = !support && hasPermission(ctx.user.role, "crm.manage");
  const canAdjust = !support && hasPermission(ctx.user.role, "loyalty.manage");
  const [c, settings, loyaltySettings] = await Promise.all([
    getCustomerDetail(ctx.scope, customerId, { reveal: !support }),
    prisma.tenantSettings.findUnique({ where: { tenantId: ctx.scope.tenantId }, select: { defaultCurrency: true } }),
    getLoyaltySettings(ctx.scope.tenantId),
  ]);
  const promotions = c ? await customerPromotions(ctx.scope, c.id) : [];
  if (!c) notFound();
  const currency = settings?.defaultCurrency ?? "TRY";
  const marketing = [
    { type: "MARKETING_SMS", label: "SMS" },
    { type: "MARKETING_WHATSAPP", label: "WhatsApp" },
    { type: "MARKETING_EMAIL", label: "E-posta" },
  ] as const;

  return (
    <>
      <Link href="/panel/musteriler" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" /> Müşteriler
      </Link>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg" data-testid="customer-name">
          {c.name}
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.9375rem] text-fg-subtle">
          {CUSTOMER_SOURCE_LABELS[c.source]} · Katılım {formatDateTime(c.createdAt)}
          {c.deletionRequestedAt ? <Badge tone="danger">Veri silme talebi: {formatDateTime(c.deletionRequestedAt)}</Badge> : null}
        </p>
      </header>

      {support ? (
        <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">
          Destek modu: salt okunur, iletişim bilgileri maskelidir.
        </p>
      ) : null}
      {c.deletionRequestedAt ? (
        <p role="note" className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-fg">
          Müşteri verilerinin silinmesini talep etti: tüm izinleri geri alındı ve oturumları kapatıldı. Sipariş geçmişi muhasebe kaydı olarak korunur; anonimleştirme iş akışı henüz yok.
        </p>
      ) : null}

      <section aria-label="Özet" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sipariş" value={formatNumber(c.orders.length)} hint={c.orders.length >= 50 ? "Son 50 gösteriliyor" : undefined} />
        <StatCard label="Servis edilen" value={formatNumber(c.servedCount)} />
        <StatCard label="Toplam Sipariş Tutarı" value={formatMoney(c.servedTotalMinor, currency)} hint="Servis edilen siparişler" />
        <StatCard label="Puan bakiyesi" value={c.loyalty ? formatNumber(c.loyalty.balance) : "—"} hint={c.loyalty ? (c.loyalty.active ? "Sadakat üyesi" : "Üyelikten ayrıldı") : "Üye değil"} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
            <CardDescription>Müşterinin paylaştığı bilgiler.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-[0.9375rem]">
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">Telefon</dt>
                <dd className="flex flex-wrap items-center gap-2 tabular-nums" data-testid="customer-phone">
                  {c.phone ?? "—"} {c.phone ? <Verification ok={c.phoneVerified} /> : null}
                </dd>
              </div>
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">E-posta</dt>
                <dd className="flex flex-wrap items-center gap-2 break-all" data-testid="customer-email">
                  {c.email ?? "—"} {c.email ? <Verification ok={c.emailVerified} /> : null}
                </dd>
              </div>
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">Son ziyaret</dt>
                <dd>{c.lastSeenAt ? formatDateTime(c.lastSeenAt) : "—"}</dd>
              </div>
              {c.staffNote && !canManage ? (
                <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-fg-subtle">Personel notu</dt>
                  <dd className="whitespace-pre-line break-words">{c.staffNote}</dd>
                </div>
              ) : null}
            </dl>
            {canManage ? (
              <div className="mt-6 border-t border-border pt-6">
                <CustomerForm
                  mode="edit"
                  action={updateCustomerAction.bind(null, c.id)}
                  defaults={{ firstName: c.firstName ?? "", lastName: c.lastName ?? "", phone: c.phone ?? "", email: c.email ?? "", staffNote: c.staffNote ?? "" }}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>İzinler</CardTitle>
            <CardDescription>Her değişiklik ayrı kayıt olarak saklanır (sürümlü). Personel izin veremez; yalnızca müşterinin talebiyle geri alabilir.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2" data-testid="consent-summary">
              {CONSENT_KINDS.map((type) => {
                const state = c.consents[type].state;
                const marketingType = marketing.find((m) => m.type === type);
                return (
                  <li key={type} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2" data-consent-type={type} data-consent-state={state}>
                    <span className="text-[0.9375rem] font-medium text-fg">{CONSENT_TYPE_LABELS[type]}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={MARKETING_STATE_TONES[state]}>{MARKETING_STATE_LABELS[state]}</Badge>
                      {canManage && marketingType && state === "GRANTED" ? <RevokeConsentButton customerId={c.id} type={marketingType.type} label={marketingType.label} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-fg-muted">İzin geçmişi ({c.consentHistory.length})</summary>
              <ol className="mt-3 grid gap-1.5 text-sm" data-testid="consent-history">
                {c.consentHistory.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2 text-fg-muted">
                    <span className="tabular-nums">{formatDateTime(h.createdAt)}</span>
                    <span className="font-medium text-fg">{CONSENT_TYPE_LABELS[h.type]}</span>
                    <span>{h.status === "GRANTED" ? "verildi" : "geri alındı"}</span>
                    <span>· {CONSENT_SOURCE_LABELS[h.source]}</span>
                    <span>· metin {h.version}</span>
                  </li>
                ))}
              </ol>
            </details>
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="orders-h" className="mt-8">
        <h2 id="orders-h" className="mb-3 text-lg font-semibold text-fg">
          Sipariş geçmişi
        </h2>
        {c.orders.length === 0 ? (
          <p className="text-sm text-fg-subtle">Bu müşteriyle ilişkilendirilmiş sipariş yok. Katılmadan önceki anonim siparişler ilişkilendirilmez.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Sipariş</TH>
                <TH>Masa</TH>
                <TH className="text-right">Toplam</TH>
                <TH>Durum</TH>
                <TH className="text-right">Puan</TH>
                <TH>Zaman</TH>
              </TR>
            </THead>
            <TBody>
              {c.orders.map((o) => (
                <TR key={o.id} data-order-number={o.orderNumber}>
                  <TD label="Sipariş">
                    <Link href={`/panel/siparisler/${o.id}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                      {formatOrderNumber(o.orderNumber)}
                    </Link>
                  </TD>
                  <TD label="Masa">
                    {o.tableName} <span className="text-xs text-fg-subtle">· {o.branchName}</span>
                  </TD>
                  <TD label="Toplam" className="text-right tabular-nums">
                    {formatMoney(o.totalMinor, o.currency)}
                  </TD>
                  <TD label="Durum">
                    <Badge tone={ORDER_STATUS_TONES[o.status]} dot>
                      {ORDER_STATUS_LABELS[o.status]}
                    </Badge>
                  </TD>
                  <TD label="Puan" className="text-right tabular-nums">
                    {o.earned !== null ? `+${o.earned}` : "—"}
                  </TD>
                  <TD label="Zaman" className="whitespace-nowrap">
                    {formatDateTime(o.createdAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="promos-h" className="mt-8">
        <h2 id="promos-h" className="mb-3 text-lg font-semibold text-fg">
          Kullanılan kupon / ödüller
        </h2>
        {promotions.length === 0 ? (
          <p className="text-sm text-fg-subtle">Bu müşterinin siparişlerinde promosyon kullanılmamış.</p>
        ) : (
          <ul className="grid gap-2 text-sm" data-testid="customer-promotions">
            {promotions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span>
                  <span className="font-medium">{p.kind === "COUPON" ? `Kupon ${p.codeSnapshot ?? ""}` : "Sadakat ödülü"}</span> · {p.label}
                  <span className="text-fg-subtle"> · Sipariş {formatOrderNumber(p.order.orderNumber)}{p.order.status === "REJECTED" || p.order.status === "CANCELLED" ? " (iptal / ret)" : ""}</span>
                </span>
                <span className="tabular-nums">
                  −{formatMoney(p.discountMinor, p.order.currency)}
                  {p.pointsSpent ? ` · ${p.pointsSpent} puan` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="loyalty-h" className="mt-8">
        <h2 id="loyalty-h" className="mb-3 text-lg font-semibold text-fg">
          Sadakat defteri
        </h2>
        {!c.loyalty ? (
          <p className="text-sm text-fg-subtle">Müşteri sadakat programına katılmamış.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-fg-muted" data-testid="loyalty-summary" data-balance={c.loyalty.balance}>
              Bakiye <strong className="tabular-nums text-fg">{formatNumber(c.loyalty.balance)}</strong> · Toplam kazanılan {formatNumber(c.loyalty.totalEarned)} · Son hareket {c.loyalty.lastActivity ? formatDateTime(c.loyalty.lastActivity) : "—"}
              {!loyaltySettings.enabled ? " · Sadakat programı şu an kapalı" : ""}
            </p>
            {c.loyalty.entries.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Tür</TH>
                    <TH className="text-right">Puan</TH>
                    <TH>Açıklama</TH>
                    <TH>Zaman</TH>
                  </TR>
                </THead>
                <TBody>
                  {c.loyalty.entries.map((e) => (
                    <TR key={e.id} data-ledger-type={e.type}>
                      <TD label="Tür">{LEDGER_TYPE_LABELS[e.type]}</TD>
                      <TD label="Puan" className="text-right tabular-nums font-medium">
                        {e.points > 0 ? `+${e.points}` : e.points}
                      </TD>
                      <TD label="Açıklama">{e.order ? `Sipariş ${formatOrderNumber(e.order.orderNumber)}` : (e.reason ?? "—")}</TD>
                      <TD label="Zaman" className="whitespace-nowrap">
                        {formatDateTime(e.createdAt)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-sm text-fg-subtle">Henüz puan hareketi yok.</p>
            )}
            {canAdjust ? (
              <div className="mt-4 max-w-2xl rounded-lg border border-border p-4">
                <h3 className="mb-3 text-sm font-semibold text-fg">Manuel düzeltme</h3>
                <AdjustPointsForm action={adjustPointsAction.bind(null, c.id)} />
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function Verification({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge tone="success">
      <BadgeCheck aria-hidden="true" className="size-3.5" /> Doğrulandı
    </Badge>
  ) : (
    <Badge tone="neutral">Doğrulanmamış</Badge>
  );
}

import type { Metadata } from "next";
import { Gift, Repeat, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { CUSTOMER_SOURCE_LABELS, LOYALTY_STATUS_LABELS, LOYALTY_STATUS_TONES, MARKETING_STATE_LABELS, MARKETING_STATE_TONES } from "@/lib/crm/labels";
import { REPEAT_CUSTOMER_MIN_SERVED } from "@/lib/crm/loyalty";
import { formatMoney } from "@/lib/menu/money";
import { hasPermission } from "@/lib/permissions/roles";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import { pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { prisma } from "@/lib/db/prisma";
import { CUSTOMER_PAGE_SIZE, crmMetrics, listCustomers } from "@/server/crm/crm-panel.service";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Müşteriler" };

/**
 * CRM listesi — yalnızca crm.view (sahip / şube müdürü; destek modu salt okunur). İletişim bilgileri listede HER ZAMAN
 * maskeli. Müşteriler yalnızca kendi isteğiyle katılır (ya da personel elle ekler); anonim siparişler burada yoktur.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireTenantUser({ permission: "crm.view" });
  const params = await searchParams;
  const q = param(params, "q", 80) ?? "";
  const page = pageParam(params);
  const canManage = !ctx.support && hasPermission(ctx.user.role, "crm.manage");

  const [metrics, list, settings] = await Promise.all([
    crmMetrics(ctx.scope),
    listCustomers(ctx.scope, { q, page }),
    prisma.tenantSettings.findUnique({ where: { tenantId: ctx.scope.tenantId }, select: { defaultCurrency: true } }),
  ]);
  const currency = settings?.defaultCurrency ?? "TRY";
  const share = metrics.orders30d ? Math.round((metrics.identifiedOrders30d / metrics.orders30d) * 100) : 0;

  return (
    <>
      <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-title font-semibold text-fg">Müşteriler</h1>
          <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">
            Kendi isteğiyle bilgilerini paylaşan müşteriler. Sipariş vermek için kimlik gerekmez; anonim siparişler burada görünmez.
          </p>
        </div>
        {canManage ? (
          <Link href="/panel/musteriler/yeni" className={buttonVariants({ variant: "secondary" })}>
            <UserPlus aria-hidden="true" /> Müşteri ekle
          </Link>
        ) : null}
      </header>

      {ctx.support ? (
        <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">
          Destek modu: salt okunur, iletişim bilgileri maskelidir.
        </p>
      ) : null}

      <section aria-label="Müşteri özetleri" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Kayıtlı müşteri" value={formatNumber(metrics.identified)} icon={Users} hint="Bilgilerini paylaşan" />
        <StatCard label="Tekrar gelen" value={formatNumber(metrics.repeat)} icon={Repeat} hint={`En az ${REPEAT_CUSTOMER_MIN_SERVED} servis edilmiş sipariş`} />
        <StatCard
          label="Kayıtlı müşteri siparişi"
          value={formatNumber(metrics.identifiedOrders30d)}
          hint={metrics.orders30d ? `Son 30 gün · tüm siparişlerin %${share}'i (${formatNumber(metrics.orders30d)})` : "Son 30 gün"}
        />
        <StatCard label="Sadakat üyesi" value={formatNumber(metrics.loyaltyMembers)} icon={Gift} hint="Aktif üyelik" />
      </section>

      <FilterBar action="/panel/musteriler" query={q} searchPlaceholder="Ad, telefon ya da e-posta" searchLabel="Müşteri ara" hasFilters={!!q} />

      {list.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={q ? "Sonuç yok" : "Henüz müşteri yok"}
          description={q ? "Farklı bir ad, telefon ya da e-posta deneyin." : "Müşteriler sipariş sonrasında “Bilgilerimi ekle” ile katıldığında burada görünür."}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Müşteri</TH>
                <TH>İletişim</TH>
                <TH>Son ziyaret</TH>
                <TH className="text-right">Sipariş</TH>
                <TH className="text-right">Toplam Sipariş Tutarı</TH>
                <TH>Sadakat</TH>
                <TH>Pazarlama</TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((c) => (
                <TR key={c.id} data-customer-row>
                  <TD label="Müşteri">
                    <Link href={`/panel/musteriler/${c.id}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                    <span className="block text-xs text-fg-subtle">{CUSTOMER_SOURCE_LABELS[c.source]}</span>
                    {c.deletionRequested ? (
                      <Badge tone="danger" className="mt-1">
                        Silme talebi
                      </Badge>
                    ) : null}
                  </TD>
                  <TD label="İletişim" className="tabular-nums">
                    <span className="block">{c.phone ?? "—"}</span>
                    {c.email ? <span className="block break-all text-xs text-fg-subtle">{c.email}</span> : null}
                    {!c.verified && (c.phone || c.email) ? <span className="block text-xs text-fg-subtle">Doğrulanmamış</span> : null}
                  </TD>
                  <TD label="Son ziyaret" className="whitespace-nowrap">
                    {c.lastVisit ? formatDateTime(c.lastVisit) : "—"}
                  </TD>
                  <TD label="Sipariş" className="text-right tabular-nums">
                    {c.orderCount}
                  </TD>
                  <TD label="Toplam Sipariş Tutarı" className="text-right tabular-nums font-medium text-fg">
                    {formatMoney(c.servedTotalMinor, currency)}
                  </TD>
                  <TD label="Sadakat">
                    <Badge tone={LOYALTY_STATUS_TONES[c.loyalty]}>{LOYALTY_STATUS_LABELS[c.loyalty]}</Badge>
                  </TD>
                  <TD label="Pazarlama">
                    <ul className="flex flex-wrap gap-1 text-xs">
                      {(
                        [
                          ["SMS", c.marketing.sms],
                          ["WhatsApp", c.marketing.whatsapp],
                          ["E-posta", c.marketing.email],
                        ] as const
                      ).map(([label, state]) => (
                        <li key={label}>
                          <Badge tone={MARKETING_STATE_TONES[state]} title={`${label}: ${MARKETING_STATE_LABELS[state]}`}>
                            {label}: {MARKETING_STATE_LABELS[state]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination basePath="/panel/musteriler" query={{ q: q || undefined }} page={page} pageSize={CUSTOMER_PAGE_SIZE} total={list.total} />
        </>
      )}
      <p className="mt-6 text-xs text-fg-subtle">“Toplam Sipariş Tutarı” müşterinin servis edilmiş siparişlerinin toplamıdır; ödeme ya da kâr bilgisi değildir.</p>
    </>
  );
}

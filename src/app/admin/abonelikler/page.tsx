import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import Link from "next/link";
import { PLANS, PLAN_ORDER } from "@/config/plans";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { resolveBilling, type EffectiveState } from "@/lib/billing/engine";
import { EFFECTIVE_STATE_LABELS, EFFECTIVE_STATE_TONES } from "@/lib/billing/labels";
import { prisma } from "@/lib/db/prisma";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { enumParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { TenantStatusBadge } from "@/components/dashboard/tenant-status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Abonelikler" };

const STATES = Object.keys(EFFECTIVE_STATE_LABELS) as EffectiveState[];

/**
 * Super Admin — tüm kiracıların aboneliği. Etkin durum kayıttan DEĞİL motordan (zaman damgaları) türetilir.
 * Platform metrikleri yalnızca SAYIDIR: fiyat tanımlı olmadığı için MRR / ARR / gelir HESAPLANMAZ.
 */
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireSuperAdmin();
  const params = await searchParams;
  const plan = enumParam(params, "paket", PLAN_ORDER);
  const state = enumParam(params, "durum", STATES);
  const q = param(params, "q", 60)?.toLocaleLowerCase("tr-TR");
  const now = new Date();
  const tenants = await prisma.tenant.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      subscription: { select: { plan: true, status: true, internal: true, currentPeriodStart: true, currentPeriodEnd: true, trialEndsAt: true, graceEndsAt: true, cancelAtPeriodEnd: true } },
      entitlementOverrides: { select: { key: true, enabled: true, limitValue: true, expiresAt: true } },
    },
  });
  const rows = tenants.map((t) => {
    const r = resolveBilling(t.subscription, t.entitlementOverrides.map((o) => ({ ...o, limitValue: o.limitValue === null ? null : Number(o.limitValue) })), now);
    return { ...t, r };
  });
  const count = (fn: (x: (typeof rows)[number]) => boolean) => rows.filter(fn).length;
  const shown = rows.filter((x) => (!plan || x.r.subscribedPlan === plan) && (!state || x.r.state === state) && (!q || x.name.toLocaleLowerCase("tr-TR").includes(q) || x.slug.includes(q)));

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Abonelikler</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Manuel faturalama. Paket, deneme, dönem ve durum işletme ayrıntısındaki “Abonelik & Plan” sekmesinden yönetilir. Fiyat tanımlı olmadığından gelir metriği gösterilmez.</p>
      </header>

      <section aria-label="Platform özeti" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="subscription-metrics">
        {PLAN_ORDER.map((p) => (
          <StatCard key={p} label={`${PLANS[p].label} paketi`} value={formatNumber(count((x) => x.r.subscribedPlan === p))} icon={CreditCard} />
        ))}
        <StatCard label="Deneme" value={formatNumber(count((x) => x.r.state === "TRIALING"))} />
        <StatCard label="Aktif" value={formatNumber(count((x) => x.r.state === "ACTIVE"))} />
        <StatCard label="Ek süre" value={formatNumber(count((x) => x.r.state === "GRACE"))} />
        <StatCard label="Süresi dolan / askıda" value={formatNumber(count((x) => x.r.state === "EXPIRED" || x.r.state === "TRIAL_EXPIRED" || x.r.state === "SUSPENDED"))} />
      </section>

      <FilterBar action="/admin/abonelikler" query={q} searchPlaceholder="İşletme adı ya da kısa ad" searchLabel="İşletme ara" hasFilters={!!(plan || state || q)}>
        <FilterSelect id="s-paket" name="paket" label="Paket" value={plan} options={[{ value: "", label: "Tümü" }, ...PLAN_ORDER.map((p) => ({ value: p, label: PLANS[p].label }))]} />
        <FilterSelect id="s-durum" name="durum" label="Durum" value={state} options={[{ value: "", label: "Tümü" }, ...STATES.map((s) => ({ value: s, label: EFFECTIVE_STATE_LABELS[s] }))]} />
      </FilterBar>

      {shown.length === 0 ? (
        <EmptyState icon={CreditCard} title="Sonuç yok" description="Filtreleri değiştirin." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>İşletme</TH>
              <TH>Paket</TH>
              <TH>Abonelik</TH>
              <TH>Bitiş</TH>
              <TH>İşletme durumu</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((x) => (
              <TR key={x.id} data-testid="subscription-row" data-slug={x.slug} data-plan={x.r.subscribedPlan} data-state={x.r.state}>
                <TD label="İşletme">
                  <Link href={`/admin/isletmeler/${x.id}/plan`} className="font-semibold text-fg underline-offset-4 hover:underline">
                    {x.name}
                  </Link>
                  {x.subscription?.internal ? <span className="block text-xs text-fg-subtle">Faturasız (iç)</span> : null}
                </TD>
                <TD label="Paket">
                  <Badge>{PLANS[x.r.subscribedPlan].label}</Badge>
                  {x.r.effectivePlan !== x.r.subscribedPlan ? <span className="block text-xs text-fg-subtle">geçerli: {PLANS[x.r.effectivePlan].label}</span> : null}
                </TD>
                <TD label="Abonelik">
                  <Badge tone={EFFECTIVE_STATE_TONES[x.r.state]} dot>
                    {EFFECTIVE_STATE_LABELS[x.r.state]}
                  </Badge>
                  {x.r.cancelScheduled ? <span className="block text-xs text-fg-subtle">dönem sonunda iptal</span> : null}
                </TD>
                <TD label="Bitiş" className="whitespace-nowrap">
                  {x.r.endsAt ? formatDate(x.r.endsAt) : "—"}
                </TD>
                <TD label="İşletme durumu">
                  <TenantStatusBadge status={x.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}

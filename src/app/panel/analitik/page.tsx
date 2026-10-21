import type { Metadata } from "next";
import { reservationMetrics } from "@/server/reservations/queries.service";
import { ReservationsAnalytics } from "@/components/analytics/reservations-section";
import { PromotionsAnalytics } from "@/components/analytics/promotions-section";
import { promotionMetrics } from "@/server/promotions/admin.service";
import { PaymentsAnalytics } from "@/components/analytics/payments-section";
import { paymentMetrics } from "@/server/analytics/payments.analytics";
import type React from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { analyticsLabels, filterLabels } from "@/lib/analytics/labels";
import { isRangeKey, rangeLabel } from "@/lib/analytics/range";
import { formatLocalDate, localParts } from "@/lib/analytics/time";
import { hasPermission } from "@/lib/permissions/roles";
import { getRequestId } from "@/lib/security/request-meta";
import { cn } from "@/lib/utils/cn";
import { ANALYTICS_SECTIONS, loadSection, type AnalyticsSection } from "@/server/analytics/dashboard.service";
import { analyticsNow, resolveAnalyticsContext } from "@/server/analytics/filter";
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { AiSection, OperationsSection, OverviewSection, ProductsSection, ServiceSection, TablesSection } from "@/components/analytics/sections";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Analitik" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * İşletme analitiği — analytics.view (sahip / şube müdürü; destek modunda salt okunur görüntüleme). Kiracı oturumdan;
 * yalnızca seçili sekmenin sorguları çalışır. Hesaplar sunucuda (SQL), tarayıcıya yalnızca açık DTO gider.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, scope, support } = await requireTenantUser({ permission: "analytics.view" });
  const sp = await searchParams;
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: scope.tenantId }, select: { defaultLocale: true } });
  const L = analyticsLabels(settings?.defaultLocale);
  const tabParam = one(sp.sekme);
  const tab: AnalyticsSection = (ANALYTICS_SECTIONS as readonly string[]).includes(tabParam ?? "") ? (tabParam as AnalyticsSection) : "overview";
  const rangeParam = one(sp.aralik);
  const resolved = await resolveAnalyticsContext(scope, { range: rangeParam, from: one(sp.bas), to: one(sp.bit), branch: one(sp.sube) }, analyticsNow());
  const canExport = !support && hasPermission(user.role, "analytics.export");

  const branches = resolved.ok ? resolved.context.branches : resolved.branches;
  const filterBar = (
    <AnalyticsFilterBar
      labels={filterLabels(L)}
      range={isRangeKey(rangeParam) ? rangeParam : "today"}
      from={one(sp.bas) ?? (resolved.ok ? formatLocalDate(resolved.context.range.fromDate) : "")}
      to={one(sp.bit) ?? (resolved.ok ? formatLocalDate(resolved.context.range.toDate) : "")}
      branch={one(sp.sube) ?? ""}
      branches={branches}
      tab={tab}
    />
  );

  if (!resolved.ok) {
    return (
      <>
        <PageHeader title={L.title} description={L.description} />
        <div className="grid gap-6">
          {filterBar}
          <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger" data-testid="analytics-range-error">
            {L.rangeErrors[resolved.error]}
          </p>
        </div>
      </>
    );
  }

  const ctx = resolved.context;
  const query = new URLSearchParams();
  query.set("aralik", ctx.range.key);
  if (ctx.range.key === "custom") {
    query.set("bas", formatLocalDate(ctx.range.fromDate));
    query.set("bit", formatLocalDate(ctx.range.toDate));
  }
  if (ctx.filter.branchId) query.set("sube", ctx.filter.branchId);
  const href = (section: AnalyticsSection) => {
    const q = new URLSearchParams(query);
    if (section !== "overview") q.set("sekme", section);
    return `/panel/analitik?${q.toString()}`;
  };
  const exportHref = (kind: string) => {
    const q = new URLSearchParams(query);
    q.set("tur", kind);
    return `/panel/analitik/disa-aktar?${q.toString()}`;
  };

  const common = { labels: L, currency: ctx.filter.currency, granularity: ctx.range.granularity };
  const opts = { requestId: await getRequestId() };
  // Her sekme yalnızca kendi bölümünü yükler (tipli; diğer sekmelerin sorguları çalışmaz).
  const view = await (async (): Promise<{ ok: boolean; cachedAt: number | null; node: React.ReactNode }> => {
    switch (tab) {
      case "overview": {
        const r = await loadSection(ctx, "overview", opts);
        const range = { from: ctx.range.start, to: ctx.range.end, branchId: ctx.filter.branchId };
        const [promotions, payments] = await Promise.all([promotionMetrics(scope, range), paymentMetrics(scope, range)]);
        return r.ok
          ? {
              ok: true,
              cachedAt: r.cachedAt,
              node: (
                <div className="grid gap-8">
                  <OverviewSection {...common} data={r.data} />
                  <PromotionsAnalytics data={promotions} currency={ctx.filter.currency} />
                  <PaymentsAnalytics data={payments} currency={ctx.filter.currency} />
                </div>
              ),
            }
          : { ok: false, cachedAt: null, node: null };
      }
      case "products": {
        const r = await loadSection(ctx, "products", opts);
        return r.ok ? { ok: true, cachedAt: r.cachedAt, node: <ProductsSection {...common} data={r.data} /> } : { ok: false, cachedAt: null, node: null };
      }
      case "tables": {
        const r = await loadSection(ctx, "tables", opts);
        const reservations = await reservationMetrics(scope, { from: ctx.range.start, to: ctx.range.end, branchId: ctx.filter.branchId, timeZone: ctx.filter.timeZone });
        return r.ok
          ? {
              ok: true,
              cachedAt: r.cachedAt,
              node: (
                <div className="grid gap-8">
                  <TablesSection {...common} data={r.data} />
                  <ReservationsAnalytics data={reservations} />
                </div>
              ),
            }
          : { ok: false, cachedAt: null, node: null };
      }
      case "operations": {
        const r = await loadSection(ctx, "operations", opts);
        return r.ok ? { ok: true, cachedAt: r.cachedAt, node: <OperationsSection {...common} data={r.data} /> } : { ok: false, cachedAt: null, node: null };
      }
      case "service": {
        const r = await loadSection(ctx, "service", opts);
        return r.ok ? { ok: true, cachedAt: r.cachedAt, node: <ServiceSection {...common} data={r.data} /> } : { ok: false, cachedAt: null, node: null };
      }
      case "ai": {
        const r = await loadSection(ctx, "ai", opts);
        return r.ok ? { ok: true, cachedAt: r.cachedAt, node: <AiSection {...common} data={r.data} /> } : { ok: false, cachedAt: null, node: null };
      }
    }
  })();
  const updated = view.cachedAt !== null ? localParts(ctx.filter.timeZone, view.cachedAt) : null;

  return (
    <>
      <PageHeader
        title={L.title}
        description={`${L.description} ${rangeLabel(ctx.range)}${ctx.branchName ? ` · ${ctx.branchName}` : ""} · ${L.comparedTo}: ${rangeLabel(ctx.range.previous)}`}
      />
      <div className="grid min-w-0 gap-6" data-testid="analytics-page" data-range={ctx.range.key} data-tab={tab}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          {filterBar}
          {updated ? (
            <p className="text-[0.8125rem] text-fg-subtle" data-testid="analytics-updated">
              {`${L.lastUpdated}: ${String(updated.h).padStart(2, "0")}:${String(updated.min).padStart(2, "0")} (${ctx.filter.timeZone})`}
            </p>
          ) : null}
        </div>

        <nav aria-label={L.title} className="-mx-1 overflow-x-auto">
          <ul className="flex min-w-max gap-1 border-b border-border px-1">
            {ANALYTICS_SECTIONS.map((s) => (
              <li key={s}>
                <Link
                  href={href(s)}
                  aria-current={s === tab ? "page" : undefined}
                  data-testid={`analytics-tab-${s}`}
                  className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium", s === tab ? "border-accent text-fg" : "border-transparent text-fg-subtle hover:text-fg")}
                >
                  {L.tabs[s]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {view.ok ? (
          view.node
        ) : (
          <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger" data-testid="analytics-load-error">
            {L.loadError}
          </p>
        )}

        {canExport ? (
          <section className="rounded-lg border border-border bg-bg p-5" data-testid="analytics-exports">
            <h2 className="text-base font-semibold text-fg">{L.exports.title}</h2>
            <p className="mt-1 text-[0.8125rem] text-fg-subtle">{L.exports.note}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["orders", "products", "service", "kds"] as const).map((kind) => (
                <a key={kind} href={exportHref(kind)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-fg hover:bg-surface" data-testid={`export-${kind}`}>
                  <Download aria-hidden="true" className="size-4" />
                  {L.exports[kind]}
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

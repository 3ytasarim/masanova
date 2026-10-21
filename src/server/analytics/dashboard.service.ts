import "server-only";
import { averageMinor, bucketKeys, classifyQuadrants, compare, fillBuckets, MIN_COUNT_BASELINE, MIN_ORDERS_FOR_HEATMAP, ratio, type Comparison, type QuadrantKey } from "@/lib/analytics/metrics";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { aiAnalytics, type AiAnalytics } from "@/server/analytics/ai.analytics";
import { analyticsCacheKey, cached } from "@/server/analytics/cache";
import type { AnalyticsContext, AnalyticsFilter } from "@/server/analytics/filter";
import { orderTimings, stationPerformance, type DurationStats, type OrderTimings, type StationRow } from "@/server/analytics/kds.analytics";
import { categoryPerformance, modifierPerformance, productPerformance, variantPerformance, type CategoryRow, type ModifierRow, type ProductRow, type VariantRow } from "@/server/analytics/menu.analytics";
import { orderFunnel, orderHeatmap, orderKpis, orderTrend, type HeatCell, type OrderFunnel, type OrderKpis, type TrendRow } from "@/server/analytics/orders.analytics";
import { serviceByArea, serviceByHour, serviceByTable, serviceSummary, type ServiceSummary } from "@/server/analytics/service.analytics";
import { areaPerformance, tablePerformance, type AreaRow, type TableRow } from "@/server/analytics/tables.analytics";

/**
 * Panel analitiği — bölüm başına AÇIK DTO (Prisma modeli tarayıcıya serileştirilmez). Her bölüm yalnızca kendi
 * sorgularını çalıştırır (sekme açılmadan diğer bölümler hesaplanmaz), kısa süre önbelleklenir ve ölçülür
 * (süre, önbellek isabeti, hata; yavaş sorgu uyarısı). Hata panel kabuğunu bozmaz: bölüm "yüklenemiyor" döner.
 */
export const ANALYTICS_SECTIONS = ["overview", "products", "tables", "operations", "service", "ai"] as const;
export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];

export const SLOW_QUERY_MS = 1500;

export type OverviewData = {
  kpis: OrderKpis;
  previous: OrderKpis;
  comparisons: { sales: Comparison; orders: Comparison; average: Comparison; items: Comparison; tables: Comparison };
  averageMinor: number | null;
  previousAverageMinor: number | null;
  preparation: DurationStats;
  serviceResponse: DurationStats;
  funnel: OrderFunnel;
  acceptanceRate: number | null;
  rejectionRate: number | null;
  trend: TrendRow[];
  /** null → veri ısı haritası için yetersiz (boş durum gösterilir). */
  heatmap: HeatCell[] | null;
};

export type ProductsData = {
  products: ProductRow[];
  totalQuantity: number;
  variants: { productKey: string; productName: string; variants: VariantRow[] }[];
  modifiers: ModifierRow[];
  categories: CategoryRow[];
  quadrants: Record<QuadrantKey, ProductRow[]> | null;
};

export type TablesData = { tables: TableRow[]; areas: AreaRow[] };
export type OperationsData = { timings: OrderTimings; stations: StationRow[] };
export type ServiceData = { summary: ServiceSummary; byHour: { hour: number; count: number }[]; byArea: { area: string | null; count: number }[]; byTable: { tableId: string; tableName: string; count: number }[] };
export type AiData = AiAnalytics & { fallbackRate: number | null };

export type SectionData = {
  overview: OverviewData;
  products: ProductsData;
  tables: TablesData;
  operations: OperationsData;
  service: ServiceData;
  ai: AiData;
};

export type SectionResult<S extends AnalyticsSection> = { ok: true; data: SectionData[S]; cachedAt: number } | { ok: false };

const loaders: { [S in AnalyticsSection]: (ctx: AnalyticsContext) => Promise<SectionData[S]> } = {
  async overview(ctx) {
    const f = ctx.filter;
    const [kpis, previous, funnel, timings, service, trendRows, heat] = await Promise.all([
      orderKpis(f),
      orderKpis(ctx.previousFilter),
      orderFunnel(f),
      orderTimings(f),
      serviceSummary(f),
      orderTrend(f, ctx.range.granularity),
      orderHeatmap(f),
    ]);
    const avg = averageMinor(kpis.salesMinor, kpis.salesOrders);
    const prevAvg = averageMinor(previous.salesMinor, previous.salesOrders);
    const keys = bucketKeys(f.timeZone, ctx.range.start, ctx.range.end, ctx.range.granularity);
    const decided = funnel.accepted + funnel.rejected;
    const heatOrders = heat.reduce((s, c) => s + c.orders, 0);
    return {
      kpis,
      previous,
      comparisons: {
        sales: compare(kpis.salesMinor, previous.salesMinor, { minBaseline: 1 }),
        orders: compare(kpis.salesOrders, previous.salesOrders, { minBaseline: MIN_COUNT_BASELINE }),
        average: compare(avg ?? 0, prevAvg ?? 0, { minBaseline: previous.salesOrders >= MIN_COUNT_BASELINE ? 1 : Number.MAX_SAFE_INTEGER }),
        items: compare(kpis.itemsSold, previous.itemsSold, { minBaseline: MIN_COUNT_BASELINE }),
        tables: compare(kpis.activeTables, previous.activeTables, { minBaseline: MIN_COUNT_BASELINE }),
      },
      averageMinor: avg,
      previousAverageMinor: prevAvg,
      preparation: timings.preparation,
      serviceResponse: service.response,
      funnel,
      acceptanceRate: ratio(funnel.accepted, decided),
      rejectionRate: ratio(funnel.rejected, decided),
      trend: fillBuckets(keys, trendRows, (key) => ({ key, orders: 0, salesMinor: 0 })),
      heatmap: heatOrders >= MIN_ORDERS_FOR_HEATMAP ? heat : null,
    };
  },
  async products(ctx) {
    const f = ctx.filter;
    const [products, variants, modifiers, categories] = await Promise.all([productPerformance(f), variantPerformance(f), modifierPerformance(f), categoryPerformance(f)]);
    const grouped = new Map<string, { productKey: string; productName: string; variants: VariantRow[] }>();
    for (const v of variants) {
      const g = grouped.get(v.productKey) ?? { productKey: v.productKey, productName: v.productName, variants: [] };
      g.variants.push(v);
      grouped.set(v.productKey, g);
    }
    return {
      products,
      totalQuantity: products.reduce((s, p) => s + p.quantity, 0),
      variants: [...grouped.values()].filter((g) => g.variants.length > 0),
      modifiers,
      categories,
      quadrants: classifyQuadrants(products),
    };
  },
  async tables(ctx) {
    const [tables, areas] = await Promise.all([tablePerformance(ctx.filter), areaPerformance(ctx.filter)]);
    return { tables, areas };
  },
  async operations(ctx) {
    const [timings, stations] = await Promise.all([orderTimings(ctx.filter), stationPerformance(ctx.filter)]);
    return { timings, stations };
  },
  async service(ctx) {
    const f = ctx.filter;
    const [summary, hours, byArea, byTable] = await Promise.all([serviceSummary(f), serviceByHour(f), serviceByArea(f), serviceByTable(f)]);
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: hours.find((h) => h.hour === hour)?.count ?? 0 }));
    return { summary, byHour, byArea, byTable };
  },
  async ai(ctx) {
    const a = await aiAnalytics(ctx.filter);
    return { ...a, fallbackRate: ratio(a.fallbackTurns, a.turns) };
  },
};

function keyFor(f: AnalyticsFilter, section: string) {
  return analyticsCacheKey({ ...f, section });
}

export async function loadSection<S extends AnalyticsSection>(ctx: AnalyticsContext, section: S, options: { requestId?: string | null } = {}): Promise<SectionResult<S>> {
  const started = Date.now();
  try {
    const result = await cached(keyFor(ctx.filter, `${section}:${ctx.range.granularity}:${ctx.previousFilter.start.toISOString()}`), section, () => loaders[section](ctx) as Promise<SectionData[S]>);
    const durationMs = Date.now() - started;
    metrics.observe(`analytics.${section}_ms`, durationMs);
    const fields = { requestId: options.requestId ?? null, tenant: ctx.filter.tenantId, section, durationMs, cache: result.hit ? "hit" : "miss", resultBytes: JSON.stringify(result.value).length };
    if (!result.hit && durationMs > SLOW_QUERY_MS) {
      metrics.inc("analytics.slow_queries", 1, section);
      log.warn("analytics.slow_query", fields);
    } else log.debug("analytics.query", fields);
    return { ok: true, data: result.value, cachedAt: result.cachedAt };
  } catch (error) {
    metrics.inc("analytics.errors", 1, section);
    log.error("analytics.query_failed", { requestId: options.requestId ?? null, tenant: ctx.filter.tenantId, section, durationMs: Date.now() - started, code: "INTERNAL_ERROR", errorName: error instanceof Error ? error.name : "unknown" });
    return { ok: false };
  }
}

/** Testler ve CSV için önbelleksiz doğrudan yükleme. */
export function computeSection<S extends AnalyticsSection>(ctx: AnalyticsContext, section: S): Promise<SectionData[S]> {
  return loaders[section](ctx) as Promise<SectionData[S]>;
}

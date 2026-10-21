import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, formatLocalDate, localDateOf, startOfLocalDay } from "@/lib/analytics/time";
import type { AdvisorFacts, CurrentDetailFacts, PeriodFacts } from "@/lib/advisor/types";
import { aiAnalytics } from "@/server/analytics/ai.analytics";
import { branchClause, num, numOrNull, SALE, type AnalyticsContext, type AnalyticsFilter } from "@/server/analytics/filter";
import { stationPerformance, orderTimings } from "@/server/analytics/kds.analytics";
import { productPerformance } from "@/server/analytics/menu.analytics";
import { orderFunnel, orderKpis } from "@/server/analytics/orders.analytics";
import { serviceSummary } from "@/server/analytics/service.analytics";
import { areaPerformance } from "@/server/analytics/tables.analytics";

/**
 * Danışman olgu katmanı — Sprint 12 analitik sorgularının TOPLU sonuçları (ham sipariş satırı belleğe alınmaz) +
 * danışmana özgü birkaç toplu sorgu. Kiracı / şube / saat dilimi / para birimi her zaman AnalyticsContext'ten
 * (oturum kapsamı) gelir. Müşteri kimliği, IP, QR belirteci, konuşma İÇERİĞİ hiçbir sorguda seçilmez.
 */
export async function loadAdvisorFacts(ctx: AnalyticsContext): Promise<AdvisorFacts> {
  const [current, previous, detail] = await Promise.all([periodFacts(ctx.filter), periodFacts(ctx.previousFilter), detailFacts(ctx.filter)]);
  return { current, previous, detail, currency: ctx.filter.currency };
}

async function periodFacts(f: AnalyticsFilter): Promise<PeriodFacts> {
  const [kpis, funnel, timings, stations, products, service, areas, ai, providerErrors] = await Promise.all([
    orderKpis(f),
    orderFunnel(f),
    orderTimings(f),
    stationPerformance(f),
    productPerformance(f, 300),
    serviceSummary(f),
    areaPerformance(f),
    aiAnalytics(f),
    providerErrorCount(f),
  ]);
  const stat = (s: { count: number; medianMs: number | null; p90Ms: number | null }) => ({ count: s.count, medianMs: round(s.medianMs), p90Ms: round(s.p90Ms) });
  return {
    orders: { salesOrders: kpis.salesOrders, salesMinor: kpis.salesMinor, itemsSold: kpis.itemsSold, submitted: funnel.submitted, rejected: funnel.rejected },
    preparation: stat(timings.preparation),
    acceptance: stat(timings.acceptance),
    stations: stations.map((s) => ({ name: s.stationName, tickets: s.prep.count, medianMs: round(s.prep.medianMs), p90Ms: round(s.prep.p90Ms) })),
    products: products.map((p) => ({ key: p.key, name: p.name, archived: p.archived, deleted: p.deleted, quantity: p.quantity, totalMinor: p.totalMinor })),
    service: { total: service.total, response: stat(service.response) },
    areas: areas.map((a) => ({ area: a.areaName, orders: a.orders })),
    ai: { conversations: ai.conversations, turns: ai.turns, fallbackTurns: ai.fallbackTurns, failedTurns: ai.failedTurns, providerErrors },
  };
}

/** Sağlayıcı hataları (müşteri AI'ı; ADVISOR hariç). ai_usage şube tutmaz → yalnızca "tüm şubeler" kapsamında sayılır. */
async function providerErrorCount(f: AnalyticsFilter): Promise<number> {
  if (f.branchId) return 0;
  return prisma.aiUsage.count({ where: { tenantId: f.tenantId, success: false, kind: { in: ["CONVERSATION", "CHAT"] }, createdAt: { gte: f.start, lt: f.end } } });
}

const localHour = (column: string, tz: string) => Prisma.sql`EXTRACT(HOUR FROM ((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}))::int`;

async function detailFacts(f: AnalyticsFilter): Promise<CurrentDetailFacts> {
  const saleOrders = Prisma.sql`SELECT o.id, o.created_at, o.accepted_at, o.ready_at FROM orders o
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end} AND ${SALE} AND o.currency = ${f.currency}${branchClause("o", f.branchId)}`;

  const [prepWindows, stationWindows, bottleneck, serviceAreas, daily] = await Promise.all([
    // 2 saatlik pencerelerde medyan hazırlama (kabul → hazır), sipariş oluşturma saatine göre (yerel saat).
    prisma.$queryRaw<{ start_hour: number; n: number; med: number | null }[]>(Prisma.sql`
      WITH o AS MATERIALIZED (${saleOrders}),
      d AS (SELECT ${localHour("o.created_at", f.timeZone)} AS h, EXTRACT(EPOCH FROM (o.ready_at - o.accepted_at)) * 1000 AS ms FROM o WHERE o.ready_at IS NOT NULL)
      SELECT s.h AS start_hour, COUNT(d.ms)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY d.ms) AS med
      FROM generate_series(0, 23) s(h) JOIN d ON d.h = s.h OR d.h = (s.h + 1) % 24
      GROUP BY s.h ORDER BY s.h`),
    // Aynı pencerelerde istasyon fiş süresi (başlangıç → hazır).
    prisma.$queryRaw<{ start_hour: number; station: string; n: number; med: number | null }[]>(Prisma.sql`
      WITH d AS (
        SELECT ${localHour("t.created_at", f.timeZone)} AS h, t.station_name AS station, EXTRACT(EPOCH FROM (t.ready_at - t.started_at)) * 1000 AS ms
        FROM order_tickets t
        WHERE t.tenant_id = ${f.tenantId} AND t.created_at >= ${f.start} AND t.created_at < ${f.end} AND t.status <> 'CANCELLED'
          AND t.ready_at IS NOT NULL AND t.started_at IS NOT NULL${branchClause("t", f.branchId)}
      )
      SELECT s.h AS start_hour, d.station, COUNT(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY d.ms) AS med
      FROM generate_series(0, 23) s(h) JOIN d ON d.h = s.h OR d.h = (s.h + 1) % 24
      GROUP BY s.h, d.station`),
    // Birden fazla istasyona düşen siparişlerde EN SON hazır olan istasyon.
    prisma.$queryRaw<{ station: string | null; count: number; multi: number }[]>(Prisma.sql`
      WITH o AS MATERIALIZED (${saleOrders}),
      t AS (
        SELECT t.order_id, t.station_name, t.ready_at FROM order_tickets t JOIN o ON o.id = t.order_id
        WHERE t.tenant_id = ${f.tenantId} AND t.ready_at IS NOT NULL AND t.status <> 'CANCELLED'
      ),
      multi AS (SELECT order_id FROM t GROUP BY order_id HAVING COUNT(DISTINCT station_name) >= 2),
      last AS (SELECT DISTINCT ON (t.order_id) t.order_id, t.station_name FROM t JOIN multi USING (order_id) ORDER BY t.order_id, t.ready_at DESC)
      SELECT last.station_name AS station, COUNT(*)::int AS count, (SELECT COUNT(*) FROM multi)::int AS multi FROM last GROUP BY 1
      UNION ALL SELECT NULL, 0, (SELECT COUNT(*) FROM multi)::int`),
    // Bölge bazında servis talebi yanıt süresi (oluşturma → üstlenme). Personel bilgisi seçilmez.
    prisma.$queryRaw<{ area: string | null; n: number; med: number | null }[]>(Prisma.sql`
      SELECT r.area_name AS area, COUNT(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.acknowledged_at - r.created_at)) * 1000) AS med
      FROM table_service_requests r
      WHERE r.tenant_id = ${f.tenantId} AND r.created_at >= ${f.start} AND r.created_at < ${f.end} AND r.acknowledged_at IS NOT NULL${branchClause("r", f.branchId)}
      GROUP BY 1`),
    dailyOrders(f),
  ]);

  const multi = bottleneck.find((b) => b.station === null)?.multi ?? 0;
  return {
    prepWindows: prepWindows.map((w) => ({ startHour: num(w.start_hour), n: num(w.n), medianMs: round(numOrNull(w.med)) })),
    stationWindows: stationWindows.map((w) => ({ startHour: num(w.start_hour), station: w.station, n: num(w.n), medianMs: round(numOrNull(w.med)) })),
    bottleneck: { multiStationOrders: num(multi), lastReady: bottleneck.filter((b) => b.station !== null).map((b) => ({ station: b.station!, count: num(b.count) })) },
    serviceAreas: serviceAreas.map((a) => ({ area: a.area, n: num(a.n), medianMs: round(numOrNull(a.med)) })),
    daily,
  };
}

/** Son 28 TAM gün + son tam gün (bugün kısmi olduğu için hariç), yerel gün, boş günler 0. */
async function dailyOrders(f: AnalyticsFilter): Promise<{ day: string; orders: number }[]> {
  const today = localDateOf(f.timeZone, f.end);
  const firstDay = addDays(today, -29);
  const start = startOfLocalDay(f.timeZone, firstDay);
  const end = startOfLocalDay(f.timeZone, today);
  const rows = await prisma.$queryRaw<{ day: string; orders: number }[]>(Prisma.sql`
    SELECT to_char(((o.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${f.timeZone})::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS orders
    FROM orders o
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${start} AND o.created_at < ${end} AND ${SALE} AND o.currency = ${f.currency}${branchClause("o", f.branchId)}
    GROUP BY 1`);
  const byDay = new Map(rows.map((r) => [r.day, num(r.orders)]));
  const out: { day: string; orders: number }[] = [];
  for (let i = 0; i < 29; i++) {
    const day = formatLocalDate(addDays(firstDay, i));
    out.push({ day, orders: byDay.get(day) ?? 0 });
  }
  return out;
}

function round(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}

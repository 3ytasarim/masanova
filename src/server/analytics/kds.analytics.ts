import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { MIN_SAMPLES_FOR_P90 } from "@/lib/analytics/metrics";
import { branchClause, num, numOrNull, type AnalyticsFilter } from "@/server/analytics/filter";

/**
 * Mutfak / operasyon süreleri — kayıtlı zaman damgalarından (ms). Ortalama tek başına yanıltıcı olduğundan medyan ve
 * (en az 10 örnekte) p90 da verilir; hesap SQL'de (percentile_cont). Personel bazlı süre / sıralama YOK.
 *
 *   kabul süresi        = accepted_at − created_at          (kabul edilen siparişler)
 *   hazırlama süresi    = ready_at − accepted_at             (sipariş düzeyi: kabul → tümü hazır)
 *   hazır → servis      = served_at − ready_at
 *   istasyon fişi       = ready_at − started_at  (fiş düzeyi; bekleme = started_at − created_at)
 */
export type DurationStats = { count: number; avgMs: number | null; medianMs: number | null; p90Ms: number | null };

const stat = (expr: Prisma.Sql, cond: Prisma.Sql) => Prisma.sql`
  COUNT(*) FILTER (WHERE ${cond})::int,
  AVG(${expr}) FILTER (WHERE ${cond}),
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expr}) FILTER (WHERE ${cond}),
  percentile_cont(0.9) WITHIN GROUP (ORDER BY ${expr}) FILTER (WHERE ${cond})`;

const ms = (a: string, b: string) => Prisma.sql`(EXTRACT(EPOCH FROM (${Prisma.raw(a)} - ${Prisma.raw(b)})) * 1000)`;

function toStats(values: unknown[]): DurationStats {
  const count = num(values[0]);
  return { count, avgMs: count ? numOrNull(values[1]) : null, medianMs: count ? numOrNull(values[2]) : null, p90Ms: count >= MIN_SAMPLES_FOR_P90 ? numOrNull(values[3]) : null };
}

export type OrderTimings = { acceptance: DurationStats; preparation: DurationStats; readyToServed: DurationStats };

export async function orderTimings(f: AnalyticsFilter): Promise<OrderTimings> {
  const rows = await prisma.$queryRaw<unknown[][]>(Prisma.sql`
    SELECT ARRAY[${stat(ms("o.accepted_at", "o.created_at"), Prisma.sql`o.accepted_at IS NOT NULL`)}]::float8[] AS a,
           ARRAY[${stat(ms("o.ready_at", "o.accepted_at"), Prisma.sql`o.ready_at IS NOT NULL AND o.accepted_at IS NOT NULL`)}]::float8[] AS p,
           ARRAY[${stat(ms("o.served_at", "o.ready_at"), Prisma.sql`o.served_at IS NOT NULL AND o.ready_at IS NOT NULL`)}]::float8[] AS s
    FROM orders o
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end}${branchClause("o", f.branchId)}`);
  const r = (rows[0] ?? {}) as unknown as { a?: unknown[]; p?: unknown[]; s?: unknown[] };
  return { acceptance: toStats(r.a ?? []), preparation: toStats(r.p ?? []), readyToServed: toStats(r.s ?? []) };
}

export type StationRow = { stationName: string; stationType: string; tickets: number; prep: DurationStats; waitAvgMs: number | null };

/** İstasyon başına (fişteki anlık görüntü adı — istasyon yeniden adlandırılsa da geçmiş okunur). */
export async function stationPerformance(f: AnalyticsFilter): Promise<StationRow[]> {
  const prep = ms("t.ready_at", "t.started_at");
  const done = Prisma.sql`t.ready_at IS NOT NULL AND t.started_at IS NOT NULL`;
  const rows = await prisma.$queryRaw<{ name: string; type: string; tickets: number; c: number; avg: number | null; med: number | null; p90: number | null; wait: number | null }[]>(Prisma.sql`
    SELECT (ARRAY_AGG(t.station_name ORDER BY t.created_at DESC))[1] AS name, MAX(t.station_type::text) AS type,
           COUNT(*)::int AS tickets,
           COUNT(*) FILTER (WHERE ${done})::int AS c,
           AVG(${prep}) FILTER (WHERE ${done}) AS avg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ${prep}) FILTER (WHERE ${done}) AS med,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY ${prep}) FILTER (WHERE ${done}) AS p90,
           AVG(${ms("t.started_at", "t.created_at")}) FILTER (WHERE t.started_at IS NOT NULL) AS wait
    FROM order_tickets t
    WHERE t.tenant_id = ${f.tenantId} AND t.created_at >= ${f.start} AND t.created_at < ${f.end} AND t.status <> 'CANCELLED'${branchClause("t", f.branchId)}
    GROUP BY t.station_id
    ORDER BY tickets DESC`);
  return rows.map((r) => ({
    stationName: r.name,
    stationType: r.type,
    tickets: num(r.tickets),
    prep: toStats([r.c, r.avg, r.med, r.p90]),
    waitAvgMs: numOrNull(r.wait),
  }));
}

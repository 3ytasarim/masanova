import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { MIN_SAMPLES_FOR_P90 } from "@/lib/analytics/metrics";
import { branchClause, localTime, num, numOrNull, type AnalyticsFilter } from "@/server/analytics/filter";
import type { DurationStats } from "@/server/analytics/kds.analytics";

/**
 * Masa servis talepleri (Sprint 8) — restoran geneli. Personel adı / kimliği SEÇİLMEZ; kişi bazlı süre ya da sıralama
 * yapılmaz. Yanıt süresi = üstlenme − oluşturma; tamamlanma = tamamlama − oluşturma. Masa / bölge adları talep
 * anındaki anlık görüntüden (yeniden adlandırma geçmişi bozmaz).
 */
export type ServiceSummary = {
  total: number;
  byType: { type: string; count: number }[];
  completed: number;
  cancelled: number;
  response: DurationStats;
  completion: DurationStats;
};

const ms = (a: string) => Prisma.sql`(EXTRACT(EPOCH FROM (${Prisma.raw(a)} - r.created_at)) * 1000)`;
const where = (f: AnalyticsFilter) => Prisma.sql`r.tenant_id = ${f.tenantId} AND r.created_at >= ${f.start} AND r.created_at < ${f.end}${branchClause("r", f.branchId)}`;

export async function serviceSummary(f: AnalyticsFilter): Promise<ServiceSummary> {
  const [row] = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
           COUNT(*) FILTER (WHERE r.status = 'CANCELLED')::int AS cancelled,
           COUNT(*) FILTER (WHERE r.acknowledged_at IS NOT NULL)::int AS rc,
           AVG(${ms("r.acknowledged_at")}) FILTER (WHERE r.acknowledged_at IS NOT NULL) AS ravg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ${ms("r.acknowledged_at")}) FILTER (WHERE r.acknowledged_at IS NOT NULL) AS rmed,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY ${ms("r.acknowledged_at")}) FILTER (WHERE r.acknowledged_at IS NOT NULL) AS rp90,
           COUNT(*) FILTER (WHERE r.completed_at IS NOT NULL)::int AS cc,
           AVG(${ms("r.completed_at")}) FILTER (WHERE r.completed_at IS NOT NULL) AS cavg,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ${ms("r.completed_at")}) FILTER (WHERE r.completed_at IS NOT NULL) AS cmed
    FROM table_service_requests r WHERE ${where(f)}`);
  const types = await prisma.$queryRaw<{ type: string; count: number }[]>(Prisma.sql`
    SELECT r.type::text AS type, COUNT(*)::int AS count FROM table_service_requests r WHERE ${where(f)} GROUP BY 1 ORDER BY 2 DESC`);
  const r = row ?? {};
  const rc = num(r.rc);
  const cc = num(r.cc);
  return {
    total: num(r.total),
    completed: num(r.completed),
    cancelled: num(r.cancelled),
    byType: types.map((t) => ({ type: t.type, count: num(t.count) })),
    response: { count: rc, avgMs: rc ? numOrNull(r.ravg) : null, medianMs: rc ? numOrNull(r.rmed) : null, p90Ms: rc >= MIN_SAMPLES_FOR_P90 ? numOrNull(r.rp90) : null },
    completion: { count: cc, avgMs: cc ? numOrNull(r.cavg) : null, medianMs: cc ? numOrNull(r.cmed) : null, p90Ms: null },
  };
}

/** Saatlere göre talep yoğunluğu (yerel saat) — personel planlaması için genel görünüm. */
export async function serviceByHour(f: AnalyticsFilter): Promise<{ hour: number; count: number }[]> {
  const rows = await prisma.$queryRaw<{ hour: number; count: number }[]>(Prisma.sql`
    SELECT EXTRACT(HOUR FROM ${localTime("r.created_at", f.timeZone)})::int AS hour, COUNT(*)::int AS count
    FROM table_service_requests r WHERE ${where(f)} GROUP BY 1 ORDER BY 1`);
  return rows.map((x) => ({ hour: num(x.hour), count: num(x.count) }));
}

export async function serviceByArea(f: AnalyticsFilter): Promise<{ area: string | null; count: number }[]> {
  const rows = await prisma.$queryRaw<{ area: string | null; count: number }[]>(Prisma.sql`
    SELECT r.area_name AS area, COUNT(*)::int AS count FROM table_service_requests r WHERE ${where(f)} GROUP BY 1 ORDER BY 2 DESC`);
  return rows.map((x) => ({ area: x.area, count: num(x.count) }));
}

export async function serviceByTable(f: AnalyticsFilter): Promise<{ tableId: string; tableName: string; count: number }[]> {
  const rows = await prisma.$queryRaw<{ table_id: string; table_name: string; count: number }[]>(Prisma.sql`
    SELECT r.table_id, (ARRAY_AGG(r.table_name ORDER BY r.created_at DESC))[1] AS table_name, COUNT(*)::int AS count
    FROM table_service_requests r WHERE ${where(f)} GROUP BY 1 ORDER BY 3 DESC LIMIT 100`);
  return rows.map((x) => ({ tableId: x.table_id, tableName: x.table_name, count: num(x.count) }));
}

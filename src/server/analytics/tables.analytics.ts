import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { branchClause, num, SALE, type AnalyticsFilter } from "@/server/analytics/filter";

/**
 * Masa ve bölge performansı. Masa: kimliğe göre gruplanır, GÜNCEL ad gösterilir; sipariş anındaki ad farklıysa
 * (yeniden adlandırma) ayrıca verilir. Bölge: sipariş anındaki bölge adı anlık görüntüsü (masa başka bölgeye taşınsa
 * da geçmiş sipariş eski bölgesinde kalır).
 * QR taramaları yalnızca TOPLAM sayaç (tüm zamanlar) — tarama başına zaman serisi saklanmadığından dönemsel tarama
 * analizi YAPILMAZ.
 */
export type TableRow = { tableId: string; name: string; formerName: string | null; areaName: string | null; orders: number; totalMinor: number; avgMinor: number | null; serviceRequests: number; qrScansAllTime: number };

export async function tablePerformance(f: AnalyticsFilter, limit = 100): Promise<TableRow[]> {
  const rows = await prisma.$queryRaw<{ table_id: string; current_name: string | null; snapshot_name: string; area_name: string | null; orders: number; total: bigint }[]>(Prisma.sql`
    SELECT o.table_id, MAX(dt.name) AS current_name,
           (ARRAY_AGG(o.table_name ORDER BY o.created_at ASC))[1] AS snapshot_name,
           (ARRAY_AGG(o.area_name ORDER BY o.created_at DESC))[1] AS area_name,
           COUNT(*)::int AS orders, COALESCE(SUM(o.total_minor), 0)::bigint AS total
    FROM orders o
    LEFT JOIN dining_tables dt ON dt.id = o.table_id AND dt.tenant_id = o.tenant_id
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end} AND ${SALE} AND o.currency = ${f.currency}${branchClause("o", f.branchId)}
    GROUP BY o.table_id
    ORDER BY total DESC
    LIMIT ${limit}`);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.table_id);
  const [requests, scans] = await Promise.all([
    prisma.$queryRaw<{ table_id: string; count: number }[]>(Prisma.sql`
      SELECT r.table_id, COUNT(*)::int AS count FROM table_service_requests r
      WHERE r.tenant_id = ${f.tenantId} AND r.created_at >= ${f.start} AND r.created_at < ${f.end} AND r.table_id IN (${Prisma.join(ids)})${branchClause("r", f.branchId)}
      GROUP BY 1`),
    prisma.$queryRaw<{ table_id: string; scans: bigint }[]>(Prisma.sql`
      SELECT q.table_id, COALESCE(SUM(q.scan_count), 0)::bigint AS scans FROM table_qr_tokens q
      WHERE q.tenant_id = ${f.tenantId} AND q.table_id IN (${Prisma.join(ids)}) GROUP BY 1`),
  ]);
  const req = new Map(requests.map((r) => [r.table_id, num(r.count)]));
  const scan = new Map(scans.map((s) => [s.table_id, num(s.scans)]));
  return rows.map((r) => {
    const orders = num(r.orders);
    const totalMinor = num(r.total);
    const name = r.current_name ?? r.snapshot_name;
    return {
      tableId: r.table_id,
      name,
      formerName: r.snapshot_name !== name ? r.snapshot_name : null,
      areaName: r.area_name,
      orders,
      totalMinor,
      avgMinor: orders ? Math.round(totalMinor / orders) : null,
      serviceRequests: req.get(r.table_id) ?? 0,
      qrScansAllTime: scan.get(r.table_id) ?? 0,
    };
  });
}

export type AreaRow = { areaName: string | null; orders: number; totalMinor: number; activeTables: number; serviceRequests: number };

export async function areaPerformance(f: AnalyticsFilter): Promise<AreaRow[]> {
  const [orders, requests] = await Promise.all([
    prisma.$queryRaw<{ area: string | null; orders: number; total: bigint; tables: number }[]>(Prisma.sql`
      SELECT o.area_name AS area, COUNT(*)::int AS orders, COALESCE(SUM(o.total_minor), 0)::bigint AS total, COUNT(DISTINCT o.table_id)::int AS tables
      FROM orders o
      WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end} AND ${SALE} AND o.currency = ${f.currency}${branchClause("o", f.branchId)}
      GROUP BY 1`),
    prisma.$queryRaw<{ area: string | null; count: number }[]>(Prisma.sql`
      SELECT r.area_name AS area, COUNT(*)::int AS count FROM table_service_requests r
      WHERE r.tenant_id = ${f.tenantId} AND r.created_at >= ${f.start} AND r.created_at < ${f.end}${branchClause("r", f.branchId)}
      GROUP BY 1`),
  ]);
  const byArea = new Map<string, AreaRow>();
  const keyOf = (a: string | null) => a ?? "\u0000";
  for (const o of orders) byArea.set(keyOf(o.area), { areaName: o.area, orders: num(o.orders), totalMinor: num(o.total), activeTables: num(o.tables), serviceRequests: 0 });
  for (const r of requests) {
    const row = byArea.get(keyOf(r.area)) ?? { areaName: r.area, orders: 0, totalMinor: 0, activeTables: 0, serviceRequests: 0 };
    row.serviceRequests = num(r.count);
    byArea.set(keyOf(r.area), row);
  }
  return [...byArea.values()].sort((a, b) => b.totalMinor - a.totalMinor || b.serviceRequests - a.serviceRequests);
}

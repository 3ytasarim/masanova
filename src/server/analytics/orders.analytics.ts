import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Granularity } from "@/lib/analytics/range";
import { branchClause, localTime, num, SALE, type AnalyticsFilter } from "@/server/analytics/filter";

/**
 * Sipariş analitiği — tamamen SQL toplama (Node'a satır taşınmaz). Dönem ataması sipariş kaydı anı (`created_at` =
 * `submitted_at`; tenant + tarih indeksleri created_at üzerinde). Tutarlar sipariş anındaki kayıtlı `total_minor`.
 */
export type OrderKpis = {
  salesOrders: number;
  salesMinor: number;
  itemsSold: number;
  activeTables: number;
  /** Bu dönemde varsayılan para biriminden farklı para birimli satış siparişi sayısı (toplama katılmaz). */
  otherCurrencyOrders: number;
};

export type OrderFunnel = {
  submitted: number;
  pending: number;
  accepted: number;
  rejected: number;
  preparing: number;
  ready: number;
  served: number;
  cancelled: number;
};

export async function orderKpis(f: AnalyticsFilter): Promise<OrderKpis> {
  const [row] = await prisma.$queryRaw<{ sales_orders: number; sales_minor: bigint; active_tables: number; other_currency: number }[]>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE ${SALE} AND o.currency = ${f.currency})::int AS sales_orders,
      COALESCE(SUM(o.total_minor) FILTER (WHERE ${SALE} AND o.currency = ${f.currency}), 0)::bigint AS sales_minor,
      COUNT(DISTINCT o.table_id) FILTER (WHERE ${SALE})::int AS active_tables,
      COUNT(*) FILTER (WHERE ${SALE} AND o.currency <> ${f.currency})::int AS other_currency
    FROM orders o
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end}${branchClause("o", f.branchId)}`);
  // Plan dayanıklı: önce siparişler (MATERIALIZED), sonra order_items(order_id) indeksi — bkz. menu.analytics.ts.
  const [items] = await prisma.$queryRaw<{ qty: bigint }[]>(Prisma.sql`
    WITH o AS MATERIALIZED (
      SELECT o.id FROM orders o
      WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end} AND ${SALE} AND o.currency = ${f.currency}${branchClause("o", f.branchId)}
    )
    SELECT COALESCE(SUM(oi.quantity), 0)::bigint AS qty
    FROM o JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = ${f.tenantId}`);
  return {
    salesOrders: num(row?.sales_orders),
    salesMinor: num(row?.sales_minor),
    itemsSold: num(items?.qty),
    activeTables: num(row?.active_tables),
    otherCurrencyOrders: num(row?.other_currency),
  };
}

/**
 * Sipariş hunisi: dönemde GÖNDERİLEN tüm siparişler; her aşama "ulaşıldı mı" kayıtlı zaman damgasıyla sayılır
 * (accepted_at / preparing_at / ready_at / served_at). Böylece sonradan iptal edilen kabul edilmiş sipariş "kabul" olarak
 * da görünür — güncel durum tek başına geçmiş geçişleri anlatmaz. Reddedilen / iptal edilen sonuç durumudur.
 */
export async function orderFunnel(f: AnalyticsFilter): Promise<OrderFunnel> {
  const [r] = await prisma.$queryRaw<Record<string, number>[]>(Prisma.sql`
    SELECT
      COUNT(*)::int AS submitted,
      COUNT(*) FILTER (WHERE o.status = 'SUBMITTED')::int AS pending,
      COUNT(*) FILTER (WHERE o.accepted_at IS NOT NULL)::int AS accepted,
      COUNT(*) FILTER (WHERE o.status = 'REJECTED')::int AS rejected,
      COUNT(*) FILTER (WHERE o.preparing_at IS NOT NULL)::int AS preparing,
      COUNT(*) FILTER (WHERE o.ready_at IS NOT NULL)::int AS ready,
      COUNT(*) FILTER (WHERE o.served_at IS NOT NULL)::int AS served,
      COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled
    FROM orders o
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end}${branchClause("o", f.branchId)}`);
  const n = (k: string) => num(r?.[k]);
  return { submitted: n("submitted"), pending: n("pending"), accepted: n("accepted"), rejected: n("rejected"), preparing: n("preparing"), ready: n("ready"), served: n("served"), cancelled: n("cancelled") };
}

export type TrendRow = { key: string; orders: number; salesMinor: number };

/** Zaman serisi (yerel saat / gün kovaları). Boş kovalar çağıran tarafından 0 ile doldurulur (bucketKeys). */
export async function orderTrend(f: AnalyticsFilter, granularity: Granularity): Promise<TrendRow[]> {
  const local = localTime("o.created_at", f.timeZone);
  const keyExpr = granularity === "hour" ? Prisma.sql`to_char(date_trunc('hour', ${local}), 'YYYY-MM-DD HH24')` : Prisma.sql`to_char(date_trunc('day', ${local}), 'YYYY-MM-DD')`;
  const rows = await prisma.$queryRaw<{ key: string; orders: number; sales: bigint }[]>(Prisma.sql`
    SELECT ${keyExpr} AS key, COUNT(*)::int AS orders, COALESCE(SUM(o.total_minor), 0)::bigint AS sales
    FROM orders o
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end} AND ${SALE} AND o.currency = ${f.currency}${branchClause("o", f.branchId)}
    GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => ({ key: r.key, orders: num(r.orders), salesMinor: num(r.sales) }));
}

export type HeatCell = { weekday: number; hour: number; orders: number; salesMinor: number };

/** Hafta günü (ISO 1–7) × saat (0–23), yerel saat. */
export async function orderHeatmap(f: AnalyticsFilter): Promise<HeatCell[]> {
  const local = localTime("o.created_at", f.timeZone);
  const rows = await prisma.$queryRaw<{ dow: number; hour: number; orders: number; sales: bigint }[]>(Prisma.sql`
    SELECT EXTRACT(ISODOW FROM ${local})::int AS dow, EXTRACT(HOUR FROM ${local})::int AS hour,
           COUNT(*)::int AS orders, COALESCE(SUM(o.total_minor), 0)::bigint AS sales
    FROM orders o
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end} AND ${SALE} AND o.currency = ${f.currency}${branchClause("o", f.branchId)}
    GROUP BY 1, 2`);
  return rows.map((r) => ({ weekday: num(r.dow), hour: num(r.hour), orders: num(r.orders), salesMinor: num(r.sales) }));
}

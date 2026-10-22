import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Müşteri davranışından öğrenen eşleştirme: bir ana yemekle AYNI siparişte en sık birlikte istenen ürünler
 * (son `days` gün, iptal / red hariç). Yalnızca okuma; kişisel veri yok (ürün anahtarı + sipariş sayısı).
 * `minOrders` altındaki birliktelikler dönmez → az veriyle "en çok tercih edilen" iddiası kurulmaz.
 */
export type CoOrder = { slug: string; orders: number };

export async function coOrderedWith(tenantId: string, mainSlugs: readonly string[], options: { days?: number; minOrders?: number; limit?: number } = {}): Promise<Map<string, CoOrder[]>> {
  const out = new Map<string, CoOrder[]>();
  if (!mainSlugs.length) return out;
  const days = options.days ?? 180;
  const minOrders = options.minOrders ?? 2;
  const limit = options.limit ?? 4;
  const rows = await prisma.$queryRaw<{ main: string; slug: string; orders: number }[]>(Prisma.sql`
    WITH mains AS (
      SELECT id, slug FROM products WHERE tenant_id = ${tenantId} AND slug = ANY(${[...mainSlugs]}::text[])
    ),
    main_orders AS (
      SELECT DISTINCT oi.order_id, m.slug AS main
      FROM order_items oi
      JOIN mains m ON m.id = oi.product_id
      JOIN orders o ON o.id = oi.order_id AND o.tenant_id = ${tenantId}
      WHERE oi.tenant_id = ${tenantId}
        AND o.status NOT IN ('CANCELLED', 'REJECTED')
        AND o.created_at > now() - make_interval(days => ${days})
    )
    SELECT mo.main, p.slug, COUNT(DISTINCT oi.order_id)::int AS orders
    FROM main_orders mo
    JOIN order_items oi ON oi.order_id = mo.order_id AND oi.tenant_id = ${tenantId}
    JOIN products p ON p.id = oi.product_id AND p.tenant_id = ${tenantId}
    WHERE p.slug <> mo.main
    GROUP BY mo.main, p.slug
    HAVING COUNT(DISTINCT oi.order_id) >= ${minOrders}
    ORDER BY mo.main, orders DESC
  `);
  for (const r of rows) {
    const list = out.get(r.main) ?? [];
    if (list.length < limit) list.push({ slug: r.slug, orders: r.orders });
    out.set(r.main, list);
  }
  return out;
}

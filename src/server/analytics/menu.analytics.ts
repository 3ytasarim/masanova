import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { branchClause, num, SALE, type AnalyticsFilter } from "@/server/analytics/filter";

/**
 * Ürün / menü analitiği — sipariş SATIRI anlık görüntülerinden (OrderItem): ad, varyant, birim fiyat, satır tutarı
 * sipariş anında kaydedildi; canlı menüden YENİDEN HESAPLANMAZ.
 *
 * Tarihsel ürün kimliği: gruplama anahtarı `product_id` (ürün hâlâ varsa; arşivlense de FK durur) — yoksa anlık
 * görüntüdeki varsayılan dil adı ("snap:<ad>"). Gösterim adı: ürün mevcutsa GÜNCEL adı, değilse en son anlık görüntü
 * adı; yeniden adlandırılmışsa ilk siparişlerdeki eski ad ayrıca belirtilir. Arşivlenen / silinen ürünün geçmiş satışı
 * korunur.
 *
 * Kategori: sipariş anında kategori anlık görüntüsü Sprint 6'da SAKLANMADI → kategori görünümü ürünün GÜNCEL
 * kategorisine göredir ("güncel kategori görünümü"); ürün artık yoksa "Kategorisi bilinmiyor". Eski anlık görüntüler
 * yeniden yazılmaz.
 */
export type ProductRow = {
  key: string;
  name: string;
  /** Ürün yeniden adlandırıldıysa sipariş anındaki (en eski) ad. */
  formerName: string | null;
  archived: boolean;
  deleted: boolean;
  quantity: number;
  orders: number;
  totalMinor: number;
  avgUnitMinor: number;
};

/**
 * Plan dayanıklılığı: önce dönemin satış siparişleri MATERIALIZED olarak seçilir (orders tenant + tarih indeksi), sonra
 * her sipariş için order_items(order_id) indeksine bakılır. İstatistikler bayatken (toplu içe aktarma / hızlı büyüyen
 * yeni kiracı) planlayıcı "1 satır" tahminiyle iç içe döngüde tam tarama seçebiliyordu (10k sipariş × 30k satırda
 * ~2 dk — yük testinde yakalandı); bu yapı her iki durumda da indeksle çalışır.
 */
const saleOrders = (f: AnalyticsFilter) =>
  Prisma.sql`WITH o AS MATERIALIZED (
    SELECT o.id, o.created_at FROM orders o
    WHERE o.tenant_id = ${f.tenantId} AND o.created_at >= ${f.start} AND o.created_at < ${f.end} AND ${SALE} AND o.currency = ${f.currency}${branchClause("o", f.branchId)}
  )`;
const itemsJoin = (f: AnalyticsFilter) => Prisma.sql`FROM o JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = ${f.tenantId}`;

export async function productPerformance(f: AnalyticsFilter, limit = 200): Promise<ProductRow[]> {
  const rows = await prisma.$queryRaw<{ key: string; current_name: string | null; latest_snapshot: string; earliest_snapshot: string; archived: boolean; deleted: boolean; qty: bigint; orders: number; total: bigint }[]>(Prisma.sql`
    ${saleOrders(f)}
    SELECT COALESCE(oi.product_id, 'snap:' || oi.product_name_default) AS key,
           MAX(p.name) AS current_name,
           (ARRAY_AGG(oi.product_name_default ORDER BY o.created_at DESC))[1] AS latest_snapshot,
           (ARRAY_AGG(oi.product_name_default ORDER BY o.created_at ASC))[1] AS earliest_snapshot,
           BOOL_OR(p.archived_at IS NOT NULL) AS archived,
           BOOL_AND(p.id IS NULL) AS deleted,
           SUM(oi.quantity)::bigint AS qty,
           COUNT(DISTINCT oi.order_id)::int AS orders,
           SUM(oi.line_total_minor)::bigint AS total
    ${itemsJoin(f)}
    LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
    GROUP BY 1
    ORDER BY qty DESC, total DESC
    LIMIT ${limit}`);
  return rows.map((r) => {
    const quantity = num(r.qty);
    const totalMinor = num(r.total);
    const name = r.current_name ?? r.latest_snapshot;
    return {
      key: r.key,
      name,
      formerName: r.earliest_snapshot !== name ? r.earliest_snapshot : null,
      archived: !!r.archived,
      deleted: !!r.deleted,
      quantity,
      orders: num(r.orders),
      totalMinor,
      avgUnitMinor: quantity ? Math.round(totalMinor / quantity) : 0,
    };
  });
}

export type VariantRow = { productKey: string; productName: string; variant: string; quantity: number; totalMinor: number };

/** Varyant dağılımı (anlık görüntüdeki varyant adı). */
export async function variantPerformance(f: AnalyticsFilter, limit = 200): Promise<VariantRow[]> {
  const rows = await prisma.$queryRaw<{ key: string; product_name: string; variant: string; qty: bigint; total: bigint }[]>(Prisma.sql`
    ${saleOrders(f)}
    SELECT COALESCE(oi.product_id, 'snap:' || oi.product_name_default) AS key,
           COALESCE(MAX(p.name), (ARRAY_AGG(oi.product_name_default ORDER BY o.created_at DESC))[1]) AS product_name,
           oi.variant_name AS variant,
           SUM(oi.quantity)::bigint AS qty, SUM(oi.line_total_minor)::bigint AS total
    ${itemsJoin(f)}
    LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
    WHERE oi.variant_name IS NOT NULL
    GROUP BY 1, 3
    ORDER BY qty DESC
    LIMIT ${limit}`);
  return rows.map((r) => ({ productKey: r.key, productName: r.product_name, variant: r.variant, quantity: num(r.qty), totalMinor: num(r.total) }));
}

export type ModifierRow = { key: string; group: string; modifier: string; selections: number; orders: number };

/** Yapılandırılmış seçimler (OrderItemModifier) — serbest not alanı DAHİL DEĞİL. Seçim sayısı satır adediyle çarpılır. */
export async function modifierPerformance(f: AnalyticsFilter, limit = 50): Promise<ModifierRow[]> {
  const rows = await prisma.$queryRaw<{ key: string; group_name: string; modifier_name: string; selections: bigint; orders: number }[]>(Prisma.sql`
    ${saleOrders(f)}
    SELECT COALESCE(m.modifier_id, 'snap:' || m.group_name || '/' || m.modifier_name) AS key,
           (ARRAY_AGG(m.group_name ORDER BY o.created_at DESC))[1] AS group_name,
           (ARRAY_AGG(m.modifier_name ORDER BY o.created_at DESC))[1] AS modifier_name,
           SUM(oi.quantity)::bigint AS selections,
           COUNT(DISTINCT oi.order_id)::int AS orders
    ${itemsJoin(f)}
    JOIN order_item_modifiers m ON m.order_item_id = oi.id AND m.tenant_id = ${f.tenantId}
    GROUP BY 1
    ORDER BY selections DESC
    LIMIT ${limit}`);
  return rows.map((r) => ({ key: r.key, group: r.group_name, modifier: r.modifier_name, selections: num(r.selections), orders: num(r.orders) }));
}

export type CategoryRow = { name: string | null; quantity: number; totalMinor: number };

/** GÜNCEL kategori görünümü (tarihsel kategori anlık görüntüsü yok — bkz. üst açıklama). name=null → ürün artık yok. */
export async function categoryPerformance(f: AnalyticsFilter): Promise<CategoryRow[]> {
  const rows = await prisma.$queryRaw<{ name: string | null; qty: bigint; total: bigint }[]>(Prisma.sql`
    ${saleOrders(f)}
    SELECT c.name AS name, SUM(oi.quantity)::bigint AS qty, SUM(oi.line_total_minor)::bigint AS total
    ${itemsJoin(f)}
    LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
    LEFT JOIN menu_categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
    GROUP BY c.id, c.name
    ORDER BY total DESC`);
  return rows.map((r) => ({ name: r.name, quantity: num(r.qty), totalMinor: num(r.total) }));
}

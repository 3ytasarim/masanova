import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * Analitik › Genel bakış ödeme özeti. Tanımlar açık: "Ödenen" = sağlayıcı / kasa tarafından KESİNLEŞMİŞ ödeme tutarı
 * (iade edilenler dahil, ayrıca gösterilir); online ve kasada ayrı. Bu bir "kesinleşmiş ciro" ya da muhasebe raporu
 * DEĞİLDİR (komisyon, valör, ters ibraz yok). Sipariş sayıları: ret / iptal hariç, seçilen aralıkta oluşturulan siparişler.
 */
export type PaymentMetrics = { unpaidOrders: number; partiallyPaidOrders: number; paidOrders: number; onlineMinor: number; manualMinor: number; refundedMinor: number; succeededPayments: number; failedPayments: number };

export async function paymentMetrics(scope: TenantScope, range: { from: Date; to: Date; branchId?: string | null }): Promise<PaymentMetrics> {
  const tenantId = scope.tenantId;
  const branch = range.branchId ? Prisma.sql`AND o.branch_id = ${range.branchId}` : Prisma.empty;
  const paymentWhere = { tenantId, succeededAt: { gte: range.from, lt: range.to }, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] as ("SUCCEEDED" | "PARTIALLY_REFUNDED" | "REFUNDED")[] }, ...(range.branchId ? { branchId: range.branchId } : {}) };
  const [orderStates, byMethod, refunds, failed] = await Promise.all([
    prisma.$queryRaw<{ unpaid: bigint; partial: bigint; paid: bigint }[]>`
      WITH x AS (
        SELECT o.total_minor AS t,
               COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')), 0) AS paid
        FROM orders o
        LEFT JOIN payments p ON p.order_id = o.id AND p.tenant_id = o.tenant_id
        WHERE o.tenant_id = ${tenantId} AND o.created_at >= ${range.from} AND o.created_at < ${range.to}
          AND o.status NOT IN ('REJECTED', 'CANCELLED') ${branch}
        GROUP BY o.id, o.total_minor
      )
      SELECT COUNT(*) FILTER (WHERE paid = 0) AS unpaid,
             COUNT(*) FILTER (WHERE paid > 0 AND paid < t) AS partial,
             COUNT(*) FILTER (WHERE paid > 0 AND paid >= t) AS paid
      FROM x`,
    prisma.payment.groupBy({ by: ["method"], where: paymentWhere, _sum: { amountMinor: true }, _count: { _all: true } }),
    prisma.paymentRefund.aggregate({ where: { tenantId, status: "SUCCEEDED", completedAt: { gte: range.from, lt: range.to }, ...(range.branchId ? { payment: { branchId: range.branchId } } : {}) }, _sum: { amountMinor: true } }),
    prisma.payment.count({ where: { tenantId, status: "FAILED", createdAt: { gte: range.from, lt: range.to }, ...(range.branchId ? { branchId: range.branchId } : {}) } }),
  ]);
  const s = orderStates[0];
  const sum = (pred: (m: string) => boolean) => byMethod.filter((g) => pred(g.method)).reduce((a, g) => a + (g._sum.amountMinor ?? 0), 0);
  return {
    unpaidOrders: Number(s?.unpaid ?? 0),
    partiallyPaidOrders: Number(s?.partial ?? 0),
    paidOrders: Number(s?.paid ?? 0),
    onlineMinor: sum((m) => m === "ONLINE"),
    manualMinor: sum((m) => m !== "ONLINE"),
    refundedMinor: refunds._sum.amountMinor ?? 0,
    succeededPayments: byMethod.reduce((a, g) => a + g._count._all, 0),
    failedPayments: failed,
  };
}

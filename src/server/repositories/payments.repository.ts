import "server-only";
import type { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * Panel ödeme sorguları — her sorgu kiracı kapsamlı. Kart verisi yalnızca marka + son 4 hane; sağlayıcı referansı
 * kısaltılmış gösterilir. İdempotency özetleri / istek özetleri / ödeme bağlantıları panele hiç taşınmaz.
 */
export type PaymentListFilter = { status?: PaymentStatus; method?: PaymentMethod; branchId?: string; from?: Date; to?: Date; orderNumber?: number; page: number; pageSize: number };

export async function listPaymentsPage(scope: TenantScope, f: PaymentListFilter) {
  const where: Prisma.PaymentWhereInput = {
    tenantId: scope.tenantId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.method ? { method: f.method } : {}),
    ...(f.branchId ? { branchId: f.branchId } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.orderNumber ? { order: { orderNumber: f.orderNumber } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: { id: true, method: true, status: true, splitMode: true, amountMinor: true, refundedMinor: true, currency: true, cardBrand: true, cardLast4: true, needsRefund: true, createdAt: true, order: { select: { id: true, orderNumber: true, tableName: true } }, branch: { select: { name: true } } },
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, total };
}

export async function getPaymentDetail(scope: TenantScope, paymentId: string) {
  const p = await prisma.payment.findFirst({
    where: { id: paymentId, tenantId: scope.tenantId },
    select: {
      id: true,
      publicId: true,
      provider: true,
      method: true,
      splitMode: true,
      status: true,
      currency: true,
      amountMinor: true,
      refundedMinor: true,
      reservedUntil: true,
      needsRefund: true,
      failureCode: true,
      cardBrand: true,
      cardLast4: true,
      createdAt: true,
      succeededAt: true,
      createdByUserId: true,
      order: { select: { id: true, orderNumber: true, tableName: true, totalMinor: true } },
      branch: { select: { name: true } },
      attempts: { orderBy: { createdAt: "asc" }, select: { id: true, provider: true, providerReference: true, status: true, amountMinor: true, failureCode: true, createdAt: true, completedAt: true } },
      allocations: { orderBy: { id: "asc" }, select: { id: true, amountMinor: true, quantity: true, orderItem: { select: { productNameDefault: true, variantName: true } } } },
      refunds: { orderBy: { createdAt: "asc" }, select: { id: true, amountMinor: true, status: true, reason: true, providerReference: true, createdAt: true, completedAt: true, createdByUserId: true } },
    },
  });
  if (!p) return null;
  const userIds = [p.createdByUserId, ...p.refunds.map((r) => r.createdByUserId)].filter((x): x is string => !!x);
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds }, tenantId: scope.tenantId }, select: { id: true, firstName: true, lastName: true } }) : [];
  return { ...p, userNames: new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()])) };
}

/** Sipariş ayrıntısı için ödeme satırları (kasiyer / müdür / sahip). */
export async function listOrderPayments(scope: TenantScope, orderId: string) {
  return prisma.payment.findMany({
    where: { tenantId: scope.tenantId, orderId },
    orderBy: { createdAt: "asc" },
    select: { id: true, method: true, status: true, amountMinor: true, refundedMinor: true, cardBrand: true, cardLast4: true, needsRefund: true, createdAt: true, _count: { select: { attempts: true } } },
  });
}

/** Sağlayıcı referansını kısaltarak göster (tam değer panelde gerekmez). */
export const maskReference = (ref: string | null) => (ref ? (ref.length > 12 ? `${ref.slice(0, 6)}…${ref.slice(-4)}` : ref) : "—");

import "server-only";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { TenantScope } from "@/lib/tenant/scope";
import { displayName } from "@/lib/crm/contact";

/**
 * Sipariş okuma sorguları. Panel sorguları TenantScope ile kapsamlıdır; public sorgu kiracı + MASA + public kimlik
 * üçlüsüyle (güvenilir QR bağlamından) aranır. Görüntüleme yalnızca sipariş KOPYALARINI kullanır — canlı ürün /
 * fiyat tablolarına join yapılmaz.
 */

export type OrderListQuery = {
  branchId?: string;
  status?: OrderStatus;
  areaId?: string;
  tableId?: string;
  from?: Date;
  to?: Date;
  orderNumber?: number;
  page: number;
  pageSize: number;
};

export async function listOrdersPage(scope: TenantScope, query: OrderListQuery) {
  const where: Prisma.OrderWhereInput = {
    tenantId: scope.tenantId,
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.tableId ? { tableId: query.tableId } : {}),
    ...(query.areaId ? { table: { diningAreaId: query.areaId } } : {}),
    ...(query.orderNumber ? { orderNumber: query.orderNumber } : {}),
    ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { id: true, orderNumber: true, status: true, tableName: true, areaName: true, branchName: true, itemCount: true, totalMinor: true, currency: true, createdAt: true },
    }),
    prisma.order.count({ where }),
  ]);
  return { items, total };
}

export function listOrderFilterOptions(scope: TenantScope) {
  return Promise.all([
    prisma.branch.findMany({ where: { tenantId: scope.tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.diningArea.findMany({ where: { tenantId: scope.tenantId }, orderBy: [{ branchId: "asc" }, { sortOrder: "asc" }], select: { id: true, name: true, branchId: true } }),
    prisma.diningTable.findMany({ where: { tenantId: scope.tenantId }, orderBy: [{ sortOrder: "asc" }, { number: "asc" }], take: 1000, select: { id: true, name: true, branchId: true } }),
  ]);
}

const itemsSelect = {
  orderBy: { sortOrder: "asc" },
  select: {
    productName: true,
    productNameDefault: true,
    variantName: true,
    basePriceMinor: true,
    modifiersTotalMinor: true,
    unitPriceMinor: true,
    quantity: true,
    lineTotalMinor: true,
    note: true,
    modifiers: { orderBy: { sortOrder: "asc" }, select: { groupName: true, modifierName: true, priceDeltaMinor: true } },
  },
} satisfies Prisma.Order$itemsArgs;

export async function getOrderDetail(scope: TenantScope, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId: scope.tenantId },
    include: { items: itemsSelect, history: { orderBy: { createdAt: "asc" } }, promotion: { select: { kind: true, label: true, codeSnapshot: true, discountMinor: true, pointsSpent: true, freeItemName: true } } },
  });
  if (!order) return null;
  const actorIds = [...new Set(order.history.map((h) => h.actorUserId).filter((id): id is string => !!id))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  // Tanınan müşteri: YALNIZCA gösterim adı (telefon / e-posta sipariş ekranına gelmez).
  const customer = order.customerId ? await prisma.customer.findFirst({ where: { id: order.customerId, tenantId: scope.tenantId }, select: { id: true, firstName: true, lastName: true, publicId: true } }) : null;
  return {
    order,
    actorNames: new Map(actors.map((a) => [a.id, `${a.firstName} ${a.lastName}`])),
    customer: customer ? { id: customer.id, name: displayName(customer) } : null,
  };
}

/** Müşterinin sipariş görünümünün kapsamı: aynı masadan ve son 24 saat (eski siparişler masaya oturan yeni müşteriye açılmaz). */
export const PUBLIC_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Public sipariş görünümü — YALNIZCA güvenilir QR bağlamının kiracısı VE masası eşleşirse. Public kimlik tek başına
 * yetki değildir: başka masanın / başka kiracının QR'ıyla aynı kimlik açılmaz.
 */
export async function getPublicOrder(context: { tenantId: string; tableId: string }, publicId: string, now = new Date()) {
  return prisma.order.findFirst({
    where: { publicId, tenantId: context.tenantId, tableId: context.tableId, createdAt: { gte: new Date(now.getTime() - PUBLIC_ORDER_WINDOW_MS) } },
    select: {
      publicId: true,
      orderNumber: true,
      status: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      totalMinor: true,
      itemCount: true,
      customerNote: true,
      promotion: { select: { label: true, codeSnapshot: true, freeItemName: true, pointsSpent: true } },
      tableName: true,
      areaName: true,
      branchName: true,
      rejectionReason: true,
      createdAt: true,
      items: itemsSelect,
    },
  });
}
/** Public bağlamdan (kiracı + MASA + son 24 saat) sipariş iç kimliği — ödeme eylemleri için. */
export async function findPublicOrderId(context: { tenantId: string; tableId: string }, publicId: string, now = new Date()): Promise<string | null> {
  const o = await prisma.order.findFirst({ where: { publicId, tenantId: context.tenantId, tableId: context.tableId, createdAt: { gte: new Date(now.getTime() - PUBLIC_ORDER_WINDOW_MS) } }, select: { id: true } });
  return o?.id ?? null;
}
export type PublicOrderRecord = NonNullable<Awaited<ReturnType<typeof getPublicOrder>>>;

/**
 * Canlı durum akışı için iç referans (getPublicOrder ile AYNI erişim kuralı: kiracı + masa + 24 saat).
 * İç kimlik yalnızca sunucuda kanal adı için kullanılır; istemciye gönderilmez.
 */
export async function findPublicOrderStreamRef(context: { tenantId: string; tableId: string }, publicId: string, now = new Date()) {
  return prisma.order.findFirst({
    where: { publicId, tenantId: context.tenantId, tableId: context.tableId, createdAt: { gte: new Date(now.getTime() - PUBLIC_ORDER_WINDOW_MS) } },
    select: { id: true, createdAt: true },
  });
}

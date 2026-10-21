import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * KDS / istasyon okumaları — her sorgu kapsamın tenantId'siyle süzülür. Görünen bilgiler sipariş KOPYALARINDAN gelir
 * (ürün / varyant / ekstra adı, masa / bölge); fiyat KDS'e gönderilmez.
 */

/** Hazır fişler servis edilene kadar "Hazır" sütununda kalır; çok eskileri (unutulmuş) ekranı kirletmesin. */
export const KDS_READY_WINDOW_MS = 3 * 60 * 60 * 1000;
export const KDS_TICKET_LIMIT = 300;

export async function listStationsByBranch(scope: TenantScope) {
  return prisma.branch.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      active: true,
      defaultStationId: true,
      stations: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, type: true, active: true, _count: { select: { products: true } } },
      },
    },
  });
}
export type BranchStations = Awaited<ReturnType<typeof listStationsByBranch>>;

const ticketItemsSelect = {
  orderBy: { sortOrder: "asc" as const },
  select: {
    orderItem: {
      select: {
        id: true,
        quantity: true,
        productNameDefault: true,
        variantName: true,
        note: true,
        modifiers: { orderBy: { sortOrder: "asc" as const }, select: { groupName: true, modifierName: true } },
      },
    },
  },
};

export async function listKdsTickets(scope: TenantScope, now = new Date()) {
  return prisma.orderTicket.findMany({
    where: {
      tenantId: scope.tenantId,
      OR: [
        { status: { in: ["PENDING", "PREPARING"] } },
        { status: "READY", readyAt: { gte: new Date(now.getTime() - KDS_READY_WINDOW_MS) }, order: { status: { in: ["ACCEPTED", "PREPARING", "READY"] } } },
      ],
    },
    orderBy: [{ createdAt: "asc" }],
    take: KDS_TICKET_LIMIT,
    select: {
      id: true,
      stationId: true,
      stationName: true,
      status: true,
      createdAt: true,
      startedAt: true,
      readyAt: true,
      order: { select: { id: true, orderNumber: true, status: true, tableName: true, areaName: true, branchName: true, customerNote: true, submittedAt: true } },
      items: ticketItemsSelect,
    },
  });
}
export type KdsTicketRecord = Awaited<ReturnType<typeof listKdsTickets>>[number];

/** Sipariş ayrıntısı için istasyon fişleri. */
export async function listOrderTickets(scope: TenantScope, orderId: string) {
  return prisma.orderTicket.findMany({
    where: { tenantId: scope.tenantId, orderId },
    orderBy: [{ createdAt: "asc" }, { stationName: "asc" }],
    select: { id: true, stationName: true, stationType: true, status: true, createdAt: true, startedAt: true, readyAt: true, cancelledAt: true, items: ticketItemsSelect },
  });
}

/** Ürün editörü › İstasyonlar: şubeler, istasyonları ve ürünün mevcut atamaları. */
export async function getProductStationRouting(scope: TenantScope, productId: string) {
  const [branches, assignments] = await Promise.all([
    listStationsByBranch(scope),
    prisma.productPreparationStation.findMany({ where: { tenantId: scope.tenantId, productId }, select: { branchId: true, stationId: true } }),
  ]);
  return { branches, assignments };
}

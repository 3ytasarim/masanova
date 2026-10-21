import "server-only";
import type { LoyaltyEarnTrigger, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { earnsOnTransition, ledgerSummary, MAX_ADJUSTMENT, pointsForOrder } from "@/lib/crm/loyalty";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { buildAuditRow } from "@/server/services/audit.service";
import { resolveEntitlements } from "@/server/billing/entitlements";

/**
 * Sadakat çekirdeği. Puan DEFTER tabanlıdır (bakiye = satırların toplamı). Kazanım merkezi tek noktadan:
 * sipariş durum geçişi (applyOrderTransition) → earnLoyaltyInTx. Aynı sipariş için ikinci EARN satırı veritabanı
 * benzersizliğiyle (tenant_id, order_id, type) engellenir — yeniden deneme / yarış / tekrar olay çift puan üretmez.
 */
type Tx = Prisma.TransactionClient;

export type LoyaltySettingsView = { enabled: boolean; minorPerPoint: number | null; earnOn: LoyaltyEarnTrigger };
export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettingsView = { enabled: false, minorPerPoint: null, earnOn: "SERVED" };

export async function getLoyaltySettings(tenantId: string, db: Tx | typeof prisma = prisma): Promise<LoyaltySettingsView> {
  const row = await db.loyaltySettings.findUnique({ where: { tenantId }, select: { enabled: true, minorPerPoint: true, earnOn: true } });
  return row ?? DEFAULT_LOYALTY_SETTINGS;
}

/** Sipariş geçişiyle AYNI transaction içinde çağrılır. Kazanılan puan (0 = kayıt yok). */
export async function earnLoyaltyInTx(tx: Tx, input: { tenantId: string; orderId: string; to: OrderStatus }): Promise<number> {
  if (input.to !== "ACCEPTED" && input.to !== "SERVED") return 0;
  const settings = await tx.loyaltySettings.findUnique({ where: { tenantId: input.tenantId }, select: { enabled: true, minorPerPoint: true, earnOn: true } });
  if (!earnsOnTransition(settings, input.to) || !settings) return 0;
  const order = await tx.order.findFirst({ where: { id: input.orderId, tenantId: input.tenantId }, select: { customerId: true, totalMinor: true } });
  if (!order?.customerId) return 0;
  // Paket kapısı (Sprint 20): sadakat yoksa YENİ kazanım yok (bakiye / geçmiş korunur; geri alma her zaman çalışır).
  if (!(await resolveEntitlements(input.tenantId, { db: tx })).has("loyalty")) return 0;
  const account = await tx.loyaltyAccount.findFirst({ where: { tenantId: input.tenantId, customerId: order.customerId, active: true }, select: { id: true } });
  if (!account) return 0;
  const points = pointsForOrder(order.totalMinor, settings.minorPerPoint);
  if (points <= 0) return 0;
  const created = await tx.loyaltyLedger.createMany({
    data: [{ tenantId: input.tenantId, accountId: account.id, type: "EARN", points, orderId: input.orderId }],
    skipDuplicates: true,
  });
  return created.count === 1 ? points : 0;
}

export async function accountSummary(tenantId: string, customerId: string) {
  const account = await prisma.loyaltyAccount.findFirst({ where: { tenantId, customerId }, select: { id: true, active: true, joinedAt: true } });
  if (!account) return null;
  const entries = await prisma.loyaltyLedger.findMany({
    where: { tenantId, accountId: account.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, points: true, reason: true, createdAt: true, order: { select: { orderNumber: true } } },
  });
  return { ...account, ...ledgerSummary(entries), entries };
}

/** Müşteri QR görünümü için yalnızca bakiye (sadakat açık + üyelik aktif değilse null). */
export async function publicPointsBalance(tenantId: string, customerId: string): Promise<number | null> {
  const settings = await getLoyaltySettings(tenantId);
  if (!settings.enabled) return null;
  const account = await prisma.loyaltyAccount.findFirst({ where: { tenantId, customerId, active: true }, select: { id: true } });
  if (!account) return null;
  const sum = await prisma.loyaltyLedger.aggregate({ where: { tenantId, accountId: account.id }, _sum: { points: true } });
  return sum._sum.points ?? 0;
}

export type LoyaltyActor = { scope: TenantScope; userId: string; meta: RequestMeta };

export async function updateLoyaltySettings(actor: LoyaltyActor, input: LoyaltySettingsView): Promise<void> {
  const tenantId = actor.scope.tenantId;
  await prisma.$transaction(async (tx) => {
    const before = await getLoyaltySettings(tenantId, tx);
    await tx.loyaltySettings.upsert({ where: { tenantId }, create: { tenantId, ...input }, update: input });
    await tx.auditLog.create({
      data: buildAuditRow({ action: "LOYALTY_SETTINGS_UPDATED", entity: "LoyaltySettings", entityId: tenantId, tenantId, userId: actor.userId, metadata: { before, after: input } }, actor.meta),
    });
  });
}

export type AdjustResult = { ok: true; balance: number } | { ok: false; reason: "no_account" | "invalid" | "negative_balance" };

/** Manuel düzeltme (sahip / müdür). Bakiye eksiye düşemez. Gerekçe zorunlu (denetimde görünür). */
export async function adjustPoints(actor: LoyaltyActor, customerId: string, points: number, reason: string): Promise<AdjustResult> {
  const tenantId = actor.scope.tenantId;
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > MAX_ADJUSTMENT || !reason.trim()) return { ok: false, reason: "invalid" };
  return prisma.$transaction(async (tx) => {
    const account = await tx.loyaltyAccount.findFirst({ where: { tenantId, customerId }, select: { id: true } });
    if (!account) return { ok: false as const, reason: "no_account" as const };
    // Hesap satırı kilitlenir: eşzamanlı iki düzeltme bakiye denetimini birlikte atlatamaz.
    await tx.$queryRaw`SELECT id FROM loyalty_accounts WHERE id = ${account.id} AND tenant_id = ${tenantId} FOR UPDATE`;
    const sum = await tx.loyaltyLedger.aggregate({ where: { tenantId, accountId: account.id }, _sum: { points: true } });
    const balance = (sum._sum.points ?? 0) + points;
    if (balance < 0) return { ok: false as const, reason: "negative_balance" as const };
    await tx.loyaltyLedger.create({ data: { tenantId, accountId: account.id, type: "ADJUSTMENT", points, reason: reason.trim().slice(0, 200), createdByUserId: actor.userId } });
    await tx.auditLog.create({
      data: buildAuditRow({ action: "LOYALTY_ADJUSTMENT", entity: "LoyaltyAccount", entityId: account.id, tenantId, userId: actor.userId, metadata: { customerRef: customerId, points, balance } }, actor.meta),
    });
    return { ok: true as const, balance };
  });
}

/**
 * Sipariş REJECTED / CANCELLED olduğunda o siparişin EARN ve REDEEM satırları geri alınır: yeni REVERSAL satırı
 * (eski satır değişmez). `reverses_entry_id` benzersiz → aynı satır ikinci kez geri alınamaz (yeniden deneme /
 * yarış güvenli). Kazanılmış puan geri alındığında bakiye eksiye düşebilir; bu durumda yeni ödül alınamaz.
 * Sipariş geçişiyle AYNI transaction'da çağrılır. Kupon kullanımı ayrıca geri alınmaz: iptal edilen siparişin kullanımı
 * sınır sayımına girmez (bkz. resolvePromotion).
 */
export async function reverseLoyaltyInTx(tx: Tx, input: { tenantId: string; orderId: string }): Promise<number> {
  const entries = await tx.loyaltyLedger.findMany({
    where: { tenantId: input.tenantId, orderId: input.orderId, type: { in: ["EARN", "REDEEM"] }, reversedBy: null },
    select: { id: true, accountId: true, points: true, type: true },
  });
  if (!entries.length) return 0;
  const created = await tx.loyaltyLedger.createMany({
    data: entries.map((e) => ({ tenantId: input.tenantId, accountId: e.accountId, type: "REVERSAL" as const, points: -e.points, reversesEntryId: e.id, reason: e.type === "REDEEM" ? "Sipariş iptal: ödül puanı iade" : "Sipariş iptal: kazanılan puan geri alındı" })),
    skipDuplicates: true,
  });
  return created.count;
}

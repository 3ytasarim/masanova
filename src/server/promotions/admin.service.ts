import "server-only";
import { Prisma, type CampaignChannel, type CampaignSegment, type CouponAudience, type CouponStatus, type PromotionScope, type PromotionType } from "@prisma/client";
import type { AuditAction, AuditEntity } from "@/lib/audit/actions";
import { prisma } from "@/lib/db/prisma";
import { currentConsents } from "@/lib/crm/consent";
import { previewAudience, type AudiencePreview, type SegmentCustomer } from "@/lib/promotions/segments";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * Kupon / ödül / kampanya yönetimi (sahip / müdür). Tüm kimlikler KİRACI içinde doğrulanır (şube, ürün, kategori,
 * ücretsiz ürün). Denetim metadata'sında müşteri iletişimi YOK. Kampanya gönderimi YOK; kitle yalnızca SAYI olarak.
 */
export type AdminActor = { scope: TenantScope; userId: string; meta: RequestMeta };
type Tx = Prisma.TransactionClient;

const audit = (tx: Tx, actor: AdminActor, action: AuditAction, entity: AuditEntity, entityId: string, metadata: Record<string, unknown>) =>
  tx.auditLog.create({ data: buildAuditRow({ action, entity, entityId, tenantId: actor.scope.tenantId, userId: actor.userId, metadata }, actor.meta) });

const NOT_VOID = { notIn: ["REJECTED", "CANCELLED"] as ("REJECTED" | "CANCELLED")[] };

// ─── Kuponlar ───────────────────────────────────────────────────────────────

export type CouponInput = {
  code: string;
  codeNormalized: string;
  name: string;
  description: string | null;
  type: PromotionType;
  valueMinor: number | null;
  percentageBps: number | null;
  maxDiscountMinor: number | null;
  minimumOrderMinor: number | null;
  scope: PromotionScope;
  productIds: string[];
  categoryIds: string[];
  freeProductId: string | null;
  branchId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  daysMask: number | null;
  startMinute: number | null;
  endMinute: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  audience: CouponAudience;
  status: CouponStatus;
};

export type SaveResult = { ok: true; id: string } | { ok: false; reason: "duplicate" | "invalid_refs" | "not_found" };

async function refsValid(tx: Tx, tenantId: string, input: Pick<CouponInput, "productIds" | "categoryIds" | "freeProductId" | "branchId">): Promise<boolean> {
  const products = [...new Set([...input.productIds, ...(input.freeProductId ? [input.freeProductId] : [])])];
  const [p, c, b] = await Promise.all([
    products.length ? tx.product.count({ where: { tenantId, id: { in: products } } }) : 0,
    input.categoryIds.length ? tx.menuCategory.count({ where: { tenantId, id: { in: input.categoryIds } } }) : 0,
    input.branchId ? tx.branch.count({ where: { tenantId, id: input.branchId } }) : 0,
  ]);
  return p === products.length && c === new Set(input.categoryIds).size && (!input.branchId || b === 1);
}

function couponData(input: CouponInput) {
  const { productIds: _p, categoryIds: _c, ...rest } = input;
  void _p;
  void _c;
  return rest;
}

export async function saveCoupon(actor: AdminActor, id: string | null, input: CouponInput): Promise<SaveResult> {
  const tenantId = actor.scope.tenantId;
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await refsValid(tx, tenantId, input))) return { ok: false as const, reason: "invalid_refs" as const };
      let couponId = id;
      if (id) {
        const updated = await tx.coupon.updateMany({ where: { id, tenantId, status: { not: "ARCHIVED" } }, data: couponData(input) });
        if (updated.count !== 1) return { ok: false as const, reason: "not_found" as const };
        await tx.couponProduct.deleteMany({ where: { tenantId, couponId: id } });
        await tx.couponCategory.deleteMany({ where: { tenantId, couponId: id } });
      } else {
        couponId = (await tx.coupon.create({ data: { tenantId, ...couponData(input), createdByUserId: actor.userId }, select: { id: true } })).id;
      }
      const cid = couponId!;
      if (input.scope === "PRODUCTS" && input.productIds.length) await tx.couponProduct.createMany({ data: [...new Set(input.productIds)].map((productId) => ({ tenantId, couponId: cid, productId })) });
      if (input.scope === "CATEGORIES" && input.categoryIds.length) await tx.couponCategory.createMany({ data: [...new Set(input.categoryIds)].map((categoryId) => ({ tenantId, couponId: cid, categoryId })) });
      await audit(tx, actor, id ? "COUPON_UPDATED" : "COUPON_CREATED", "Coupon", cid, { code: input.codeNormalized, type: input.type, status: input.status, scope: input.scope });
      return { ok: true as const, id: cid };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, reason: "duplicate" };
    throw error;
  }
}

export async function setCouponStatus(actor: AdminActor, id: string, status: CouponStatus): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const r = await tx.coupon.updateMany({ where: { id, tenantId, status: { not: "ARCHIVED" } }, data: { status } });
    if (r.count !== 1) return false;
    await audit(tx, actor, status === "ARCHIVED" ? "COUPON_ARCHIVED" : "COUPON_UPDATED", "Coupon", id, { status });
    return true;
  });
}

export async function listCoupons(scope: TenantScope) {
  const [coupons, usage] = await Promise.all([
    prisma.coupon.findMany({ where: { tenantId: scope.tenantId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { branch: { select: { name: true } }, freeProduct: { select: { name: true } } } }),
    prisma.couponRedemption.groupBy({ by: ["couponId"], where: { tenantId: scope.tenantId, order: { status: NOT_VOID } }, _count: { _all: true }, _sum: { discountMinor: true } }),
  ]);
  const by = new Map(usage.map((u) => [u.couponId, u]));
  return coupons.map((c) => ({ ...c, used: by.get(c.id)?._count._all ?? 0, discountTotalMinor: by.get(c.id)?._sum.discountMinor ?? 0 }));
}

export async function getCoupon(scope: TenantScope, id: string) {
  return prisma.coupon.findFirst({ where: { id, tenantId: scope.tenantId }, include: { products: { select: { productId: true } }, categories: { select: { categoryId: true } } } });
}

// ─── Sadakat ödülleri ───────────────────────────────────────────────────────

export type RewardInput = {
  name: string;
  description: string | null;
  pointsCost: number;
  rewardType: PromotionType;
  fixedDiscountMinor: number | null;
  percentageBps: number | null;
  maxDiscountMinor: number | null;
  minimumOrderMinor: number | null;
  freeProductId: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export async function saveReward(actor: AdminActor, id: string | null, input: RewardInput): Promise<SaveResult> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    if (input.freeProductId && (await tx.product.count({ where: { tenantId, id: input.freeProductId } })) !== 1) return { ok: false as const, reason: "invalid_refs" as const };
    let rid = id;
    if (id) {
      const r = await tx.loyaltyReward.updateMany({ where: { id, tenantId, archivedAt: null }, data: input });
      if (r.count !== 1) return { ok: false as const, reason: "not_found" as const };
    } else rid = (await tx.loyaltyReward.create({ data: { tenantId, ...input, createdByUserId: actor.userId }, select: { id: true } })).id;
    await audit(tx, actor, id ? "LOYALTY_REWARD_UPDATED" : "LOYALTY_REWARD_CREATED", "LoyaltyReward", rid!, { pointsCost: input.pointsCost, type: input.rewardType, active: input.isActive });
    return { ok: true as const, id: rid! };
  });
}

export async function setRewardState(actor: AdminActor, id: string, state: "active" | "inactive" | "archived"): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const data = state === "archived" ? { isActive: false, archivedAt: new Date() } : { isActive: state === "active" };
    const r = await tx.loyaltyReward.updateMany({ where: { id, tenantId, archivedAt: null }, data });
    if (r.count !== 1) return false;
    await audit(tx, actor, "LOYALTY_REWARD_UPDATED", "LoyaltyReward", id, { state });
    return true;
  });
}

export async function listRewards(scope: TenantScope) {
  const [rewards, usage] = await Promise.all([
    prisma.loyaltyReward.findMany({ where: { tenantId: scope.tenantId }, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { pointsCost: "asc" }], include: { freeProduct: { select: { name: true } } } }),
    prisma.loyaltyLedger.groupBy({ by: ["rewardId"], where: { tenantId: scope.tenantId, type: "REDEEM", reversedBy: null }, _count: { _all: true } }),
  ]);
  const by = new Map(usage.map((u) => [u.rewardId, u._count._all]));
  return rewards.map((r) => ({ ...r, redeemed: by.get(r.id) ?? 0 }));
}

// ─── Kampanyalar ────────────────────────────────────────────────────────────

/** Kitle girdileri: yalnızca sınıflandırma için gereken alanlar (iletişim DEĞERİ değil, VAR / YOK). */
export async function audienceFacts(tenantId: string): Promise<SegmentCustomer[]> {
  const [customers, served, lastOrders] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId },
      select: { id: true, emailNormalized: true, phoneNormalized: true, deletionRequestedAt: true, lastSeenAt: true, preferredLanguage: true, consents: { select: { type: true, status: true, createdAt: true, version: true } }, loyaltyAccounts: { select: { active: true } } },
    }),
    prisma.order.groupBy({ by: ["customerId"], where: { tenantId, customerId: { not: null }, status: "SERVED" }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["customerId"], where: { tenantId, customerId: { not: null } }, _max: { createdAt: true } }),
  ]);
  const servedBy = new Map(served.map((s) => [s.customerId, s._count._all]));
  const lastBy = new Map(lastOrders.map((s) => [s.customerId, s._max.createdAt]));
  return customers.map((c) => {
    const consents = currentConsents(c.consents);
    const last = lastBy.get(c.id) ?? null;
    return {
      consents: Object.fromEntries(Object.entries(consents).map(([k, v]) => [k, v.state])) as SegmentCustomer["consents"],
      hasEmail: !!c.emailNormalized,
      hasPhone: !!c.phoneNormalized,
      deletionRequested: !!c.deletionRequestedAt,
      loyaltyActive: c.loyaltyAccounts.some((a) => a.active),
      servedOrders: servedBy.get(c.id) ?? 0,
      lastVisitAt: last && c.lastSeenAt ? (last > c.lastSeenAt ? last : c.lastSeenAt) : (last ?? c.lastSeenAt),
      preferredLanguage: c.preferredLanguage,
    };
  });
}

export async function campaignAudience(tenantId: string, segment: CampaignSegment, channel: CampaignChannel, now = new Date()): Promise<AudiencePreview> {
  return previewAudience(await audienceFacts(tenantId), segment, channel, now);
}

export type CampaignInput = { name: string; channel: CampaignChannel; segment: CampaignSegment; couponId: string | null; messageTemplate: string };

export async function saveCampaign(actor: AdminActor, id: string | null, input: CampaignInput): Promise<SaveResult> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    if (input.couponId && (await tx.coupon.count({ where: { id: input.couponId, tenantId } })) !== 1) return { ok: false as const, reason: "invalid_refs" as const };
    let cid = id;
    // Düzenleme taslağı DRAFT'a geri alır (READY anlık görüntüsü artık geçersiz).
    if (id) {
      const r = await tx.campaign.updateMany({ where: { id, tenantId, status: { not: "ARCHIVED" } }, data: { ...input, status: "DRAFT", readyAt: null, audienceSnapshot: Prisma.DbNull } });
      if (r.count !== 1) return { ok: false as const, reason: "not_found" as const };
    } else cid = (await tx.campaign.create({ data: { tenantId, ...input, createdByUserId: actor.userId }, select: { id: true } })).id;
    await audit(tx, actor, id ? "CAMPAIGN_UPDATED" : "CAMPAIGN_CREATED", "Campaign", cid!, { channel: input.channel, segment: input.segment, coupon: !!input.couponId });
    return { ok: true as const, id: cid! };
  });
}

/** READY: yalnızca "hazır" işaretidir — GÖNDERİM YOK. O anki kitle sayıları saklanır (kişi listesi değil). */
export async function setCampaignStatus(actor: AdminActor, id: string, status: "READY" | "DRAFT" | "ARCHIVED"): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  const c = await prisma.campaign.findFirst({ where: { id, tenantId, status: { not: "ARCHIVED" } }, select: { segment: true, channel: true } });
  if (!c) return false;
  const snapshot = status === "READY" ? await campaignAudience(tenantId, c.segment, c.channel) : null;
  return prisma.$transaction(async (tx) => {
    const r = await tx.campaign.updateMany({
      where: { id, tenantId, status: { not: "ARCHIVED" } },
      data: { status, readyAt: status === "READY" ? new Date() : null, archivedAt: status === "ARCHIVED" ? new Date() : null, audienceSnapshot: snapshot ? (snapshot as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    if (r.count !== 1) return false;
    await audit(tx, actor, "CAMPAIGN_UPDATED", "Campaign", id, { status, eligible: snapshot?.eligible ?? null });
    return true;
  });
}

export async function listCampaigns(scope: TenantScope) {
  return prisma.campaign.findMany({ where: { tenantId: scope.tenantId }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], include: { coupon: { select: { code: true, status: true } } } });
}

// ─── Analitik / CRM ─────────────────────────────────────────────────────────

/** Promosyon toplamları (kişisel veri yok; ROI / dönüşüm iddiası yok). */
export async function promotionMetrics(scope: TenantScope, range: { from: Date; to: Date; branchId?: string | null }) {
  const orderWhere = { tenantId: scope.tenantId, createdAt: { gte: range.from, lt: range.to }, status: NOT_VOID, ...(range.branchId ? { branchId: range.branchId } : {}) };
  const [totals, withPromo, coupons, rewards, points] = await Promise.all([
    prisma.order.aggregate({ where: orderWhere, _sum: { subtotalMinor: true, discountMinor: true, totalMinor: true }, _count: { _all: true } }),
    prisma.order.count({ where: { ...orderWhere, discountMinor: { gt: 0 } } }),
    prisma.orderPromotion.count({ where: { tenantId: scope.tenantId, kind: "COUPON", order: orderWhere } }),
    prisma.orderPromotion.count({ where: { tenantId: scope.tenantId, kind: "LOYALTY_REWARD", order: orderWhere } }),
    prisma.orderPromotion.aggregate({ where: { tenantId: scope.tenantId, kind: "LOYALTY_REWARD", order: orderWhere }, _sum: { pointsSpent: true } }),
  ]);
  return {
    orders: totals._count._all,
    grossMinor: totals._sum.subtotalMinor ?? 0,
    discountMinor: totals._sum.discountMinor ?? 0,
    netMinor: totals._sum.totalMinor ?? 0,
    ordersWithPromotion: withPromo,
    couponUses: coupons,
    rewardRedemptions: rewards,
    pointsRedeemed: points._sum.pointsSpent ?? 0,
  };
}

export async function customerPromotions(scope: TenantScope, customerId: string) {
  return prisma.orderPromotion.findMany({
    where: { tenantId: scope.tenantId, order: { customerId } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, kind: true, label: true, codeSnapshot: true, discountMinor: true, pointsSpent: true, createdAt: true, order: { select: { id: true, orderNumber: true, status: true, currency: true } } },
  });
}

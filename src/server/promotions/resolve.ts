import "server-only";
import type { Prisma, PromotionType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normalizeCouponCode } from "@/lib/promotions/code";
import { audienceAllows, computeDiscount, scheduleState, usageState, type CartFacts, type CustomerFacts, type PromotionRequest, type PromotionRule } from "@/lib/promotions/engine";
import type { CalculatedLine } from "@/lib/orders/calculate";

/**
 * Promosyon çözümleme — KİRACI İÇİNDE (kod başka kiracıyı tanımlamaz). Sipariş gönderiminde transaction içinde ve
 * KİLİTLE çağrılır (kupon satırı / sadakat hesabı FOR UPDATE): eşzamanlı iki sipariş aynı son kullanımı ya da aynı
 * puanları harcayamaz. Önizlemede kilitsiz (yalnızca tahmin; son karar gönderimde).
 */
type Db = Prisma.TransactionClient | typeof prisma;

export type PromotionFailure =
  | "invalid"
  | "stacking"
  | "not_started"
  | "expired"
  | "outside_hours"
  | "branch"
  | "identified_only"
  | "segment"
  | "usage_limit"
  | "customer_limit"
  | "minimum_not_met"
  | "no_eligible_items"
  | "free_item_missing"
  | "not_identified"
  | "not_member"
  | "insufficient_points"
  | "loyalty_off"
  /** Sprint 20 — paket promosyon (ödülde ayrıca sadakat) içermiyor. */
  | "feature_disabled";

export type ResolvedPromotion = {
  kind: "COUPON" | "LOYALTY_REWARD";
  couponId: string | null;
  rewardId: string | null;
  codeSnapshot: string | null;
  label: string;
  promotionType: PromotionType;
  discountMinor: number;
  pointsCost: number | null;
  loyaltyAccountId: string | null;
  freeItemName: string | null;
};

export type ResolveInput = {
  tenantId: string;
  branchId: string;
  /** Şube saat dilimi; verilmezse yalnızca gerektiğinde (gün / saat penceresi) okunur. */
  timeZone?: string | null;
  customerId: string | null;
  request: PromotionRequest;
  lines: readonly CalculatedLine[];
  subtotalMinor: number;
  now?: Date;
  lock?: boolean;
};

/**
 * Yetkili sepet: ürün → kategori + üst kategoriler (canlı menü ilişkisi; geçmiş sipariş kopyaları değişmez). Kategori
 * sorgusu yalnızca kategori kapsamlı kuralda yapılır (gönderim gecikmesi).
 */
export async function cartFacts(db: Db, tenantId: string, lines: readonly CalculatedLine[], subtotalMinor: number, withCategories = true): Promise<CartFacts> {
  if (!withCategories) {
    return { subtotalMinor, lines: lines.map((l) => ({ productId: l.product?.id ?? null, categoryIds: [], name: l.product?.name ?? "", unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor })) };
  }
  const ids = [...new Set(lines.map((l) => l.product?.id).filter((x): x is string => !!x))];
  const products = ids.length ? await db.product.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, categoryId: true } }) : [];
  const categories = await db.menuCategory.findMany({ where: { tenantId }, select: { id: true, parentId: true } });
  const parent = new Map(categories.map((c) => [c.id, c.parentId]));
  const chain = (id: string) => {
    const out: string[] = [];
    for (let cur: string | null | undefined = id; cur && out.length < 10; cur = parent.get(cur)) out.push(cur);
    return out;
  };
  const catOf = new Map(products.map((p) => [p.id, chain(p.categoryId)]));
  return {
    subtotalMinor,
    lines: lines.map((l) => ({ productId: l.product?.id ?? null, categoryIds: l.product?.id ? (catOf.get(l.product.id) ?? []) : [], name: l.product?.name ?? "", unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor })),
  };
}

async function customerFacts(db: Db, tenantId: string, customerId: string | null, need: { account: boolean; served: boolean }): Promise<CustomerFacts & { accountId: string | null }> {
  if (!customerId) return { identified: false, loyaltyMember: false, servedOrders: 0, accountId: null };
  const account = need.account ? await db.loyaltyAccount.findFirst({ where: { tenantId, customerId, active: true }, select: { id: true } }) : null;
  const served = need.served ? await db.order.count({ where: { tenantId, customerId, status: "SERVED" } }) : 0;
  return { identified: true, loyaltyMember: !!account, servedOrders: served, accountId: account?.id ?? null };
}

async function branchTimeZone(db: Db, input: ResolveInput): Promise<string> {
  if (input.timeZone) return input.timeZone;
  const b = await db.branch.findFirst({ where: { id: input.branchId, tenantId: input.tenantId }, select: { timezone: true } });
  return b?.timezone ?? "Europe/Istanbul";
}

const NOT_VOID = { notIn: ["REJECTED", "CANCELLED"] as ("REJECTED" | "CANCELLED")[] };

export async function resolvePromotion(db: Db, input: ResolveInput): Promise<{ ok: true; promotion: ResolvedPromotion } | { ok: false; reason: PromotionFailure }> {
  const now = input.now ?? new Date();
  if (!input.request) return { ok: false, reason: "invalid" };
  if (input.request.kind === "coupon") {
    const code = normalizeCouponCode(input.request.code);
    if (!code) return { ok: false, reason: "invalid" };
    // Gönderimde kupon satırı TEK sorguyla bulunur + kilitlenir (eşzamanlı son kullanım hakkı tek kez).
    const found = input.lock
      ? (await db.$queryRaw<{ id: string }[]>`SELECT id FROM coupons WHERE tenant_id = ${input.tenantId} AND code_normalized = ${code} FOR UPDATE`)[0]
      : await db.coupon.findUnique({ where: { tenantId_codeNormalized: { tenantId: input.tenantId, codeNormalized: code } }, select: { id: true } });
    if (!found) return { ok: false, reason: "invalid" };
    const c = await db.coupon.findFirst({
      where: { id: found.id, tenantId: input.tenantId },
      include: { products: { select: { productId: true } }, categories: { select: { categoryId: true } }, freeProduct: { select: { name: true } } },
    });
    if (!c || c.status !== "ACTIVE") return { ok: false, reason: "invalid" };
    if (c.branchId && c.branchId !== input.branchId) return { ok: false, reason: "branch" };
    const needsTz = c.daysMask !== null || c.startMinute !== null;
    const state = scheduleState(c, now, needsTz ? await branchTimeZone(db, input) : "UTC");
    if (state !== "active") return { ok: false, reason: state };
    const customer = await customerFacts(db, input.tenantId, input.customerId, { account: c.audience === "LOYALTY_MEMBER", served: c.audience === "REPEAT_CUSTOMER" });
    if (!audienceAllows(c.audience, customer)) return { ok: false, reason: c.audience === "IDENTIFIED" || !customer.identified ? "identified_only" : "segment" };
    // Sayımlar yalnızca sınır tanımlıysa (gecikme); iptal / ret edilen siparişin kullanımı sayılmaz.
    const global = c.usageLimit !== null ? await db.couponRedemption.count({ where: { tenantId: input.tenantId, couponId: c.id, order: { status: NOT_VOID } } }) : 0;
    const mine = c.perCustomerLimit !== null && input.customerId ? await db.couponRedemption.count({ where: { tenantId: input.tenantId, couponId: c.id, customerId: input.customerId, order: { status: NOT_VOID } } }) : null;
    const usage = usageState(c, { global, customer: mine });
    if (usage !== "ok") return { ok: false, reason: usage };
    const rule: PromotionRule = { type: c.type, valueMinor: c.valueMinor, percentageBps: c.percentageBps, maxDiscountMinor: c.maxDiscountMinor, minimumOrderMinor: c.minimumOrderMinor, scope: c.scope, productIds: c.products.map((p) => p.productId), categoryIds: c.categories.map((x) => x.categoryId), freeProductId: c.freeProductId };
    const d = computeDiscount(rule, await cartFacts(db, input.tenantId, input.lines, input.subtotalMinor, c.scope === "CATEGORIES"));
    if (!d.ok) return { ok: false, reason: d.reason };
    return { ok: true, promotion: { kind: "COUPON", couponId: c.id, rewardId: null, codeSnapshot: c.code, label: c.name, promotionType: c.type, discountMinor: d.discountMinor, pointsCost: null, loyaltyAccountId: null, freeItemName: d.freeItemName } };
  }

  // Sadakat ödülü: tanınan + etkin üye + yeterli puan. Anonim ödül YOK.
  if (!input.customerId) return { ok: false, reason: "not_identified" };
  const customer = await customerFacts(db, input.tenantId, input.customerId, { account: true, served: false });
  const settings = await db.loyaltySettings.findUnique({ where: { tenantId: input.tenantId }, select: { enabled: true } });
  if (!settings?.enabled) return { ok: false, reason: "loyalty_off" };
  if (!customer.accountId) return { ok: false, reason: "not_member" };
  const reward = await db.loyaltyReward.findFirst({ where: { id: input.request.rewardId, tenantId: input.tenantId }, include: { freeProduct: { select: { name: true } } } });
  if (!reward || !reward.isActive || reward.archivedAt) return { ok: false, reason: "invalid" };
  const state = scheduleState({ startsAt: reward.startsAt, endsAt: reward.endsAt, daysMask: null, startMinute: null, endMinute: null }, now, "UTC");
  if (state !== "active") return { ok: false, reason: state };
  // Hesap satırı kilitlenir: aynı puanları iki eşzamanlı sipariş harcayamaz (bakiye defterden, kilit altında).
  if (input.lock) await db.$queryRaw`SELECT id FROM loyalty_accounts WHERE id = ${customer.accountId} AND tenant_id = ${input.tenantId} FOR UPDATE`;
  const balance = (await db.loyaltyLedger.aggregate({ where: { tenantId: input.tenantId, accountId: customer.accountId }, _sum: { points: true } }))._sum.points ?? 0;
  if (balance < reward.pointsCost) return { ok: false, reason: "insufficient_points" };
  const rule: PromotionRule = { type: reward.rewardType, valueMinor: reward.fixedDiscountMinor, percentageBps: reward.percentageBps, maxDiscountMinor: reward.maxDiscountMinor, minimumOrderMinor: reward.minimumOrderMinor, scope: "ALL", productIds: [], categoryIds: [], freeProductId: reward.freeProductId };
  const d = computeDiscount(rule, await cartFacts(db, input.tenantId, input.lines, input.subtotalMinor, false));
  if (!d.ok) return { ok: false, reason: d.reason };
  return { ok: true, promotion: { kind: "LOYALTY_REWARD", couponId: null, rewardId: reward.id, codeSnapshot: null, label: reward.name, promotionType: reward.rewardType, discountMinor: d.discountMinor, pointsCost: reward.pointsCost, loyaltyAccountId: customer.accountId, freeItemName: d.freeItemName } };
}

/** Müşterinin şu an alabileceği ödüller (QR sepet). Yalnızca tanınan + etkin üye; bakiye defterden. */
export async function rewardOptions(tenantId: string, customerId: string | null, now = new Date()) {
  if (!customerId) return null;
  const [settings, account] = await Promise.all([
    prisma.loyaltySettings.findUnique({ where: { tenantId }, select: { enabled: true } }),
    prisma.loyaltyAccount.findFirst({ where: { tenantId, customerId, active: true }, select: { id: true } }),
  ]);
  if (!settings?.enabled || !account) return null;
  const [sum, rewards] = await Promise.all([
    prisma.loyaltyLedger.aggregate({ where: { tenantId, accountId: account.id }, _sum: { points: true } }),
    prisma.loyaltyReward.findMany({ where: { tenantId, isActive: true, archivedAt: null, OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] }, orderBy: { pointsCost: "asc" }, select: { id: true, name: true, description: true, pointsCost: true } }),
  ]);
  const balance = sum._sum.points ?? 0;
  return { balance, rewards: rewards.map((r) => ({ ...r, affordable: balance >= r.pointsCost })) };
}

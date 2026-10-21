import "server-only";
import type { Coupon, LoyaltyReward } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { weekdaysOf } from "@/lib/promotions/engine";
import { localParts, minuteLabel } from "@/lib/reservations/time";
import type { CouponDefaults, RewardDefaults } from "@/components/campaigns/campaign-forms";

/** Form seçenekleri (kiracı içi) ve kayıt → form varsayılanı dönüşümleri (kuruş → "12,50", UTC → yerel gün). */
export async function formOptions(tenantId: string) {
  const [products, categories, branches, settings] = await Promise.all([
    prisma.product.findMany({ where: { tenantId, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.menuCategory.findMany({ where: { tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { tenantId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true, defaultCurrency: true } }),
  ]);
  return { products, categories, branches, timeZone: settings?.timezone ?? "Europe/Istanbul", currency: settings?.defaultCurrency ?? "TRY" };
}

export const moneyInput = (minor: number | null) => (minor === null ? "" : minor % 100 ? `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, "0")}` : String(minor / 100));
export const percentInput = (bps: number | null) => (bps === null ? "" : bps % 100 ? `${Math.floor(bps / 100)},${String(bps % 100).padStart(2, "0").replace(/0$/, "")}` : String(bps / 100));
const dayOf = (d: Date | null, tz: string, inclusiveEnd = false) => (d ? localParts(inclusiveEnd ? new Date(d.getTime() - 1) : d, tz).date : "");

export const EMPTY_COUPON: CouponDefaults = { code: "", name: "", description: "", type: "FIXED_AMOUNT", value: "", percent: "", maxDiscount: "", minimumOrder: "", scope: "ALL", productIds: [], categoryIds: [], freeProductId: "", branchId: "", startDate: "", endDate: "", days: [], startTime: "", endTime: "", usageLimit: "", perCustomerLimit: "", audience: "ANYONE", active: false };

export function couponDefaults(c: Coupon & { products: { productId: string }[]; categories: { categoryId: string }[] }, tz: string): CouponDefaults {
  return {
    code: c.code,
    name: c.name,
    description: c.description ?? "",
    type: c.type,
    value: moneyInput(c.valueMinor),
    percent: percentInput(c.percentageBps),
    maxDiscount: moneyInput(c.maxDiscountMinor),
    minimumOrder: moneyInput(c.minimumOrderMinor),
    scope: c.scope,
    productIds: c.products.map((p) => p.productId),
    categoryIds: c.categories.map((x) => x.categoryId),
    freeProductId: c.freeProductId ?? "",
    branchId: c.branchId ?? "",
    startDate: dayOf(c.startsAt, tz),
    endDate: dayOf(c.endsAt, tz, true),
    days: c.daysMask === null ? [] : weekdaysOf(c.daysMask),
    startTime: c.startMinute === null ? "" : minuteLabel(c.startMinute),
    endTime: c.endMinute === null ? "" : c.endMinute === 1440 ? "24:00" : minuteLabel(c.endMinute),
    usageLimit: c.usageLimit?.toString() ?? "",
    perCustomerLimit: c.perCustomerLimit?.toString() ?? "",
    audience: c.audience,
    active: c.status === "ACTIVE",
  };
}

export const EMPTY_REWARD: RewardDefaults = { name: "", description: "", pointsCost: "", type: "FIXED_AMOUNT", value: "", percent: "", maxDiscount: "", minimumOrder: "", freeProductId: "", startDate: "", endDate: "", active: true };

export function rewardDefaults(r: LoyaltyReward, tz: string): RewardDefaults {
  return {
    name: r.name,
    description: r.description ?? "",
    pointsCost: String(r.pointsCost),
    type: r.rewardType,
    value: moneyInput(r.fixedDiscountMinor),
    percent: percentInput(r.percentageBps),
    maxDiscount: moneyInput(r.maxDiscountMinor),
    minimumOrder: moneyInput(r.minimumOrderMinor),
    freeProductId: r.freeProductId ?? "",
    startDate: dayOf(r.startsAt, tz),
    endDate: dayOf(r.endsAt, tz, true),
    active: r.isActive,
  };
}

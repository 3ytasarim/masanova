import { localParts } from "@/lib/reservations/time";

/**
 * Promosyon hesaplayıcı — SAF ve deterministik. Sunucu, sipariş transaction'ı içinde YETKİLİ katalog fiyatlarıyla
 * çalıştırır; tarayıcının gönderdiği indirim / toplam asla kullanılmaz. Para tamsayı kuruş, yüzde baz puan (1000 = %10);
 * kayan nokta yok. İndirim ara toplamı aşamaz → toplam eksiye düşemez.
 */
export type PromotionTypeName = "FIXED_AMOUNT" | "PERCENTAGE" | "FREE_ITEM";
export type PromotionScopeName = "ALL" | "PRODUCTS" | "CATEGORIES";

export type PromotionRule = {
  type: PromotionTypeName;
  valueMinor: number | null;
  percentageBps: number | null;
  maxDiscountMinor: number | null;
  minimumOrderMinor: number | null;
  scope: PromotionScopeName;
  productIds: readonly string[];
  categoryIds: readonly string[];
  freeProductId: string | null;
};

/** Yetkili fiyatlı sepet satırı. categoryIds = ürünün kategorisi + üst kategorileri (canlı menü ilişkisi). */
export type PricedLine = { productId: string | null; categoryIds: readonly string[]; name: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number };
export type CartFacts = { subtotalMinor: number; lines: readonly PricedLine[] };

export type DiscountFailure = "minimum_not_met" | "no_eligible_items" | "free_item_missing";
export type DiscountResult = { ok: true; discountMinor: number; freeItemName: string | null } | { ok: false; reason: DiscountFailure };

export const BPS_DENOMINATOR = 10_000;

export function lineInScope(rule: Pick<PromotionRule, "scope" | "productIds" | "categoryIds">, line: PricedLine): boolean {
  if (rule.scope === "ALL") return true;
  if (rule.scope === "PRODUCTS") return !!line.productId && rule.productIds.includes(line.productId);
  return line.categoryIds.some((c) => rule.categoryIds.includes(c));
}

export function computeDiscount(rule: PromotionRule, cart: CartFacts): DiscountResult {
  if (rule.minimumOrderMinor !== null && cart.subtotalMinor < rule.minimumOrderMinor) return { ok: false, reason: "minimum_not_met" };
  let discount: number;
  let freeItemName: string | null = null;
  if (rule.type === "FREE_ITEM") {
    // Yapılandırılmış ürün sepette olmalı; adet değiştirilmez, BİR birimi ücretsiz olur (en ucuz eşleşen satır).
    const matches = cart.lines.filter((l) => l.productId === rule.freeProductId && l.quantity > 0);
    if (!matches.length) return { ok: false, reason: "free_item_missing" };
    const cheapest = matches.reduce((a, b) => (b.unitPriceMinor < a.unitPriceMinor ? b : a));
    discount = cheapest.unitPriceMinor;
    freeItemName = cheapest.name;
  } else {
    const eligible = cart.lines.filter((l) => lineInScope(rule, l)).reduce((s, l) => s + l.lineTotalMinor, 0);
    if (eligible <= 0) return { ok: false, reason: "no_eligible_items" };
    if (rule.type === "FIXED_AMOUNT") discount = Math.min(rule.valueMinor ?? 0, eligible);
    else discount = Math.floor((eligible * (rule.percentageBps ?? 0)) / BPS_DENOMINATOR);
    if (rule.maxDiscountMinor !== null) discount = Math.min(discount, rule.maxDiscountMinor);
  }
  discount = Math.max(0, Math.min(discount, cart.subtotalMinor));
  return { ok: true, discountMinor: discount, freeItemName };
}

// ─── Zaman penceresi (şube saat dilimi) ─────────────────────────────────────

export type Schedule = { startsAt: Date | null; endsAt: Date | null; daysMask: number | null; startMinute: number | null; endMinute: number | null };
export type ScheduleState = "active" | "not_started" | "expired" | "outside_hours";

/** Tarih aralığı UTC; gün / saat penceresi şubenin YEREL saatiyle (DST dahil) değerlendirilir. */
export function scheduleState(s: Schedule, now: Date, timeZone: string): ScheduleState {
  if (s.startsAt && now < s.startsAt) return "not_started";
  if (s.endsAt && now >= s.endsAt) return "expired";
  if (s.daysMask !== null || s.startMinute !== null) {
    const { weekday, minute } = localParts(now, timeZone);
    if (s.daysMask !== null && (s.daysMask & (1 << (weekday - 1))) === 0) return "outside_hours";
    if (s.startMinute !== null && s.endMinute !== null && (minute < s.startMinute || minute >= s.endMinute)) return "outside_hours";
  }
  return "active";
}

export function daysMaskOf(weekdays: readonly number[]): number | null {
  const mask = weekdays.reduce((m, d) => (d >= 1 && d <= 7 ? m | (1 << (d - 1)) : m), 0);
  return mask === 0 || mask === 127 ? null : mask;
}

export function weekdaysOf(mask: number | null): number[] {
  if (mask === null) return [1, 2, 3, 4, 5, 6, 7];
  return [1, 2, 3, 4, 5, 6, 7].filter((d) => (mask & (1 << (d - 1))) !== 0);
}

// ─── Kitle ve kullanım ──────────────────────────────────────────────────────

export type AudienceName = "ANYONE" | "IDENTIFIED" | "LOYALTY_MEMBER" | "REPEAT_CUSTOMER";
export type CustomerFacts = { identified: boolean; loyaltyMember: boolean; servedOrders: number };
export const REPEAT_MIN_SERVED = 2;

export function audienceAllows(audience: AudienceName, c: CustomerFacts): boolean {
  switch (audience) {
    case "ANYONE":
      return true;
    case "IDENTIFIED":
      return c.identified;
    case "LOYALTY_MEMBER":
      return c.identified && c.loyaltyMember;
    case "REPEAT_CUSTOMER":
      return c.identified && c.servedOrders >= REPEAT_MIN_SERVED;
  }
}

/**
 * Kullanım sınırları. Kişi başı sınır YALNIZCA tanınan müşteride uygulanabilir (anonim kullanımı güvenilir biçimde
 * ayırt etmenin yolu yoktur — belgelenmiştir); kişi başı sınırı olan kupon anonim kullanıma kapalı değildir, ancak
 * işletme kuponu "yalnızca tanınan müşteri" yapabilir.
 */
export function usageState(limits: { usageLimit: number | null; perCustomerLimit: number | null }, used: { global: number; customer: number | null }): "ok" | "usage_limit" | "customer_limit" {
  if (limits.usageLimit !== null && used.global >= limits.usageLimit) return "usage_limit";
  if (limits.perCustomerLimit !== null && used.customer !== null && used.customer >= limits.perCustomerLimit) return "customer_limit";
  return "ok";
}

// ─── Yığma yok ──────────────────────────────────────────────────────────────

export type PromotionRequest = { kind: "coupon"; code: string } | { kind: "reward"; rewardId: string } | null;

/** Sipariş başına TEK promosyon: kupon YA DA ödül. İkisi birden → ret (veritabanında da order_id benzersiz). */
export function exclusivePromotion(input: { couponCode?: string | null; rewardId?: string | null }): PromotionRequest | "stacking" {
  const code = input.couponCode?.trim();
  if (code && input.rewardId) return "stacking";
  if (code) return { kind: "coupon", code };
  if (input.rewardId) return { kind: "reward", rewardId: input.rewardId };
  return null;
}

export function formatPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac ? `%${whole},${String(frac).padStart(2, "0").replace(/0$/, "")}` : `%${whole}`;
}

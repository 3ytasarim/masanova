import { describe, expect, it } from "vitest";
import { ledgerSummary } from "@/lib/crm/loyalty";
import { normalizeCouponCode } from "@/lib/promotions/code";
import { audienceAllows, computeDiscount, daysMaskOf, exclusivePromotion, formatPercent, scheduleState, usageState, weekdaysOf, type CartFacts, type PromotionRule } from "@/lib/promotions/engine";
import { classify, previewAudience, type SegmentCustomer } from "@/lib/promotions/segments";
import { renderTemplate, templateProblems } from "@/lib/promotions/template";
import { zonedLocalToUtc } from "@/lib/reservations/time";

/** Sprint 18 — promosyon saf kuralları. Para kuruş, yüzde baz puan. */
const rule = (over: Partial<PromotionRule> = {}): PromotionRule => ({ type: "FIXED_AMOUNT", valueMinor: 10_000, percentageBps: null, maxDiscountMinor: null, minimumOrderMinor: null, scope: "ALL", productIds: [], categoryIds: [], freeProductId: null, ...over });
const cart = (lines: { id: string; cats?: string[]; unit: number; qty?: number; name?: string }[]): CartFacts => {
  const ls = lines.map((l) => ({ productId: l.id, categoryIds: l.cats ?? [], name: l.name ?? l.id, unitPriceMinor: l.unit, quantity: l.qty ?? 1, lineTotalMinor: l.unit * (l.qty ?? 1) }));
  return { subtotalMinor: ls.reduce((s, l) => s + l.lineTotalMinor, 0), lines: ls };
};
const zoned = (date: string, minute: number, tz: string) => {
  const r = zonedLocalToUtc(date, minute, tz);
  if (r.kind === "missing") throw new Error("missing");
  return r.at;
};

describe("kupon kodu", () => {
  it("kırpılır, büyük harf, Türkçe harfler ASCII, boşluk atılır", () => {
    expect(normalizeCouponCode("  yaz10 ")).toBe("YAZ10");
    expect(normalizeCouponCode("İndirim-50")).toBe("INDIRIM-50");
    expect(normalizeCouponCode("şeker ğüç")).toBe("SEKERGUC");
    expect(normalizeCouponCode("yaz_10")).toBe("YAZ_10");
  });
  it("güvensiz / geçersiz kod reddedilir (SQL / HTML parçası dahil)", () => {
    for (const bad of ["", "ab", "x".repeat(25), "' OR 1=1 --", "<b>X</b>", "YAZ%10", "a;b", null, 42]) expect(normalizeCouponCode(bad)).toBeNull();
  });
});

describe("indirim hesabı", () => {
  it("sabit tutar; ara toplamı aşamaz (toplam eksi olmaz)", () => {
    expect(computeDiscount(rule(), cart([{ id: "a", unit: 30_000 }]))).toEqual({ ok: true, discountMinor: 10_000, freeItemName: null });
    expect(computeDiscount(rule({ valueMinor: 50_000 }), cart([{ id: "a", unit: 30_000 }]))).toMatchObject({ discountMinor: 30_000 });
  });
  it("yüzde baz puanla, aşağı yuvarlanır; tavan uygulanır", () => {
    expect(computeDiscount(rule({ type: "PERCENTAGE", valueMinor: null, percentageBps: 1000 }), cart([{ id: "a", unit: 33_333 }]))).toMatchObject({ discountMinor: 3_333 });
    expect(computeDiscount(rule({ type: "PERCENTAGE", valueMinor: null, percentageBps: 1250 }), cart([{ id: "a", unit: 10_001 }]))).toMatchObject({ discountMinor: 1_250 });
    expect(computeDiscount(rule({ type: "PERCENTAGE", valueMinor: null, percentageBps: 1000, maxDiscountMinor: 20_000 }), cart([{ id: "a", unit: 500_000 }]))).toMatchObject({ discountMinor: 20_000 });
    expect(computeDiscount(rule({ type: "PERCENTAGE", valueMinor: null, percentageBps: 10_000 }), cart([{ id: "a", unit: 4_500 }]))).toMatchObject({ discountMinor: 4_500 });
  });
  it("en az sepet YETKİLİ ara toplamla", () => {
    expect(computeDiscount(rule({ minimumOrderMinor: 50_000 }), cart([{ id: "a", unit: 49_999 }]))).toEqual({ ok: false, reason: "minimum_not_met" });
    expect(computeDiscount(rule({ minimumOrderMinor: 50_000 }), cart([{ id: "a", unit: 50_000 }])).ok).toBe(true);
  });
  it("ürün / kategori kapsamı yalnızca uygun satırlara uygulanır (üst kategori dahil)", () => {
    const c = cart([{ id: "burger", cats: ["ana"], unit: 30_000 }, { id: "ayran", cats: ["icecek", "menu"], unit: 5_000, qty: 2 }]);
    expect(computeDiscount(rule({ type: "PERCENTAGE", valueMinor: null, percentageBps: 5000, scope: "PRODUCTS", productIds: ["ayran"] }), c)).toMatchObject({ discountMinor: 5_000 });
    expect(computeDiscount(rule({ type: "PERCENTAGE", valueMinor: null, percentageBps: 1000, scope: "CATEGORIES", categoryIds: ["menu"] }), c)).toMatchObject({ discountMinor: 1_000 });
    expect(computeDiscount(rule({ scope: "PRODUCTS", productIds: ["cay"] }), c)).toEqual({ ok: false, reason: "no_eligible_items" });
    expect(computeDiscount(rule({ valueMinor: 50_000, scope: "PRODUCTS", productIds: ["ayran"] }), c)).toMatchObject({ discountMinor: 10_000 });
  });
  it("ücretsiz ürün: yapılandırılmış ürün sepette olmalı, en ucuz bir birim; adet değişmez", () => {
    const r = rule({ type: "FREE_ITEM", valueMinor: null, freeProductId: "tatli" });
    expect(computeDiscount(r, cart([{ id: "burger", unit: 30_000 }]))).toEqual({ ok: false, reason: "free_item_missing" });
    expect(computeDiscount(r, cart([{ id: "tatli", unit: 12_000, qty: 2, name: "Sütlaç" }, { id: "tatli", unit: 9_000, name: "Sütlaç (küçük)" }]))).toEqual({ ok: true, discountMinor: 9_000, freeItemName: "Sütlaç (küçük)" });
  });
});

describe("zaman penceresi (şube saat dilimi, DST)", () => {
  const tz = "Europe/Istanbul";
  const s = { startsAt: zoned("2026-06-01", 0, tz), endsAt: zoned("2026-07-01", 0, tz), daysMask: daysMaskOf([1, 2, 3, 4, 5]), startMinute: 12 * 60, endMinute: 15 * 60 };
  it("başlamadı / bitti / gün-saat dışı / etkin", () => {
    expect(scheduleState(s, zoned("2026-05-31", 13 * 60, tz), tz)).toBe("not_started");
    expect(scheduleState(s, zoned("2026-07-01", 0, tz), tz)).toBe("expired");
    expect(scheduleState(s, zoned("2026-06-06", 13 * 60, tz), tz)).toBe("outside_hours"); // cumartesi
    expect(scheduleState(s, zoned("2026-06-10", 15 * 60, tz), tz)).toBe("outside_hours"); // 15:00 dahil değil
    expect(scheduleState(s, zoned("2026-06-10", 14 * 60 + 59, tz), tz)).toBe("active");
  });
  it("Berlin yaz saati: yerel 12:00–15:00 penceresi DST geçişinde de yerel saatle", () => {
    const b = { startsAt: null, endsAt: null, daysMask: null, startMinute: 12 * 60, endMinute: 15 * 60 };
    // Aynı UTC saati (13:30Z): 28 Mart CET → yerel 14:30 (içeride); 29 Mart CEST → yerel 15:30 (dışarıda)
    expect(scheduleState(b, new Date("2026-03-28T13:30:00Z"), "Europe/Berlin")).toBe("active");
    expect(scheduleState(b, new Date("2026-03-29T13:30:00Z"), "Europe/Berlin")).toBe("outside_hours");
  });
  it("gün maskesi dönüşümleri", () => {
    expect(daysMaskOf([])).toBeNull();
    expect(daysMaskOf([1, 2, 3, 4, 5, 6, 7])).toBeNull();
    expect(weekdaysOf(daysMaskOf([6, 7]))).toEqual([6, 7]);
  });
});

describe("kitle, kullanım, yığma", () => {
  it("kitle kuralları; anonim üye-only kuponu kullanamaz", () => {
    const anon = { identified: false, loyaltyMember: false, servedOrders: 0 };
    const member = { identified: true, loyaltyMember: true, servedOrders: 1 };
    expect(audienceAllows("ANYONE", anon)).toBe(true);
    expect(audienceAllows("IDENTIFIED", anon)).toBe(false);
    expect(audienceAllows("LOYALTY_MEMBER", member)).toBe(true);
    expect(audienceAllows("REPEAT_CUSTOMER", member)).toBe(false);
    expect(audienceAllows("REPEAT_CUSTOMER", { ...member, servedOrders: 2 })).toBe(true);
  });
  it("toplam ve kişi başı sınır; anonimde kişi başı uygulanamaz", () => {
    expect(usageState({ usageLimit: 3, perCustomerLimit: null }, { global: 3, customer: null })).toBe("usage_limit");
    expect(usageState({ usageLimit: 3, perCustomerLimit: 1 }, { global: 2, customer: 1 })).toBe("customer_limit");
    expect(usageState({ usageLimit: null, perCustomerLimit: 1 }, { global: 99, customer: null })).toBe("ok");
  });
  it("tek promosyon: kupon + ödül birlikte reddedilir", () => {
    expect(exclusivePromotion({ couponCode: "YAZ10", rewardId: "r1" })).toBe("stacking");
    expect(exclusivePromotion({ couponCode: "  " })).toBeNull();
    expect(exclusivePromotion({ rewardId: "r1" })).toEqual({ kind: "reward", rewardId: "r1" });
  });
  it("yüzde gösterimi", () => {
    expect(formatPercent(1000)).toBe("%10");
    expect(formatPercent(1250)).toBe("%12,5");
    expect(formatPercent(1005)).toBe("%10,05");
  });
});

describe("sadakat defteri", () => {
  const d = (m: number) => new Date(Date.UTC(2026, 9, 1, 12, m));
  it("bakiye: kazanım − kullanım + geri alma (eski satır değişmez)", () => {
    const entries = [
      { type: "EARN" as const, points: 600, createdAt: d(1) },
      { type: "REDEEM" as const, points: -500, createdAt: d(2) },
      { type: "REVERSAL" as const, points: 500, createdAt: d(3) }, // sipariş iptal → ödül puanı iade
    ];
    expect(ledgerSummary(entries).balance).toBe(600);
    expect(ledgerSummary(entries.slice(0, 2)).balance).toBe(100);
  });
});

describe("kampanya kitlesi ve onay", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const base: SegmentCustomer = { consents: { PRIVACY: "GRANTED", LOYALTY: "GRANTED", MARKETING_EMAIL: "GRANTED", MARKETING_SMS: "NONE", MARKETING_WHATSAPP: "REVOKED" }, hasEmail: true, hasPhone: true, deletionRequested: false, loyaltyActive: true, servedOrders: 3, lastVisitAt: new Date("2026-10-01T00:00:00Z"), preferredLanguage: "tr" };
  it("kanal onayı: yalnızca GÜNCEL izin; hiç verilmemiş ya da geri alınmış hariç", () => {
    expect(classify(base, "ALL_OPTED_IN", "EMAIL", now)).toBe("eligible");
    expect(classify(base, "ALL_OPTED_IN", "SMS", now)).toBe("no_consent");
    expect(classify(base, "ALL_OPTED_IN", "WHATSAPP", now)).toBe("no_consent");
    expect(classify({ ...base, hasEmail: false }, "ALL_OPTED_IN", "EMAIL", now)).toBe("missing_contact");
    expect(classify({ ...base, deletionRequested: true }, "ALL_OPTED_IN", "EMAIL", now)).toBe("deletion_requested");
  });
  it("segment kuralları", () => {
    expect(classify(base, "REPEAT_CUSTOMERS", "EMAIL", now)).toBe("eligible");
    expect(classify(base, "HIGH_ORDER_COUNT", "EMAIL", now)).toBe("not_in_segment");
    expect(classify(base, "NO_VISIT_30_DAYS", "EMAIL", now)).toBe("not_in_segment");
    expect(classify({ ...base, lastVisitAt: new Date("2026-09-01T00:00:00Z") }, "NO_VISIT_30_DAYS", "EMAIL", now)).toBe("eligible");
    expect(classify(base, "LANGUAGE_EN", "EMAIL", now)).toBe("not_in_segment");
    expect(classify({ ...base, loyaltyActive: false }, "LOYALTY_MEMBERS", "EMAIL", now)).toBe("not_in_segment");
  });
  it("önizleme sayıları", () => {
    const p = previewAudience([base, { ...base, consents: { ...base.consents, MARKETING_EMAIL: "REVOKED" } }, { ...base, hasEmail: false }, { ...base, deletionRequested: true }], "ALL_OPTED_IN", "EMAIL", now);
    expect(p).toEqual({ eligible: 1, inSegment: 3, noConsent: 1, missingContact: 1, deletionRequested: 1 });
  });
  it("şablon: yalnız beyaz liste; bilinmeyen alan engellenir; kod yürütülmez", () => {
    expect(templateProblems("Merhaba {{firstName}}, kod: {{couponCode}}")).toEqual([]);
    expect(templateProblems("{{constructor}} {{ process.env.SECRET }}")).toHaveLength(2);
    expect(renderTemplate("Merhaba {{ firstName }} — {{restaurantName}} {{couponCode}}", { firstName: "Ayşe", restaurantName: "Köşe", couponCode: "YAZ10" })).toBe("Merhaba Ayşe — Köşe YAZ10");
    expect(renderTemplate("{{unknown}}", {})).toBe("{{unknown}}");
  });
});

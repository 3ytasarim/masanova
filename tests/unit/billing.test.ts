import { describe, expect, it } from "vitest";
import { FALLBACK_PLAN, GRACE_DAYS, GRACE_DISABLED_FEATURES } from "@/config/billing";
import { FEATURES, LIMIT_KEYS, PLANS, PLAN_ORDER, minimumPlanFor, planHasFeature } from "@/config/plans";
import { graceEnd, limitAllows, resolveBilling, resolveState, usageLevel, usagePeriod, type SubscriptionInput } from "@/lib/billing/engine";
import { planCards } from "@/lib/marketing/plans";
import { NAV_BY_AREA, navState } from "@/config/navigation";

/** Sprint 20 — faturalama durum motoru (saf), paket haritası, limitler, gezinme politikası. */
const DAY = 86_400_000;
const now = new Date("2026-10-13T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);
const sub = (over: Partial<SubscriptionInput> = {}): SubscriptionInput => ({ plan: "PRO", status: "ACTIVE", internal: false, currentPeriodStart: at(-10), currentPeriodEnd: at(20), trialEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false, ...over });

describe("paket / özellik haritası (tek kaynak)", () => {
  it("niyet edilen harita: STARTER ⊂ PRO ⊂ AI", () => {
    expect([...PLANS.STARTER.features].sort()).toEqual(["branding", "qr_labels", "qr_menu", "tables"]);
    for (const f of ["ordering", "kds", "preparation_stations", "service_requests", "analytics", "reservations", "crm", "loyalty", "promotions", "restaurant_payments"] as const) {
      expect(planHasFeature("STARTER", f)).toBe(false);
      expect(planHasFeature("PRO", f)).toBe(true);
    }
    for (const f of ["voice_ai", "business_advisor"] as const) {
      expect(planHasFeature("PRO", f)).toBe(false);
      expect(planHasFeature("AI", f)).toBe(true);
    }
    expect(FEATURES.every((f) => planHasFeature("AI", f))).toBe(true);
    expect(minimumPlanFor("analytics")).toBe("PRO");
    expect(minimumPlanFor("voice_ai")).toBe("AI");
  });
  it("her paket her limiti tanımlar (null = sınırsız); STARTER tek şube; AI kullanım limiti PRO'da 0", () => {
    for (const p of PLAN_ORDER) for (const k of LIMIT_KEYS) expect(k in PLANS[p].limits).toBe(true);
    expect(PLANS.STARTER.limits.maxBranches).toBe(1);
    expect(PLANS.PRO.limits.maxMonthlyAiMinutes).toBe(0);
    expect(PLANS.PRO.limits.maxTables).toBeNull();
  });
  it("pazarlama kartları aynı haritadan; fiyat uydurulmaz; doğrulanmamış online ödeme vaat edilmez", () => {
    const cards = planCards();
    expect(cards.map((c) => c.plan)).toEqual(["STARTER", "PRO", "AI"]);
    expect(cards.every((c) => c.priceLabel === "Fiyat için iletişime geçin")).toBe(true);
    expect(JSON.stringify(cards)).not.toMatch(/online ödeme|₺|\$|€/i);
    expect(cards[2]!.adds).toContain("AI İşletme Danışmanı");
  });
});

describe("durum motoru", () => {
  it("abonelik yok → NONE, güvenli varsayılan STARTER", () => {
    const r = resolveBilling(null, [], now);
    expect(r).toMatchObject({ state: "NONE", effectivePlan: FALLBACK_PLAN });
    expect(r.features.has("ordering")).toBe(false);
  });
  it("aktif dönem: abone olunan paket", () => {
    const r = resolveBilling(sub(), [], now);
    expect(r).toMatchObject({ state: "ACTIVE", effectivePlan: "PRO", endsAt: at(20), warning: null });
    expect(r.features.has("ordering") && !r.features.has("voice_ai")).toBe(true);
  });
  it("iç / süresiz abonelik süresi dolmaz", () => {
    expect(resolveState(sub({ internal: true, currentPeriodEnd: at(-100) }), now).state).toBe("ACTIVE");
    expect(resolveState(sub({ currentPeriodEnd: null }), now).state).toBe("ACTIVE");
  });
  it("deneme aktif: tüm AI özellikleri; bitişe 3 gün kala sahibe uyarı", () => {
    const r = resolveBilling(sub({ plan: "AI", status: "TRIALING", trialEndsAt: at(2), currentPeriodEnd: null }), [], now);
    expect(r).toMatchObject({ state: "TRIALING", effectivePlan: "AI", warning: "trial_ending" });
    expect(r.features.has("voice_ai") && r.features.has("business_advisor")).toBe(true);
  });
  it("deneme bitti: ek süre YOK → STARTER, kod trial_expired; veri politikası saklama", () => {
    const r = resolveBilling(sub({ plan: "AI", status: "TRIALING", trialEndsAt: at(-0.001), currentPeriodEnd: null }), [], now);
    expect(r).toMatchObject({ state: "TRIAL_EXPIRED", effectivePlan: "STARTER", denial: "trial_expired", warning: "trial_expired" });
    expect(r.features.has("qr_menu") && !r.features.has("ordering")).toBe(true);
  });
  it("dönem bitti → ek süre (GRACE_DAYS): paket sürer, AI kapanır; ek süre bitti → STARTER (subscription_expired)", () => {
    const g = resolveBilling(sub({ plan: "AI", currentPeriodEnd: at(-1) }), [], now);
    expect(g).toMatchObject({ state: "GRACE", effectivePlan: "AI", warning: "grace" });
    expect(g.endsAt).toEqual(at(GRACE_DAYS - 1));
    expect(g.features.has("ordering")).toBe(true);
    for (const f of GRACE_DISABLED_FEATURES) expect(g.features.has(f)).toBe(false);
    const e = resolveBilling(sub({ plan: "AI", currentPeriodEnd: at(-(GRACE_DAYS + 1)) }), [], now);
    expect(e).toMatchObject({ state: "EXPIRED", effectivePlan: "STARTER", denial: "subscription_expired" });
  });
  it("ödeme gecikti (PAST_DUE) → kayıtlı ek süre sonuna kadar GRACE", () => {
    expect(resolveState(sub({ status: "PAST_DUE", graceEndsAt: at(3) }), now)).toEqual({ state: "GRACE", endsAt: at(3) });
    expect(resolveState(sub({ status: "PAST_DUE", graceEndsAt: at(-1) }), now).state).toBe("EXPIRED");
    expect(graceEnd({ graceEndsAt: null, currentPeriodEnd: at(0) })).toEqual(at(GRACE_DAYS));
  });
  it("dönem sonunda iptal: dönem bitene kadar hak sürer, sonra ek süre olmadan biter", () => {
    expect(resolveBilling(sub({ cancelAtPeriodEnd: true }), [], now)).toMatchObject({ state: "ACTIVE", cancelScheduled: true });
    expect(resolveState(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) }), now).state).toBe("EXPIRED");
    expect(resolveState(sub({ status: "CANCELLED", currentPeriodEnd: at(5) }), now).state).toBe("ACTIVE");
    expect(resolveState(sub({ status: "CANCELLED", currentPeriodEnd: at(-1) }), now).state).toBe("EXPIRED");
  });
  it("askıya alma / süresi doldu kaydı → STARTER", () => {
    expect(resolveBilling(sub({ status: "SUSPENDED" }), [], now)).toMatchObject({ state: "SUSPENDED", effectivePlan: "STARTER", denial: "subscription_expired" });
    expect(resolveBilling(sub({ status: "EXPIRED" }), [], now).effectivePlan).toBe("STARTER");
  });
  it("yükseltme / düşürme anında: aynı motor, yeni paket", () => {
    expect(resolveBilling(sub({ plan: "STARTER" }), [], now).features.has("ordering")).toBe(false);
    expect(resolveBilling(sub({ plan: "AI" }), [], now).features.has("voice_ai")).toBe(true);
    expect(resolveBilling(sub({ plan: "PRO" }), [], now).features.has("voice_ai")).toBe(false);
  });
  it("istisnalar: özellik aç / kapa, limit (−1 sınırsız), süresi dolan yok sayılır", () => {
    const r = resolveBilling(
      sub({ plan: "STARTER" }),
      [
        { key: "ordering", enabled: true, limitValue: null, expiresAt: null },
        { key: "qr_labels", enabled: false, limitValue: null, expiresAt: null },
        { key: "maxBranches", enabled: null, limitValue: -1, expiresAt: null },
        { key: "maxTables", enabled: null, limitValue: 3, expiresAt: null },
        { key: "voice_ai", enabled: true, limitValue: null, expiresAt: at(-1) },
        { key: "bogus", enabled: true, limitValue: null, expiresAt: null },
      ],
      now,
    );
    expect(r.features.has("ordering")).toBe(true);
    expect(r.features.has("qr_labels")).toBe(false);
    expect(r.features.has("voice_ai")).toBe(false);
    expect(r.limits.maxBranches).toBeNull();
    expect(r.limits.maxTables).toBe(3);
  });
});

describe("limitler ve kullanım", () => {
  it("limit kararı: null sınırsız; son slot; toplu ekleme", () => {
    expect(limitAllows(null, 1e9)).toBe(true);
    expect(limitAllows(10, 9)).toBe(true);
    expect(limitAllows(10, 10)).toBe(false);
    expect(limitAllows(10, 8, 3)).toBe(false);
    expect(limitAllows(0, 0)).toBe(false);
  });
  it("uyarı seviyeleri 80 / 90 / 100 (engel yalnızca 100)", () => {
    expect(usageLevel(10, 7)).toEqual({ percent: 70, level: 0 });
    expect(usageLevel(10, 8)).toEqual({ percent: 80, level: 80 });
    expect(usageLevel(10, 9)).toEqual({ percent: 90, level: 90 });
    expect(usageLevel(10, 10)).toEqual({ percent: 100, level: 100 });
    expect(usageLevel(null, 999)).toEqual({ percent: null, level: 0 });
    expect(usageLevel(0, 0).level).toBe(100);
  });
  it("kullanım dönemi: abonelik dönemi; iç / süresiz ya da dönem dışı → UTC takvim ayı", () => {
    expect(usagePeriod(sub(), now)).toEqual({ start: at(-10), end: at(20), kind: "subscription" });
    expect(usagePeriod(sub({ internal: true }), now).kind).toBe("calendar_month");
    expect(usagePeriod(null, now)).toEqual({ start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z"), kind: "calendar_month" });
  });
});

describe("gezinme politikası (merkezi)", () => {
  it("izin yok → gizli; özellik yok → kilitli; aksi görünür", () => {
    const analytics = NAV_BY_AREA.panel.find((n) => n.segment === "analitik")!;
    expect(navState(analytics, { permissions: ["panel.view"], features: [...FEATURES] })).toBe("hidden");
    expect(navState(analytics, { permissions: ["analytics.view"], features: ["qr_menu"] })).toBe("locked");
    expect(navState(analytics, { permissions: ["analytics.view"], features: [...FEATURES] })).toBe("visible");
    const sub = NAV_BY_AREA.panel.find((n) => n.segment === "abonelik")!;
    expect(sub.permission).toBe("billing.view");
    // Her paket özelliği taşıyan öğe kilit kipini tanımlar
    for (const n of NAV_BY_AREA.panel.filter((x) => x.feature)) expect(n.lockMode === "screen" || n.lockMode === "continue").toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/permissions/roles";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/** Sprint 18 güvenlik — kampanya / kupon / ödül yönetimi: yalnızca sahip + müdür; destek modu yazamaz. */
let session: CurrentSession | null = null;
const saveCoupon = vi.fn();
const setCouponStatus = vi.fn();
const saveCampaign = vi.fn();
vi.mock("@/server/billing/entitlements", () => import("../support/entitlements-mock"));
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { tenantSettings: { findUnique: vi.fn(async () => ({ timezone: "Europe/Istanbul" })) } } }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({ findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })) }));
vi.mock("@/server/promotions/admin.service", () => ({
  saveCoupon: (...a: unknown[]) => saveCoupon(...a),
  setCouponStatus: (...a: unknown[]) => setCouponStatus(...a),
  saveReward: vi.fn(async () => ({ ok: true, id: "r" })),
  setRewardState: vi.fn(async () => true),
  saveCampaign: (...a: unknown[]) => saveCampaign(...a),
  setCampaignStatus: vi.fn(async () => true),
}));

const a = await import("@/server/actions/campaign.actions");
const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const make = (role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession => {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return { id: "s", support, user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null } };
};
const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  saveCoupon.mockResolvedValue({ ok: true, id: "c" });
  setCouponStatus.mockResolvedValue(true);
  saveCampaign.mockResolvedValue({ ok: true, id: "k" });
});

describe("kampanya yetkileri", () => {
  it("rol matrisi: yalnızca sahip + müdür", () => {
    for (const p of ["campaigns.view", "campaigns.manage"] as const) {
      expect(hasPermission("TENANT_OWNER", p) && hasPermission("BRANCH_MANAGER", p)).toBe(true);
      for (const r of ["WAITER", "CASHIER", "KITCHEN", "BAR", "SUPER_ADMIN"] as const) expect(hasPermission(r, p)).toBe(false);
    }
  });
  it.each(["WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s kupon / kampanya yönetemez (404)", async (role) => {
    session = make(role);
    await expect(a.couponStatusAction("cmcoupon", "ACTIVE")).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.saveCouponAction(null, null, form({ code: "YAZ10", name: "Yaz", type: "FIXED_AMOUNT", value: "10" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.saveCampaignAction(null, null, form({ name: "K", channel: "EMAIL", segment: "ALL_OPTED_IN", messageTemplate: "x" }))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(saveCoupon).not.toHaveBeenCalled();
  });
  it("destek modu yazamaz", async () => {
    session = make("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(a.couponStatusAction("cmcoupon", "ACTIVE")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(setCouponStatus).not.toHaveBeenCalled();
  });
});

describe("kupon formu doğrulaması (para tamsayı, yüzde baz puan)", () => {
  beforeEach(() => {
    session = make("TENANT_OWNER");
  });
  it("sabit tutar kuruşa, yüzde baz puana çevrilir; kod normalize", async () => {
    await expect(a.saveCouponAction(null, null, form({ code: " yaz10 ", name: "Yaz indirimi", type: "FIXED_AMOUNT", value: "100,5", minimumOrder: "250", active: "on" }))).rejects.toThrow(); // başarı → redirect
    expect(saveCoupon.mock.calls[0]![2]).toMatchObject({ codeNormalized: "YAZ10", valueMinor: 10_050, minimumOrderMinor: 25_000, percentageBps: null, status: "ACTIVE", scope: "ALL" });
    saveCoupon.mockClear();
    await a.saveCouponAction("cmexisting", null, form({ code: "YUZDE", name: "Yüzde", type: "PERCENTAGE", percent: "12,5", maxDiscount: "200" }));
    expect(saveCoupon.mock.calls[0]![2]).toMatchObject({ percentageBps: 1250, maxDiscountMinor: 20_000, valueMinor: null, status: "INACTIVE" });
  });
  it("geçersiz değerler: kod, yüzde > 100, eksi / harfli tutar, çakışan saat", async () => {
    const r = await a.saveCouponAction(null, null, form({ code: "a", name: "X", type: "PERCENTAGE", percent: "150", minimumOrder: "-5", startTime: "15:00", endTime: "12:00" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: expect.objectContaining({ code: expect.any(String), name: expect.any(String), percent: expect.any(String), minimumOrder: expect.any(String), endTime: expect.any(String) }) });
    expect(saveCoupon).not.toHaveBeenCalled();
  });
  it("kampanya şablonu yalnızca beyaz liste alanları; kampanya onay alanı taşımaz", async () => {
    expect(await a.saveCampaignAction("cmk", null, form({ name: "Kış", channel: "SMS", segment: "LOYALTY_MEMBERS", couponId: "", messageTemplate: "Selam {{firstName}} {{password}}" }))).toMatchObject({ ok: false });
    await a.saveCampaignAction("cmk", null, form({ name: "Kış", channel: "SMS", segment: "LOYALTY_MEMBERS", couponId: "", messageTemplate: "Selam {{firstName}}", MARKETING_SMS: "GRANTED" }));
    expect(Object.keys(saveCampaign.mock.calls[0]![2] as object).sort()).toEqual(["channel", "couponId", "messageTemplate", "name", "segment"]);
  });
});

describe("paket kapısı (Sprint 20)", () => {
  it("promosyon paketi yoksa kupon / kampanya eylemleri kararlı mesajla reddedilir; servis çağrılmaz", async () => {
    const { entitlementState, resetEntitlements } = await import("../support/entitlements-mock");
    session = make("TENANT_OWNER");
    entitlementState.features.delete("promotions");
    try {
      expect(await a.couponStatusAction("cmcoupon", "ACTIVE")).toMatchObject({ ok: false, code: "feature_disabled" });
      expect(await a.saveCampaignAction(null, null, form({ name: "K", channel: "EMAIL", segment: "ALL_OPTED_IN", messageTemplate: "x" }))).toMatchObject({ ok: false, code: "feature_disabled" });
      expect(setCouponStatus).not.toHaveBeenCalled();
      expect(saveCampaign).not.toHaveBeenCalled();
    } finally {
      resetEntitlements();
    }
  });
});

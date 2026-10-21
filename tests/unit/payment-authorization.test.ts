import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/permissions/roles";
import { panelNav } from "@/config/navigation";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/** Sprint 19 güvenlik — ödeme eylemleri: sahip / müdür / kasiyer; garson / mutfak / bar yok; destek modu yazamaz. */
let session: CurrentSession | null = null;
const recordManualPayment = vi.fn();
const refundPayment = vi.fn();
const reconcilePayment = vi.fn();
const updatePaymentSettings = vi.fn();
vi.mock("@/server/billing/entitlements", () => import("../support/entitlements-mock"));
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({ findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })) }));
vi.mock("@/server/payments/payment.service", () => ({
  recordManualPayment: (...a: unknown[]) => recordManualPayment(...a),
  refundPayment: (...a: unknown[]) => refundPayment(...a),
  reconcilePayment: (...a: unknown[]) => reconcilePayment(...a),
  updatePaymentSettings: (...a: unknown[]) => updatePaymentSettings(...a),
}));

const a = await import("@/server/actions/payment.actions");
const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const ORDER = "cmorderorderorderorderord";
const PAYMENT = "cmpaymentpaymentpaymentpa";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAA";
const make = (role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession => {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return { id: "s", support, user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null } };
};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  recordManualPayment.mockResolvedValue({ ok: true, publicId: "p", status: "SUCCEEDED", checkoutUrl: null, amountMinor: 100, replay: false });
  refundPayment.mockResolvedValue({ ok: true, status: "SUCCEEDED", refundedMinor: 100, replay: false });
  reconcilePayment.mockResolvedValue({ local: "PROCESSING", provider: "SUCCEEDED", after: "SUCCEEDED" });
});

describe("ödeme yetkileri", () => {
  it("rol matrisi: görüntüle / yönet / iade → sahip, müdür, kasiyer", () => {
    for (const p of ["payments.view", "payments.manage", "payments.refund"] as const) {
      for (const r of ["TENANT_OWNER", "BRANCH_MANAGER", "CASHIER"] as const) expect(hasPermission(r, p)).toBe(true);
      for (const r of ["WAITER", "KITCHEN", "BAR", "SUPER_ADMIN"] as const) expect(hasPermission(r, p)).toBe(false);
    }
    expect(panelNav.find((n) => n.segment === "odemeler")?.permission).toBe("payments.view");
  });
  it.each(["WAITER", "KITCHEN", "BAR"] as const)("%s ödeme kaydedemez / iade edemez / ayar değiştiremez (404)", async (role) => {
    session = make(role);
    await expect(a.recordManualPaymentAction(ORDER, null, form({ method: "CASH", key: KEY }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.refundPaymentAction(PAYMENT, null, form({ amount: "1", key: KEY }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.savePaymentSettingsAction(null, form({ enabled: "on" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.reconcilePaymentAction(PAYMENT, null, form({}))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(recordManualPayment).not.toHaveBeenCalled();
    expect(refundPayment).not.toHaveBeenCalled();
    expect(updatePaymentSettings).not.toHaveBeenCalled();
  });
  it("kasiyer: manuel ödeme + iade yapar; ayar / mutabakat yapamaz", async () => {
    session = make("CASHIER");
    expect(await a.recordManualPaymentAction(ORDER, null, form({ method: "CASH", key: KEY, amount: "12,50" }))).toMatchObject({ ok: true });
    expect(recordManualPayment.mock.calls[0]![1]).toMatchObject({ orderId: ORDER, method: "CASH", amountMinor: 1250, idempotencyKey: KEY });
    expect(await a.refundPaymentAction(PAYMENT, null, form({ amount: "1", key: KEY }))).toMatchObject({ ok: true });
    expect(await a.savePaymentSettingsAction(null, form({ enabled: "on" }))).toMatchObject({ ok: false });
    expect(await a.reconcilePaymentAction(PAYMENT, null, form({}))).toMatchObject({ ok: false });
    expect(updatePaymentSettings).not.toHaveBeenCalled();
    expect(reconcilePayment).not.toHaveBeenCalled();
  });
  it("sahip ayarları kaydeder (aralık doğrulaması)", async () => {
    session = make("TENANT_OWNER");
    expect(await a.savePaymentSettingsAction(null, form({ enabled: "on", allowOnline: "on", reservationMinutes: "500" }))).toMatchObject({ ok: false });
    expect(await a.savePaymentSettingsAction(null, form({ enabled: "on", allowOnline: "on", allowCash: "on", reservationMinutes: "15" }))).toMatchObject({ ok: true });
    expect(updatePaymentSettings.mock.calls[0]![1]).toEqual({ enabled: true, allowOnline: true, allowCash: true, allowCardTerminal: false, reservationMinutes: 15 });
  });
  it("geçersiz tutar / anahtar / kimlik reddedilir (servise ulaşmaz)", async () => {
    session = make("TENANT_OWNER");
    expect(await a.recordManualPaymentAction(ORDER, null, form({ method: "CASH", key: KEY, amount: "-5" }))).toMatchObject({ ok: false });
    expect(await a.recordManualPaymentAction(ORDER, null, form({ method: "BITCOIN", key: KEY }))).toMatchObject({ ok: false });
    expect(await a.recordManualPaymentAction("../x", null, form({ method: "CASH", key: KEY }))).toMatchObject({ ok: false });
    expect(await a.refundPaymentAction(PAYMENT, null, form({ amount: "0", key: KEY }))).toMatchObject({ ok: false });
    expect(await a.refundPaymentAction(PAYMENT, null, form({ amount: "5", key: "short" }))).toMatchObject({ ok: false });
    expect(recordManualPayment).not.toHaveBeenCalled();
    expect(refundPayment).not.toHaveBeenCalled();
  });
  it("destek modu yazamaz", async () => {
    session = make("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(a.recordManualPaymentAction(ORDER, null, form({ method: "CASH", key: KEY }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.refundPaymentAction(PAYMENT, null, form({ amount: "1", key: KEY }))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(recordManualPayment).not.toHaveBeenCalled();
    expect(refundPayment).not.toHaveBeenCalled();
  });
});

describe("paket kapısı (Sprint 20)", () => {
  it("ödeme paketi yoksa ayar reddedilir; geçmiş ödemenin İADESİ yine çalışır", async () => {
    const { entitlementState, resetEntitlements } = await import("../support/entitlements-mock");
    session = make("TENANT_OWNER");
    entitlementState.features.delete("restaurant_payments");
    try {
      expect(await a.savePaymentSettingsAction(null, form({ enabled: "on", reservationMinutes: "15" }))).toMatchObject({ ok: false, code: "feature_disabled" });
      expect(updatePaymentSettings).not.toHaveBeenCalled();
      expect(await a.refundPaymentAction(PAYMENT, null, form({ amount: "1", key: KEY }))).toMatchObject({ ok: true });
      expect(refundPayment).toHaveBeenCalledTimes(1);
    } finally {
      resetEntitlements();
    }
  });
});

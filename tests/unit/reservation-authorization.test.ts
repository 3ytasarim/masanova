import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/permissions/roles";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sprint 17 güvenlik — rezervasyon eylemleri: mutfak / bar erişemez; kasiyer yalnızca görür; garson yönetir ama masa
 * değiştiremez / kural aşamaz / ayar yapamaz; destek modu hiçbirini yapamaz. Kiracı oturumdan.
 */
let session: CurrentSession | null = null;
const create = vi.fn();
const transition = vi.fn();
const reassign = vi.fn();
const savePolicy = vi.fn();
vi.mock("@/server/billing/entitlements", () => import("../support/entitlements-mock"));
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { branch: { findFirst: vi.fn(async () => ({ timezone: "Europe/Istanbul" })) } } }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({ findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })) }));
vi.mock("@/server/reservations/booking.service", () => ({
  createReservation: (...a: unknown[]) => create(...a),
  transitionReservation: (...a: unknown[]) => transition(...a),
  reassignTables: (...a: unknown[]) => reassign(...a),
  updateInternalNote: vi.fn(async () => true),
}));
vi.mock("@/server/reservations/settings.service", () => ({
  savePolicy: (...a: unknown[]) => savePolicy(...a),
  setOpeningHours: vi.fn(async () => true),
  addBlackout: vi.fn(async () => true),
  deleteBlackout: vi.fn(async () => true),
  createCombination: vi.fn(async () => "ok"),
  deleteCombination: vi.fn(async () => true),
}));

const a = await import("@/server/actions/reservation.actions");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const ID = "cmreservationreservation12";
const make = (role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession => {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return { id: "s", support, user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null } };
};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const policyForm = () => form({ enabled: "on", defaultDurationMinutes: "90", slotIntervalMinutes: "30", minAdvanceMinutes: "60", maxAdvanceDays: "60", minPartySize: "1", maxPartySize: "8", bufferMinutes: "0", cancellationCutoffMinutes: "60", noShowGraceMinutes: "15" });

beforeEach(() => {
  vi.clearAllMocks();
  transition.mockResolvedValue({ ok: true });
  reassign.mockResolvedValue({ ok: true, tableNames: ["Masa 1"] });
  create.mockResolvedValue({ ok: true, replay: false, reservation: { id: ID, tableNames: ["Masa 1"] }, manageToken: "x" });
});

describe("rezervasyon yetkileri", () => {
  it("rol matrisi", () => {
    expect(["TENANT_OWNER", "BRANCH_MANAGER", "WAITER", "CASHIER"].every((r) => hasPermission(r as never, "reservations.view"))).toBe(true);
    expect(["TENANT_OWNER", "BRANCH_MANAGER", "WAITER"].every((r) => hasPermission(r as never, "reservations.manage"))).toBe(true);
    expect(hasPermission("CASHIER", "reservations.manage")).toBe(false);
    for (const p of ["reservations.override", "reservations.settings"] as const) {
      expect(hasPermission("TENANT_OWNER", p) && hasPermission("BRANCH_MANAGER", p)).toBe(true);
      expect(["WAITER", "CASHIER", "KITCHEN", "BAR"].some((r) => hasPermission(r as never, p))).toBe(false);
    }
    for (const r of ["KITCHEN", "BAR"] as const) expect(hasPermission(r, "reservations.view")).toBe(false);
  });

  it.each(["KITCHEN", "BAR", "CASHIER"] as const)("%s rezervasyon değiştiremez (404)", async (role) => {
    session = make(role);
    await expect(a.reservationStatusAction(ID, "SEATED")).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.walkInAction(null, form({ branchId: "cmbranch", party: "2" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.createStaffReservationAction(null, form({}))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(transition).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("garson masaya alır ama masa değiştiremez, kural aşamaz, ayar yapamaz", async () => {
    session = make("WAITER");
    expect(await a.reservationStatusAction(ID, "SEATED")).toMatchObject({ ok: true });
    await expect(a.reassignTablesAction(ID, null, form({ tables: "cmtable" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.saveReservationSettingsAction(null, policyForm())).rejects.toBeInstanceOf(NotFoundSignal);
    const r = await a.createStaffReservationAction(null, form({ branchId: "cmbranch", date: "2026-11-01", time: "19:00", party: "2", name: "Ali Veli", source: "PHONE", override: "on" }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("yalnızca sahip") });
    expect(create).not.toHaveBeenCalled();
  });

  it("destek modu hiçbir rezervasyonu değiştiremez", async () => {
    session = make("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(a.reservationStatusAction(ID, "CANCELLED")).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(a.saveReservationSettingsAction(null, policyForm())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(transition).not.toHaveBeenCalled();
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it("sahip: kiracı oturumdan; geçersiz hedef durum ve kimlik reddedilir", async () => {
    session = make("TENANT_OWNER");
    expect(await a.reservationStatusAction(ID, "PENDING")).toMatchObject({ ok: false });
    expect(await a.reservationStatusAction("../x", "SEATED")).toMatchObject({ ok: false });
    expect(await a.reservationStatusAction(ID, "NO_SHOW")).toMatchObject({ ok: true });
    expect((transition.mock.calls[0]![0] as { scope: { tenantId: string } }).scope.tenantId).toBe(TENANT_A);
    await a.saveReservationSettingsAction(null, policyForm());
    expect(savePolicy.mock.calls[0]![1]).toMatchObject({ enabled: true, publicBookingEnabled: false, slotIntervalMinutes: 30 });
    expect(await a.saveReservationSettingsAction(null, form({ ...Object.fromEntries(policyForm()), slotIntervalMinutes: "7" }))).toMatchObject({ ok: false });
  });

  it("açılış saati biçimi ve çakışan aralıklar reddedilir", async () => {
    session = make("TENANT_OWNER");
    expect(await a.saveOpeningHoursAction("cmbranch", null, form({ day1: "23:00-02:00" }))).toMatchObject({ ok: false });
    expect(await a.saveOpeningHoursAction("cmbranch", null, form({ day1: "12:00-15:00,14:00-20:00" }))).toMatchObject({ ok: false });
    expect(await a.saveOpeningHoursAction("cmbranch", null, form({ day1: "12:00-15:00,18:00-24:00" }))).toMatchObject({ ok: true });
  });
});

describe("paket kapısı (Sprint 20)", () => {
  it("rezervasyon paketi yoksa YENİ rezervasyon / ayar reddedilir; mevcut rezervasyon durumu yönetilebilir (devam politikası)", async () => {
    const { entitlementState, resetEntitlements } = await import("../support/entitlements-mock");
    session = make("TENANT_OWNER");
    entitlementState.features.delete("reservations");
    try {
      const f = new FormData();
      f.append("branchId", "cmbranchbranchbranchbranc");
      expect(await a.walkInAction(null, f)).toMatchObject({ ok: false, code: "feature_disabled" });
      expect(await a.saveReservationSettingsAction(null, new FormData())).toMatchObject({ ok: false, code: "feature_disabled" });
      // Durum geçişi kapıya takılmaz (sonuç ne olursa olsun "feature_disabled" değildir)
      const r = await a.reservationStatusAction("cmreservationreservationr", "CANCELLED").catch(() => null);
      expect(r && "code" in r ? r.code : null).not.toBe("feature_disabled");
    } finally {
      resetEntitlements();
    }
  });
});

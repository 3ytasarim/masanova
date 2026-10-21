import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sprint 7 güvenlik — rol / kapsam sınırları (eylemler + akış yetkisi). Servisler taklit edilir; kapsam her zaman
 * oturumdan gelir, formdaki kiracı alanları yok sayılır.
 */
let session: CurrentSession | null = null;
let host: { kind: string; hostname?: string; tenant?: { id: string } } = { kind: "platform", hostname: "localhost" };
let qr: { ok: true; context: unknown } | { ok: false; reason: string } = { ok: false, reason: "unknown_token" };
let streamRef: { id: string; createdAt: Date } | null = null;

vi.mock("@/server/billing/entitlements", () => import("../support/entitlements-mock"));
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.0.0.1" })), cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => host) }));
vi.mock("@/lib/tenant/table-qr-context", () => ({ getTableQrContext: vi.fn(async () => qr) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { tenantSettings: { findUnique: vi.fn(async () => ({ defaultLocale: "tr" })) }, session: { findUnique: vi.fn() }, tableQrToken: { findFirst: vi.fn() } } }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({
  findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "STARTER", createdAt: new Date() })),
}));
vi.mock("@/server/repositories/orders.repository", () => ({ findPublicOrderStreamRef: vi.fn(async () => streamRef), PUBLIC_ORDER_WINDOW_MS: 86_400_000 }));

const ok = { ok: true as const, data: undefined };
const services = {
  changeOrderStatus: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ok),
  transitionTicket: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ok),
  createStation: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true as const, data: { id: "s" } })),
  updateStation: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ok),
  setStationActive: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ok),
  setDefaultStation: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ok),
  moveStation: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ok),
  setProductStations: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ok),
};
vi.mock("@/server/services/orders/order-status.service", () => ({ changeOrderStatus: services.changeOrderStatus, transitionTicket: services.transitionTicket }));
vi.mock("@/server/services/orders/submit-order.service", () => ({ submitOrder: vi.fn(), checkCart: vi.fn() }));
vi.mock("@/server/services/kds/station.service", () => ({
  createStation: services.createStation,
  updateStation: services.updateStation,
  setStationActive: services.setStationActive,
  setDefaultStation: services.setDefaultStation,
  moveStation: services.moveStation,
  setProductStations: services.setProductStations,
}));

const orderActions = await import("@/server/actions/order.actions");
const stationActions = await import("@/server/actions/station.actions");
const { authorizePanelStream, authorizeCustomerStream } = await import("@/server/realtime/authorize");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "cmbbbbbbbbbbbbbbbbbbbbbbb";
const ID = "cmidididididididididididid";
type Role = CurrentSession["user"]["role"];

function makeSession(role: Role, support: CurrentSession["support"] = null): CurrentSession {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return {
    id: "s",
    support,
    user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null },
  };
}
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const support = { tenantId: TENANT_A, startedAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
  host = { kind: "platform", hostname: "localhost" };
  qr = { ok: false, reason: "unknown_token" };
  streamRef = null;
});

describe("S7 güvenlik — KDS fiş eylemleri", () => {
  it.each(["WAITER", "CASHIER"] as const)("%s fiş ilerletemez", async (role) => {
    session = makeSession(role);
    await expect(orderActions.ticketStatusAction(ID, "PREPARING")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.transitionTicket).not.toHaveBeenCalled();
  });

  it.each(["KITCHEN", "BAR", "TENANT_OWNER", "BRANCH_MANAGER"] as const)("%s fiş ilerletir; kapsam oturumdan", async (role) => {
    session = makeSession(role);
    await orderActions.ticketStatusAction(ID, "READY");
    expect((services.transitionTicket.mock.calls[0]![0] as { scope: { tenantId: string } }).scope.tenantId).toBe(TENANT_A);
  });

  it("Super Admin destek modunda KDS salt okunur", async () => {
    session = makeSession("SUPER_ADMIN", support);
    await expect(orderActions.ticketStatusAction(ID, "PREPARING")).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("fiş için keyfi durum / kimlik reddedilir", async () => {
    session = makeSession("KITCHEN");
    expect(await orderActions.ticketStatusAction(ID, "SERVED" as "READY")).toMatchObject({ ok: false });
    expect(await orderActions.ticketStatusAction("../x", "READY")).toMatchObject({ ok: false });
    expect(services.transitionTicket).not.toHaveBeenCalled();
  });
});

describe("S7 güvenlik — servis / iptal yetkisi", () => {
  it("garson servis edebilir; kasiyer / mutfak edemez", async () => {
    session = makeSession("WAITER");
    await orderActions.orderStatusAction(ID, null, form({ to: "SERVED" }));
    expect(services.changeOrderStatus).toHaveBeenCalledTimes(1);
    for (const role of ["CASHIER", "KITCHEN", "BAR"] as const) {
      session = makeSession(role);
      await expect(orderActions.orderStatusAction(ID, null, form({ to: "SERVED" }))).rejects.toBeInstanceOf(NotFoundSignal);
    }
    expect(services.changeOrderStatus).toHaveBeenCalledTimes(1);
  });

  it("iptal yalnızca sahip / müdür ve açıklama zorunlu", async () => {
    for (const role of ["WAITER", "CASHIER", "KITCHEN"] as const) {
      session = makeSession(role);
      await expect(orderActions.orderStatusAction(ID, null, form({ to: "CANCELLED", reason: "Müşteri vazgeçti" }))).rejects.toBeInstanceOf(NotFoundSignal);
    }
    session = makeSession("BRANCH_MANAGER");
    expect(await orderActions.orderStatusAction(ID, null, form({ to: "CANCELLED", reason: " " }))).toMatchObject({ ok: false });
    await orderActions.orderStatusAction(ID, null, form({ to: "CANCELLED", reason: "Müşteri  vazgeçti" }));
    expect(services.changeOrderStatus.mock.calls[0]!.slice(2)).toEqual(["CANCELLED", "Müşteri vazgeçti"]);
  });

  it("destek modunda servis / iptal yok", async () => {
    session = makeSession("SUPER_ADMIN", support);
    await expect(orderActions.orderStatusAction(ID, null, form({ to: "SERVED" }))).rejects.toBeInstanceOf(NotFoundSignal);
  });
});

describe("S7 güvenlik — istasyon ayarları", () => {
  it.each(["KITCHEN", "BAR", "WAITER", "CASHIER"] as const)("%s istasyon / yönlendirme değiştiremez", async (role) => {
    session = makeSession(role);
    await expect(stationActions.saveStationAction(ID, null, null, form({ name: "Bar", type: "BAR", active: "on" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(stationActions.saveProductStationsAction(ID, null, form({ branchId: ID, stationIds: [ID] }))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.createStation).not.toHaveBeenCalled();
    expect(services.setProductStations).not.toHaveBeenCalled();
  });

  it("müdür oluşturur; formdaki tenantId yok sayılır, kapsam oturumdan", async () => {
    session = makeSession("BRANCH_MANAGER");
    await stationActions.saveStationAction(ID, null, null, form({ name: "Bar", type: "BAR", active: "on", isDefault: "on", tenantId: TENANT_B }));
    const [actor, branchId, input] = services.createStation.mock.calls[0]! as [{ scope: { tenantId: string } }, string, Record<string, unknown>];
    expect(actor.scope.tenantId).toBe(TENANT_A);
    expect(branchId).toBe(ID);
    expect(input).toEqual({ name: "Bar", type: "BAR", active: true, isDefault: true });
  });

  it("geçersiz tip / ad reddedilir; yinelenen istasyon kimlikleri tekilleşir", async () => {
    session = makeSession("TENANT_OWNER");
    expect(await stationActions.saveStationAction(ID, null, null, form({ name: "B", type: "SAUNA" }))).toMatchObject({ ok: false });
    await stationActions.saveProductStationsAction(ID, null, form({ branchId: ID, stationIds: [ID, ID] }));
    expect(services.setProductStations.mock.calls[0]!.slice(1)).toEqual([ID, ID, [ID]]);
  });
});

describe("S7 güvenlik — akış yetkisi", () => {
  it("oturumsuz panel akışı reddedilir", async () => {
    expect(await authorizePanelStream()).toBeNull();
  });

  it("panel akışı oturumdaki kiracıya bağlı; başka kiracının alan adında reddedilir", async () => {
    session = makeSession("KITCHEN");
    expect((await authorizePanelStream())?.tenantId).toBe(TENANT_A);
    host = { kind: "tenant", tenant: { id: TENANT_B } };
    expect(await authorizePanelStream()).toBeNull();
  });

  it("destek modu panel akışını salt okunur izleyebilir; destek oturumu yoksa reddedilir", async () => {
    session = makeSession("SUPER_ADMIN", support);
    expect((await authorizePanelStream())?.tenantId).toBe(TENANT_A);
    session = makeSession("SUPER_ADMIN");
    expect(await authorizePanelStream()).toBeNull();
  });

  it("müşteri akışı: geçersiz QR ya da masaya ait olmayan / süresi dolmuş sipariş reddedilir", async () => {
    expect(await authorizeCustomerStream("AbCdEfGhIjKlMnOpQrStUv", "pub")).toBeNull();
    qr = { ok: true, context: { tenant: { id: TENANT_A }, table: { id: "t1" }, token: { id: "tok" } } };
    expect(await authorizeCustomerStream("AbCdEfGhIjKlMnOpQrStUv", "pub")).toBeNull();
    streamRef = { id: "order-internal", createdAt: new Date() };
    const auth = await authorizeCustomerStream("AbCdEfGhIjKlMnOpQrStUv", "pub");
    expect(auth?.orderId).toBe("order-internal");
    expect(auth!.expiresAt).toBe(streamRef.createdAt.getTime() + 86_400_000);
  });
});

describe("paket kapısı (Sprint 20)", () => {
  it("hazırlık istasyonu paketi yoksa istasyon ayarları reddedilir", async () => {
    const { entitlementState, resetEntitlements } = await import("../support/entitlements-mock");
    session = makeSession("TENANT_OWNER");
    entitlementState.features.delete("preparation_stations");
    try {
      const f = new FormData();
      f.append("name", "Mutfak");
      f.append("type", "KITCHEN");
      expect(await stationActions.saveStationAction("cmbranchbranchbranchbranc", null, null, f)).toMatchObject({ ok: false, code: "feature_disabled" });
    } finally {
      resetEntitlements();
    }
  });
});

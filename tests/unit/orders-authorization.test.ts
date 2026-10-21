import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sipariş eylemleri — yetki ve güven sınırı. Personel: orders.manage + yazma. Müşteri: geçersiz QR bağlamı
 * servise hiç ulaşmaz; istemcinin gönderdiği kimlik / fiyat alanları servise geçmez.
 */
let session: CurrentSession | null = null;
let qr: { ok: true; context: unknown } | { ok: false; reason: string } = { ok: false, reason: "unknown_token" };

vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.0.0.1" })), cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null) }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/lib/tenant/table-qr-context", () => ({ getTableQrContext: vi.fn(async () => qr) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { tenantSettings: { findUnique: vi.fn(async () => ({ defaultLocale: "tr" })) } } }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({
  findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "B", slug: "b", status: "ACTIVE", plan: "STARTER", createdAt: new Date() })),
}));
const services = {
  changeOrderStatus: vi.fn(async (actor: { scope: { tenantId: string } }, orderId: string, to: string, reason: string | null) => {
    void actor;
    void orderId;
    void to;
    void reason;
    return { ok: true as const, data: undefined };
  }),
  submitOrder: vi.fn(async (ctx: { tenantId: string; tableId: string }, input: Record<string, unknown>) => {
    void ctx;
    void input;
    return { kind: "created" as const, order: { publicId: "p", orderNumber: 1001, totalMinor: 1, currency: "TRY", itemCount: 1, status: "SUBMITTED", tableName: "Masa 1" } };
  }),
};
vi.mock("@/server/services/orders/order-status.service", () => ({ changeOrderStatus: services.changeOrderStatus }));
vi.mock("@/server/services/orders/submit-order.service", () => ({ submitOrder: services.submitOrder, checkCart: vi.fn() }));

const actions = await import("@/server/actions/order.actions");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const ORDER = "cmorderorderorderorderord";
function makeSession(role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return {
    id: "s",
    support,
    user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null },
  };
}
const fd = (to: string) => {
  const f = new FormData();
  f.append("to", to);
  return f;
};
const payload = {
  items: [{ product: "cheeseburger", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 1, price: 1, tenantId: "cmbbbbbbbbbbbbbbbbbbbbbbb" }],
  note: null,
  idempotencyKey: "AbCdEfGhIjKlMnOpQrStUvWx",
  locale: "tr",
  totalMinor: 1,
  tableId: "baska-masa",
};

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
  qr = { ok: false, reason: "unknown_token" };
});

describe("personel sipariş kararı", () => {
  it.each(["KITCHEN", "BAR"] as const)("%s yalnızca görüntüler; kabul / ret / servis / iptal yapamaz", async (role) => {
    session = makeSession(role);
    await expect(actions.orderStatusAction(ORDER, null, fd("ACCEPTED"))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.changeOrderStatus).not.toHaveBeenCalled();
  });

  it("Super Admin destek modunda karar veremez", async () => {
    session = makeSession("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(actions.orderStatusAction(ORDER, null, fd("REJECTED"))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.changeOrderStatus).not.toHaveBeenCalled();
  });

  it.each(["TENANT_OWNER", "BRANCH_MANAGER", "WAITER", "CASHIER"] as const)("%s kabul / ret yapabilir; kapsam oturumdan", async (role) => {
    session = makeSession(role);
    await actions.orderStatusAction(ORDER, null, fd("ACCEPTED"));
    expect(services.changeOrderStatus.mock.calls[0]![0].scope.tenantId).toBe(TENANT_A);
  });

  it("keyfi durum atanamaz: PREPARING / READY sistemindir; iptal nedeni zorunlu", async () => {
    session = makeSession("TENANT_OWNER");
    for (const to of ["PREPARING", "READY", "SUBMITTED", "x"]) expect(await actions.orderStatusAction(ORDER, null, fd(to))).toMatchObject({ ok: false });
    expect(await actions.orderStatusAction(ORDER, null, fd("CANCELLED"))).toMatchObject({ ok: false });
    expect(services.changeOrderStatus).not.toHaveBeenCalled();
  });
});

describe("müşteri gönderimi — güven sınırı", () => {
  it("geçersiz / başka kiracının QR bağlamı servise ulaşmaz", async () => {
    expect(await actions.submitOrderAction("AbCdEfGhIjKlMnOpQrStUv", payload)).toEqual({ kind: "rejected", reason: "context_invalid" });
    expect(services.submitOrder).not.toHaveBeenCalled();
  });

  it("masa bağlamı yalnızca QR'dan; istemcinin fiyat / toplam / masa / kiracı alanları servise geçmez", async () => {
    qr = { ok: true, context: { tenant: { id: TENANT_A }, branch: { id: "br", name: "Merkez" }, table: { id: "masa-gercek", name: "Masa 1" }, area: null, token: { id: "tok" } } };
    await actions.submitOrderAction("AbCdEfGhIjKlMnOpQrStUv", payload);
    const [ctx, input] = services.submitOrder.mock.calls[0]!;
    expect(ctx).toMatchObject({ tenantId: TENANT_A, tableId: "masa-gercek", tokenId: "tok" });
    expect(input).not.toHaveProperty("totalMinor");
    expect(input).not.toHaveProperty("tableId");
    expect((input.items as Record<string, unknown>[])[0]).not.toHaveProperty("price");
    expect((input.items as Record<string, unknown>[])[0]).not.toHaveProperty("tenantId");
  });

  it("aynı IP + masa için hız sınırı (8 / 10 dk)", async () => {
    qr = { ok: true, context: { tenant: { id: TENANT_A }, branch: { id: "br", name: "Merkez" }, table: { id: "masa-hiz", name: "Masa 9" }, area: null, token: { id: "tok" } } };
    const results = [];
    for (let i = 0; i < 9; i++) results.push(await actions.submitOrderAction("AbCdEfGhIjKlMnOpQrStUv", payload));
    expect(results.slice(0, 8).every((r) => r.kind === "created")).toBe(true);
    expect(results[8]).toEqual({ kind: "rejected", reason: "rate_limited" });
  });
});

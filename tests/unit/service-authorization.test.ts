import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sprint 8 güvenlik — servis talebi eylemleri. Müşteri: güvenilir QR bağlamı dışında hiçbir kimlik kullanılmaz.
 * Personel: service.view + yazma; mutfak / bar ve destek modu reddedilir; yetenekler rolden sunucuda hesaplanır.
 */
let session: CurrentSession | null = null;
let qr: { ok: true; context: unknown } | { ok: false; reason: string } = { ok: false, reason: "unknown_token" };
let ip = "10.0.0.1";

vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": ip })), cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null) }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/lib/tenant/table-qr-context", () => ({ getTableQrContext: vi.fn(async () => qr) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({
  findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "STARTER", createdAt: new Date() })),
}));

const view = { publicId: "p".repeat(22), type: "WAITER", status: "OPEN", note: null, staffName: null, createdAt: new Date().toISOString() };
const services = {
  submit: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ kind: "created" as const, request: view })),
  list: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => [view]),
  cancelOwn: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true as const })),
  claim: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true as const, data: undefined })),
  complete: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true as const, data: undefined })),
  cancel: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true as const, data: undefined })),
};
vi.mock("@/server/services/service-requests/customer-request.service", () => ({ submitServiceRequest: services.submit, listCustomerRequests: services.list, cancelCustomerRequest: services.cancelOwn }));
vi.mock("@/server/services/service-requests/staff-request.service", () => ({ claimServiceRequest: services.claim, completeServiceRequest: services.complete, cancelServiceRequestByStaff: services.cancel }));

const actions = await import("@/server/actions/service-request.actions");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const REQ = "cmreqreqreqreqreqreqreqreq";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const trustedContext = { tenant: { id: TENANT_A }, branch: { id: "branch-qr", name: "Merkez" }, area: { id: "area-qr", name: "Bahçe" }, table: { id: "table-qr", name: "Masa 12" }, token: { id: "tok-qr" } };

function makeSession(role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return {
    id: "s",
    support,
    user: { id: `u_${role}`, tenantId, email: "secret@mail.test", firstName: "Merve", lastName: "Kaya", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
  qr = { ok: false, reason: "unknown_token" };
});

describe("S8 güvenlik — müşteri talebi", () => {
  it("geçersiz / iptal / başka kiracının QR'ı servise ulaşmaz (nötr ret)", async () => {
    for (const reason of ["unknown_token", "revoked", "table_inactive", "tenant_unavailable"]) {
      qr = { ok: false, reason };
      expect(await actions.submitServiceRequestAction(TOKEN, { type: "WAITER" })).toEqual({ kind: "rejected", reason: "context_invalid" });
      expect(await actions.listServiceRequestsAction(TOKEN)).toEqual({ kind: "rejected", reason: "context_invalid" });
    }
    expect(services.submit).not.toHaveBeenCalled();
  });

  it("başka masa için talep açılamaz: tarayıcının kiracı / şube / masa alanları yok sayılır, bağlam QR'dan", async () => {
    qr = { ok: true, context: trustedContext };
    ip = "10.0.1.1";
    await actions.submitServiceRequestAction(TOKEN, { type: "WATER", tenantId: "cmbbbbbbbbbbbbbbbbbbbbbbb", tableId: "baska-masa", branchId: "x", note: "yok sayılır" });
    const [ctx, input] = services.submit.mock.calls[0]! as [Record<string, unknown>, Record<string, unknown>];
    expect(ctx).toMatchObject({ tenantId: TENANT_A, tableId: "table-qr", branchId: "branch-qr", areaId: "area-qr", tokenId: "tok-qr", tableName: "Masa 12" });
    expect(input).toEqual({ type: "WATER", note: "yok sayılır", recentOrderIds: [] });
  });

  it("tip doğrulanır; not düz metne süzülür", async () => {
    qr = { ok: true, context: { ...trustedContext, table: { id: "table-note", name: "Masa 3" } } };
    ip = "10.0.2.1";
    expect(await actions.submitServiceRequestAction(TOKEN, { type: "PAYMENT" })).toEqual({ kind: "rejected", reason: "invalid" });
    expect(await actions.submitServiceRequestAction(TOKEN, { type: "CUSTOM", note: 42 })).toEqual({ kind: "rejected", reason: "invalid" });
    await actions.submitServiceRequestAction(TOKEN, { type: "CUSTOM", note: "  Çocuk‮  sandalyesi  " });
    expect((services.submit.mock.calls[0]![1] as { note: string }).note).toBe("Çocuk sandalyesi");
  });

  it("hız sınırı masa + tip bazında (aynı Wi-Fi'deki başka masa etkilenmez)", async () => {
    ip = "10.0.3.1";
    qr = { ok: true, context: { ...trustedContext, table: { id: "table-rl", name: "Masa 5" } } };
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await actions.submitServiceRequestAction(TOKEN, { type: "WAITER" }));
    expect(results.slice(0, 6).every((r) => r.kind === "created")).toBe(true);
    expect(results[6]).toEqual({ kind: "rejected", reason: "rate_limited" });
    qr = { ok: true, context: { ...trustedContext, table: { id: "table-other", name: "Masa 6" } } };
    expect((await actions.submitServiceRequestAction(TOKEN, { type: "WAITER" })).kind).toBe("created");
  });

  it("müşteri iptali yalnızca biçimli public kimlikle ve aynı QR bağlamında", async () => {
    expect(await actions.cancelOwnServiceRequestAction(TOKEN, "p".repeat(22))).toEqual({ ok: false });
    qr = { ok: true, context: trustedContext };
    expect(await actions.cancelOwnServiceRequestAction(TOKEN, "../etc")).toEqual({ ok: false });
    await actions.cancelOwnServiceRequestAction(TOKEN, "p".repeat(22));
    expect((services.cancelOwn.mock.calls[0]![0] as { tableId: string }).tableId).toBe("table-qr");
  });
});

describe("S8 güvenlik — personel", () => {
  it.each(["KITCHEN", "BAR"] as const)("%s servis talebi üstlenemez / tamamlayamaz", async (role) => {
    session = makeSession(role);
    await expect(actions.serviceRequestStaffAction(REQ, "claim")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.claim).not.toHaveBeenCalled();
  });

  it("destek modu değiştiremez", async () => {
    session = makeSession("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    for (const op of ["claim", "complete", "cancel"] as const) await expect(actions.serviceRequestStaffAction(REQ, op)).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("garson: kapsam oturumdan, yetenekler rolden; görünen ad e-posta içermez", async () => {
    session = makeSession("WAITER");
    await actions.serviceRequestStaffAction(REQ, "claim");
    const actor = services.claim.mock.calls[0]![0] as { scope: { tenantId: string }; displayName: string; abilities: Record<string, boolean> };
    expect(actor.scope.tenantId).toBe(TENANT_A);
    expect(actor.displayName).toBe("Merve K.");
    expect(JSON.stringify(actor)).not.toContain("secret@mail.test");
    expect(actor.abilities).toEqual({ view: true, manage: true, billOnly: false, override: false });
  });

  it("kasiyer: yalnızca hesap yeteneği (tip denetimi sunucuda)", async () => {
    session = makeSession("CASHIER");
    await actions.serviceRequestStaffAction(REQ, "complete");
    expect((services.complete.mock.calls[0]![0] as { abilities: Record<string, boolean> }).abilities).toEqual({ view: true, manage: false, billOnly: true, override: false });
  });

  it("geçersiz kimlik / işlem reddedilir", async () => {
    session = makeSession("BRANCH_MANAGER");
    expect(await actions.serviceRequestStaffAction("../x", "claim")).toMatchObject({ ok: false });
    expect(await actions.serviceRequestStaffAction(REQ, "delete" as "claim")).toMatchObject({ ok: false });
    expect(services.claim).not.toHaveBeenCalled();
  });
});

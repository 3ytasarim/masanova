import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Masa / QR eylemleri ve indirme uçları — yetkilendirme kapısı. Servisler taklit edilir: reddedilen roller
 * servise HİÇ ulaşmamalı; izinli rolde kapsam formdan değil oturumdan gelmeli.
 */
let session: CurrentSession | null = null;

vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null) }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({
  findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "B", slug: "b", status: "ACTIVE", plan: "STARTER", createdAt: new Date() })),
}));

const ok = { ok: true, data: { id: "x" }, message: "ok" };
const services = {
  createArea: vi.fn(async (actor: { scope: { tenantId: string }; userId: string }, branchId: string, input: Record<string, unknown>) => {
    void actor;
    void branchId;
    void input;
    return ok;
  }),
  bulkCreateTables: vi.fn(async () => ({ ok: true, data: { count: 1 } })),
  regenerateTableQr: vi.fn(async () => ok),
  revokeTableQr: vi.fn(async () => ok),
  createTableQr: vi.fn(async () => ok),
  revealTableQr: vi.fn(async (scope: { tenantId: string }, tableId: string) => ({ ok: true, scope, tableId, qr: { url: "https://a.masanovai.com/t/AbCdEfGhIjKlMnOpQrStUv", tokenRowId: "r", createdAt: new Date() } })),
};
vi.mock("@/server/services/tables/area.service", () => ({ createArea: services.createArea, updateArea: vi.fn(), setAreaActive: vi.fn(), moveArea: vi.fn() }));
vi.mock("@/server/services/tables/table.service", () => ({
  bulkCreateTables: services.bulkCreateTables,
  createTable: vi.fn(),
  updateTable: vi.fn(),
  setTableActive: vi.fn(),
  moveTable: vi.fn(),
  moveTableToArea: vi.fn(),
}));
vi.mock("@/server/services/tables/qr.service", () => ({
  createTableQr: services.createTableQr,
  regenerateTableQr: services.regenerateTableQr,
  revokeTableQr: services.revokeTableQr,
  ensureTablesHaveQr: vi.fn(),
  revealTableQr: services.revealTableQr,
  REVEAL_FAILURE_MESSAGES: {},
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { diningTable: { findFirst: vi.fn(async () => ({ name: "Masa 1" })) } } }));

const actions = await import("@/server/actions/tables.actions");
const qrRoute = await import("@/app/panel/masalar/indir/qr/route");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const BRANCH = "cmbranchbranchbranchbranch";
const TABLE = "cmtabletabletabletabletabl";
function makeSession(role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return {
    id: "s",
    support,
    user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null },
  };
}
const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
};
const areaForm = () => form({ name: "Salon", slug: "salon", active: "on", tenantId: "cmbbbbbbbbbbbbbbbbbbbbbbb" });
const qrRequest = () => new NextRequest(`http://localhost/panel/masalar/indir/qr?masa=${TABLE}&bicim=svg`);

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
});

describe("masa yönetimi yetkisi", () => {
  it.each(["WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s bölge/masa/QR değiştiremez ve QR indiremez", async (role) => {
    session = makeSession(role);
    await expect(actions.saveAreaAction(BRANCH, null, null, areaForm())).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(actions.bulkCreateTablesAction(BRANCH, null, form({ count: "10", startNumber: "1", pattern: "Masa {n}" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(actions.tableQrAction(TABLE, null, form({ op: "regenerate" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(qrRoute.GET(qrRequest())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.createArea).not.toHaveBeenCalled();
    expect(services.bulkCreateTables).not.toHaveBeenCalled();
    expect(services.regenerateTableQr).not.toHaveBeenCalled();
    expect(services.revealTableQr).not.toHaveBeenCalled();
  });

  it("Super Admin destek modunda QR yenileyemez / iptal edemez / göremez", async () => {
    session = makeSession("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(actions.tableQrAction(TABLE, null, form({ op: "regenerate" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(actions.tableQrAction(TABLE, null, form({ op: "revoke" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(qrRoute.GET(qrRequest())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.regenerateTableQr).not.toHaveBeenCalled();
    expect(services.revokeTableQr).not.toHaveBeenCalled();
    expect(services.revealTableQr).not.toHaveBeenCalled();
  });

  it.each(["TENANT_OWNER", "BRANCH_MANAGER"] as const)("%s yönetir; kapsam oturumdan gelir (formdaki tenantId yok sayılır)", async (role) => {
    session = makeSession(role);
    await expect(actions.saveAreaAction(BRANCH, null, null, areaForm())).resolves.toMatchObject({ ok: true });
    const [actor, branchId, input] = services.createArea.mock.calls[0]!;
    expect(actor.scope.tenantId).toBe(TENANT_A);
    expect(actor.userId).toBe(`u_${role}`);
    expect(branchId).toBe(BRANCH);
    expect(input).not.toHaveProperty("tenantId");
    const res = await qrRoute.GET(qrRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(services.revealTableQr.mock.calls[0]![0]).toMatchObject({ tenantId: TENANT_A });
  });

  it("biçimsiz kimlikler ve geçersiz QR işlemi servise ulaşmaz", async () => {
    session = makeSession("TENANT_OWNER");
    await expect(actions.tableQrAction("../../x", null, form({ op: "revoke" }))).resolves.toMatchObject({ ok: false });
    await expect(actions.tableQrAction(TABLE, null, form({ op: "delete" }))).resolves.toMatchObject({ ok: false });
    await expect(actions.bulkCreateTablesAction(BRANCH, null, form({ count: "100000", startNumber: "1", pattern: "Masa {n}" }))).resolves.toMatchObject({ ok: false });
    expect(services.revokeTableQr).not.toHaveBeenCalled();
    expect(services.bulkCreateTables).not.toHaveBeenCalled();
  });
});

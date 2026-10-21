import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sprint 12 güvenlik — analitik dışa aktarımı: garson erişemez, destek modunda dışa aktarım YOK, kiracı oturumdan;
 * tarayıcının gönderdiği kiracı alanı yok sayılır, başka kiracının şubesi reddedilir.
 */
let session: CurrentSession | null = null;
const resolveMock = vi.fn();
vi.mock("@/server/billing/entitlements", () => import("../support/entitlements-mock"));
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({ findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })) }));
vi.mock("@/server/analytics/filter", () => ({ resolveAnalyticsContext: (...a: unknown[]) => resolveMock(...a) }));
vi.mock("@/server/analytics/csv.service", () => ({ CSV_EXPORTS: ["orders", "products", "service", "kds"], csvFileName: () => "x.csv", csvStream: () => new ReadableStream({ start: (c) => c.close() }) }));

const { GET } = await import("@/app/panel/analitik/disa-aktar/route");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "cmbbbbbbbbbbbbbbbbbbbbbbb";
const make = (role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession => {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return { id: "s", support, user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null } };
};
const call = (qs: string) => GET(new Request(`http://localhost:3820/panel/analitik/disa-aktar?${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  resolveMock.mockImplementation(async (scope: { tenantId: string }, input: { branch?: string | null }) =>
    input.branch && input.branch !== "branch-of-a" ? { ok: false, error: "branch_invalid", branches: [] } : { ok: true, context: { scope, range: { start: new Date(), end: new Date() } } },
  );
});

describe("analitik CSV yetkisi", () => {
  it.each(["WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s dışa aktaramaz (404)", async (role) => {
    session = make(role);
    await expect(call("tur=products&aralik=today")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("Super Admin destek modunda dışa aktarım ENGELLİ", async () => {
    session = make("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(call("tur=orders&aralik=today")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("sahip: kiracı oturumdan (URL'deki kiracı alanı yok sayılır); başka kiracının şubesi 404; geçersiz tür 400", async () => {
    session = make("TENANT_OWNER");
    const ok = await call(`tur=products&aralik=today&tenantId=${TENANT_B}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/csv");
    expect((resolveMock.mock.calls[0]![0] as { tenantId: string }).tenantId).toBe(TENANT_A);
    expect((await call("tur=products&aralik=today&sube=branch-of-b")).status).toBe(404);
    expect((await call("tur=secrets&aralik=today")).status).toBe(400);
  });

  it("şube müdürü dışa aktarabilir", async () => {
    session = make("BRANCH_MANAGER");
    expect((await call("tur=kds&aralik=last7")).status).toBe(200);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/permissions/roles";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sprint 15 güvenlik — İşletme Danışmanı eylemleri: garson / kasiyer / mutfak / bar erişemez; destek modu DEĞİŞTİREMEZ
 * (kapatma / geri bildirim / ücretli yenileme); kiracı oturumdan; hız sınırı.
 */
let session: CurrentSession | null = null;
const refreshMock = vi.fn();
const dismissMock = vi.fn();
const feedbackMock = vi.fn();
const rateMock = vi.fn();
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({ findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })) }));
vi.mock("@/server/rate-limit", () => ({ rateLimit: (...a: unknown[]) => rateMock(...a) }));
vi.mock("@/server/services/advisor/advisor.service", () => ({
  refreshAdvisor: (...a: unknown[]) => refreshMock(...a),
  dismissInsight: (...a: unknown[]) => dismissMock(...a),
  setInsightFeedback: (...a: unknown[]) => feedbackMock(...a),
}));

const { refreshAdvisorAction, dismissInsightAction, insightFeedbackAction } = await import("@/server/actions/advisor.actions");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const make = (role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession => {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return { id: "s", support, user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null } };
};

beforeEach(() => {
  vi.clearAllMocks();
  rateMock.mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0, backend: "memory" });
  refreshMock.mockResolvedValue({ ok: true, explained: 2, reused: 0, rejected: 0, fallback: false });
  dismissMock.mockResolvedValue(true);
  feedbackMock.mockResolvedValue(true);
});

describe("danışman yetkileri", () => {
  it("rol matrisi: sahip + müdür görür ve yönetir; diğer roller hiçbiri", () => {
    for (const r of ["TENANT_OWNER", "BRANCH_MANAGER"] as const) {
      expect(hasPermission(r, "advisor.view")).toBe(true);
      expect(hasPermission(r, "advisor.manage")).toBe(true);
    }
    for (const r of ["WAITER", "CASHIER", "KITCHEN", "BAR", "SUPER_ADMIN"] as const) {
      expect(hasPermission(r, "advisor.view")).toBe(false);
      expect(hasPermission(r, "advisor.manage")).toBe(false);
    }
  });

  it.each(["WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s danışman eylemi çalıştıramaz (404)", async (role) => {
    session = make(role);
    await expect(dismissInsightAction("cminsight")).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(refreshAdvisorAction("last7", "")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(dismissMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("Super Admin destek modunda kapatma / geri bildirim / ücretli yenileme YOK", async () => {
    session = make("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(dismissInsightAction("cminsight")).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(insightFeedbackAction("cminsight", "USEFUL")).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(refreshAdvisorAction("last7", "")).rejects.toBeInstanceOf(NotFoundSignal);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sahip: kiracı oturumdan; geçersiz kimlik / değer reddedilir; yenileme kiracı başına hız sınırlı", async () => {
    session = make("TENANT_OWNER");
    expect((await dismissInsightAction("cminsight")).ok).toBe(true);
    expect((dismissMock.mock.calls[0]![0] as { scope: { tenantId: string } }).scope.tenantId).toBe(TENANT_A);
    expect((await dismissInsightAction("../x")).ok).toBe(false);
    expect((await insightFeedbackAction("cminsight", "LOVE" as "USEFUL")).ok).toBe(false);
    expect((await refreshAdvisorAction("last7", "")).ok).toBe(true);
    expect(rateMock).toHaveBeenCalledWith("advisor.refresh", TENANT_A);
    rateMock.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 600, backend: "memory" });
    const limited = await refreshAdvisorAction("last7", "");
    expect(limited).toMatchObject({ ok: false });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect((await refreshAdvisorAction("last7", "x'; DROP")).ok).toBe(false);
  });

  it("şube müdürü kapatabilir", async () => {
    session = make("BRANCH_MANAGER");
    expect((await dismissInsightAction("cminsight")).ok).toBe(true);
  });
});

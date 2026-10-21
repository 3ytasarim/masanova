import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Tema & Tasarım eylemi — yalnızca İşletme Sahibi (branding.manage) yazabilir; destek modu ve diğer roller servise
 * ulaşamaz; kapsam formdan değil oturumdan gelir; önbellek yalnızca o kiracı için geçersiz kılınır.
 */
let session: CurrentSession | null = null;
const cache = { updateTag: vi.fn(), revalidatePath: vi.fn() };

vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: cache.revalidatePath, revalidateTag: vi.fn(), updateTag: cache.updateTag, unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null) }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({
  findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "B", slug: "b", status: "ACTIVE", plan: "STARTER", createdAt: new Date() })),
}));
const saveTheme = vi.fn(async (actor: { scope: { tenantId: string } }, input: Record<string, unknown>) => {
  void actor;
  void input;
  return { ok: true as const, data: undefined, message: "ok" };
});
vi.mock("@/server/services/public-menu/theme.service", () => ({ savePublicTheme: saveTheme }));

const { savePublicThemeAction } = await import("@/server/actions/public-menu.actions");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
function makeSession(role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return {
    id: "s",
    support,
    user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null },
  };
}
const form = () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ style: "VISUAL", primaryColor: "#1e3a8a", welcomeText: "Merhaba", showAllergens: "on", tenantId: "cmbbbbbbbbbbbbbbbbbbbbbbb" })) fd.append(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
});

describe("QR menü görünümü yetkisi", () => {
  it.each(["BRANCH_MANAGER", "WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s kaydedemez", async (role) => {
    session = makeSession(role);
    await expect(savePublicThemeAction(null, form())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(saveTheme).not.toHaveBeenCalled();
  });

  it("Super Admin destek modunda (önizleme dahil) yazamaz", async () => {
    session = makeSession("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(savePublicThemeAction(null, form())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(saveTheme).not.toHaveBeenCalled();
  });

  it("İşletme Sahibi kaydeder; kapsam oturumdan; yalnızca kendi menü önbelleği geçersiz kılınır", async () => {
    session = makeSession("TENANT_OWNER");
    await expect(savePublicThemeAction(null, form())).resolves.toMatchObject({ ok: true });
    const [actor, input] = saveTheme.mock.calls[0]!;
    expect(actor.scope.tenantId).toBe(TENANT_A);
    expect(input).not.toHaveProperty("tenantId");
    expect(input).toMatchObject({ style: "VISUAL", showAllergens: true, showNutrition: false });
    expect(cache.updateTag).toHaveBeenCalledWith(`public-menu:${TENANT_A}`);
  });
});

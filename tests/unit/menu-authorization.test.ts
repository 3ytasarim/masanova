import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Menü eylemleri — yetkilendirme kapısı. Servisler taklit edilir: reddedilen roller servise HİÇ ulaşmamalı;
 * izinli rolde kapsam formdaki tenantId'den değil oturumdan gelmeli.
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
  createCategory: vi.fn(async (actor: { scope: { tenantId: string }; userId: string }, input: Record<string, unknown>) => {
    void actor;
    void input;
    return ok;
  }),
  updateCategory: vi.fn(async () => ok),
  setProductFlag: vi.fn(async () => ok),
  bulkUpdateProducts: vi.fn(async () => ({ ok: true, data: { count: 1 } })),
  saveBranchOverride: vi.fn(async () => ok),
};
vi.mock("@/server/services/menu/category.service", () => ({ createCategory: services.createCategory, updateCategory: services.updateCategory, moveCategory: vi.fn(), setCategoryFlag: vi.fn() }));
vi.mock("@/server/services/menu/product.service", () => ({
  setProductFlag: services.setProductFlag,
  bulkUpdateProducts: services.bulkUpdateProducts,
  addProductImage: vi.fn(),
  createProduct: vi.fn(),
  moveProduct: vi.fn(),
  saveProductTranslations: vi.fn(),
  setProductArchived: vi.fn(),
  updateProductContent: vi.fn(),
  updateProductGeneral: vi.fn(),
  updateProductImage: vi.fn(),
  updateProductPricing: vi.fn(),
}));
vi.mock("@/server/services/menu/branch-override.service", () => ({ saveBranchOverride: services.saveBranchOverride }));

const actions = await import("@/server/actions/menu.actions");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
function makeSession(role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return {
    id: "s",
    support,
    user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null },
  };
}
const form = (entries: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  return fd;
};
const categoryForm = () => form({ name: "Çorbalar", slug: "corbalar", active: "on", tenantId: "cmbbbbbbbbbbbbbbbbbbbbbbb" });

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
});

describe("menü düzenleme yetkisi", () => {
  it.each(["WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s menüyü düzenleyemez", async (role) => {
    session = makeSession(role);
    await expect(actions.saveCategoryAction(null, null, categoryForm())).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(actions.productQuickAction(null, form({ id: "p1", op: "soldOut", value: "true" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(actions.bulkProductAction(null, form({ op: "sold_out", ids: ["p1"] }))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.createCategory).not.toHaveBeenCalled();
    expect(services.setProductFlag).not.toHaveBeenCalled();
    expect(services.bulkUpdateProducts).not.toHaveBeenCalled();
  });

  it("Super Admin destek modunda (salt okunur) menüyü düzenleyemez", async () => {
    session = makeSession("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(actions.saveCategoryAction(null, null, categoryForm())).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.createCategory).not.toHaveBeenCalled();
  });

  it.each(["TENANT_OWNER", "BRANCH_MANAGER"] as const)("%s düzenler; kapsam oturumdan gelir (formdaki tenantId yok sayılır)", async (role) => {
    session = makeSession(role);
    await expect(actions.saveCategoryAction(null, null, categoryForm())).resolves.toMatchObject({ ok: true });
    const [actor, input] = services.createCategory.mock.calls[0]!;
    expect(actor.scope.tenantId).toBe(TENANT_A);
    expect(actor.userId).toBe(`u_${role}`);
    expect(input).not.toHaveProperty("tenantId");
  });

  it("toplu işlem: en fazla 100 ürün, geçersiz işlem reddedilir", async () => {
    session = makeSession("TENANT_OWNER");
    const tooMany = Array.from({ length: 101 }, (_, i) => `p${i}`);
    await expect(actions.bulkProductAction(null, form({ op: "sold_out", ids: tooMany }))).resolves.toMatchObject({ ok: false });
    await expect(actions.bulkProductAction(null, form({ op: "delete", ids: ["p1"] }))).resolves.toMatchObject({ ok: false });
    expect(services.bulkUpdateProducts).not.toHaveBeenCalled();
  });

  it("şube geçersiz kılması: geçersiz fiyat servise ulaşmaz", async () => {
    session = makeSession("TENANT_OWNER");
    await expect(actions.saveBranchOverrideAction("p1", null, form({ branchId: "b1", available: "inherit", soldOut: "yes", price: "abc" }))).resolves.toMatchObject({ ok: false });
    expect(services.saveBranchOverride).not.toHaveBeenCalled();
    await actions.saveBranchOverrideAction("p1", null, form({ branchId: "b1", available: "inherit", soldOut: "yes", price: "80", "variantPrice.v1": "95,50" }));
    expect(services.saveBranchOverride).toHaveBeenCalledWith(expect.anything(), "p1", { branchId: "b1", available: "inherit", soldOut: "yes", price: 8000, variantPrices: { v1: 9550 } });
  });
});

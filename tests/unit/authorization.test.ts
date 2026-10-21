import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, RedirectSignal, navigationMock } from "../support/next-mocks";

/**
 * Yetkilendirme kapıları ve Super Admin eylemleri — oturum, Next navigasyonu ve servisler taklit edilir.
 *  1) Super Admin olmayan kullanıcı kiracı yönetimine erişemez
 *  2) İşletme sahibi başka işletme oluşturamaz
 *  3) A işletmesinin sahibi B'yi düzenleyemez
 *  5) Durum geçişleri yetkilendirilir
 *  + destek modu salt okunur ve yalnızca Super Admin için
 */

let session: CurrentSession | null = null;

vi.mock("next/navigation", () => navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null) }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "cmbbbbbbbbbbbbbbbbbbbbbbb";
const tenants = {
  [TENANT_A]: { id: TENANT_A, name: "A Lokantası", slug: "a-lokantasi", status: "ACTIVE" as const, plan: "STARTER" as const, createdAt: new Date() },
  [TENANT_B]: { id: TENANT_B, name: "B Kafe", slug: "b-kafe", status: "ACTIVE" as const, plan: "STARTER" as const, createdAt: new Date() },
};
vi.mock("@/server/repositories/tenant-admin.repository", () => ({
  findTenantSummaryById: vi.fn(async (_scope: unknown, id: string) => tenants[id as keyof typeof tenants] ?? null),
  isTenantSlugTaken: vi.fn(async () => false),
}));

const services = {
  onboardTenant: vi.fn(async () => ({ ok: true, data: {} })),
  changeTenantStatus: vi.fn(async () => ({ ok: true, data: undefined })),
  updateTenantBranch: vi.fn(async () => ({ ok: true, data: undefined })),
  updateTenantGeneral: vi.fn(async () => ({ ok: true, data: undefined })),
};
vi.mock("@/server/services/onboarding.service", () => ({ onboardTenant: services.onboardTenant }));
vi.mock("@/server/services/tenant-admin.service", () => ({
  changeTenantStatus: services.changeTenantStatus,
  updateTenantGeneral: services.updateTenantGeneral,
  changeTenantSlug: vi.fn(),
  changeTenantPlan: vi.fn(),
  updateTenantBranding: vi.fn(),
}));
vi.mock("@/server/services/branch-admin.service", () => ({ updateTenantBranch: services.updateTenantBranch, createTenantBranch: vi.fn() }));

const { requireSuperAdmin, requireSuperAdminTenant, requireTenantUser } = await import("@/lib/auth/guards");
const actions = await import("@/server/actions/tenant-admin.actions");
const { createTenantAction } = await import("@/server/actions/onboarding.actions");

function makeSession(role: "SUPER_ADMIN" | "TENANT_OWNER" | "WAITER", tenantId: string | null, support: CurrentSession["support"] = null): CurrentSession {
  const tenant = tenantId ? { id: tenantId, name: "x", slug: "x", status: "ACTIVE" as const } : null;
  return {
    id: "sess_1",
    support,
    user: { id: `user_${role}`, tenantId, email: `${role.toLowerCase()}@test.local`, firstName: "T", lastName: "U", role, active: true, tenant },
  };
}

const ownerOfA = () => makeSession("TENANT_OWNER", TENANT_A);
const superAdmin = () => makeSession("SUPER_ADMIN", null);

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  session = null;
});

describe("Super Admin kapıları", () => {
  it("oturumsuz kullanıcı girişe yönlendirilir", async () => {
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(RedirectSignal);
  });

  it("1) işletme sahibi ve personel Super Admin alanına erişemez (404)", async () => {
    for (const s of [ownerOfA(), makeSession("WAITER", TENANT_A)]) {
      session = s;
      await expect(requireSuperAdmin()).rejects.toBeInstanceOf(NotFoundSignal);
      await expect(requireSuperAdminTenant(TENANT_A)).rejects.toBeInstanceOf(NotFoundSignal);
    }
  });

  it("Super Admin geçerli kiracıya erişir; biçimsiz / olmayan id 404", async () => {
    session = superAdmin();
    await expect(requireSuperAdminTenant(TENANT_A)).resolves.toMatchObject({ tenant: { id: TENANT_A }, scope: { tenantId: TENANT_A } });
    await expect(requireSuperAdminTenant("../../etc")).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(requireSuperAdminTenant("czzzzzzzzzzzzzzzzzzzzzzzz")).rejects.toBeInstanceOf(NotFoundSignal);
  });
});

describe("Super Admin eylemleri — kiracı kullanıcıları reddedilir", () => {
  it("2) işletme sahibi yeni işletme oluşturamaz", async () => {
    session = ownerOfA();
    await expect(createTenantAction({ business: { name: "Yeni", slug: "yeni-isletme" } })).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.onboardTenant).not.toHaveBeenCalled();
  });

  it("3) A sahibi B işletmesini düzenleyemez (genel bilgiler, şube)", async () => {
    session = ownerOfA();
    await expect(actions.updateTenantGeneralAction(TENANT_B, null, form({ name: "Ele geçirildi" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(actions.updateBranchAction(TENANT_B, "branch_x", null, form({ name: "x" }))).rejects.toBeInstanceOf(NotFoundSignal);
    // Kendi işletmesi bile Super Admin yüzeyinden düzenlenemez.
    await expect(actions.updateTenantGeneralAction(TENANT_A, null, form({ name: "x" }))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.updateTenantGeneral).not.toHaveBeenCalled();
    expect(services.updateTenantBranch).not.toHaveBeenCalled();
  });

  it("5) durum geçişi yalnızca Super Admin; işletme sahibi askıya alamaz/aktifleştiremez", async () => {
    session = ownerOfA();
    await expect(actions.changeTenantStatusAction(TENANT_A, null, form({ to: "ACTIVE", from: "SUSPENDED" }))).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(actions.changeTenantStatusAction(TENANT_B, null, form({ to: "SUSPENDED", from: "ACTIVE" }))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(services.changeTenantStatus).not.toHaveBeenCalled();
  });

  it("Super Admin durum geçişinde önceki durum sunucudan alınır, formdaki 'from' eşleşmezse reddedilir", async () => {
    session = superAdmin();
    const stale = await actions.changeTenantStatusAction(TENANT_A, null, form({ to: "SUSPENDED", from: "TRIAL" }));
    expect(stale).toMatchObject({ ok: false });
    expect(services.changeTenantStatus).not.toHaveBeenCalled();

    const ok = await actions.changeTenantStatusAction(TENANT_A, null, form({ to: "SUSPENDED", from: "ACTIVE" }));
    expect(ok).toMatchObject({ ok: true });
    expect(services.changeTenantStatus).toHaveBeenCalledWith({ userId: "user_SUPER_ADMIN" }, expect.objectContaining({ tenantId: TENANT_A }), { from: "ACTIVE", to: "SUSPENDED", reason: undefined });
  });

  it("geçersiz hedef durum doğrulamada reddedilir", async () => {
    session = superAdmin();
    await expect(actions.changeTenantStatusAction(TENANT_A, null, form({ to: "DELETED", from: "ACTIVE" }))).resolves.toMatchObject({ ok: false });
    expect(services.changeTenantStatus).not.toHaveBeenCalled();
  });
});

describe("Destek modu", () => {
  it("destek modu olmayan Super Admin restoran paneline giremez", async () => {
    session = superAdmin();
    await expect(requireTenantUser()).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("destek modunda okuma serbest, yazma reddedilir; kapsam hedef kiracıdır", async () => {
    session = makeSession("SUPER_ADMIN", null, { tenantId: TENANT_B, startedAt: new Date() });
    await expect(requireTenantUser({ permission: "menu.manage" })).resolves.toMatchObject({ tenant: { id: TENANT_B }, scope: { tenantId: TENANT_B }, support: {} });
    await expect(requireTenantUser({ write: true })).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("işletme kullanıcısı her zaman kendi kiracısına kapsamlanır", async () => {
    session = ownerOfA();
    await expect(requireTenantUser()).resolves.toMatchObject({ scope: { tenantId: TENANT_A }, support: null });
    session = makeSession("WAITER", TENANT_A);
    await expect(requireTenantUser({ permission: "staff.manage" })).rejects.toBeInstanceOf(NotFoundSignal);
  });
});

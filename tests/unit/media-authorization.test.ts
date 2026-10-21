import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSession } from "@/lib/auth/session";
import { NotFoundSignal, navigationMock } from "../support/next-mocks";

/**
 * Sprint 13 güvenlik — görsel yükleme API'si: destek modu değiştiremez; garson / kasiyer / mutfak / bar yükleyemez;
 * şube müdürü ürün / kategori yükler ama logo / kapağı DEĞİŞTİREMEZ; kiracı oturumdan (formdaki tenantId yok sayılır);
 * başka origin reddedilir; gövde sınırı.
 */
let session: CurrentSession | null = null;
const uploadMock = vi.fn();
const removeMock = vi.fn();
const invalidateMock = vi.fn();
vi.mock("next/navigation", () => navigationMock);
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn(async () => session), getCurrentUser: vi.fn(async () => session?.user ?? null), SUPPORT_MODE_TTL_MS: 3_600_000 }));
vi.mock("@/lib/tenant/tenant-context", () => ({ getTenantContext: vi.fn(async () => ({ kind: "platform", hostname: "localhost" })) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/security/request-meta", () => ({ getRequestMeta: vi.fn(async () => ({ ipAddress: null, userAgent: null })), getRequestId: vi.fn(async () => "rid") }));
vi.mock("@/server/repositories/tenant-admin.repository", () => ({ findTenantSummaryById: vi.fn(async (_s: unknown, id: string) => ({ id, name: "A", slug: "a", status: "ACTIVE", plan: "AI", createdAt: new Date() })) }));
vi.mock("@/server/media/media.service", () => ({ uploadMedia: (...a: unknown[]) => uploadMock(...a), removeMedia: (...a: unknown[]) => removeMock(...a) }));
vi.mock("@/server/services/public-menu/public-menu-cache", () => ({ invalidatePublicMenu: (...a: unknown[]) => invalidateMock(...a) }));
vi.mock("@/server/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSeconds: 0, backend: "memory" })) }));

const { POST, DELETE } = await import("@/app/api/v1/media/route");
const { PLATFORM_ORIGIN } = await import("@/lib/domain/get-platform-url");

const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "cmbbbbbbbbbbbbbbbbbbbbbbb";
const make = (role: CurrentSession["user"]["role"], support: CurrentSession["support"] = null): CurrentSession => {
  const tenantId = role === "SUPER_ADMIN" ? null : TENANT_A;
  return { id: "s", support, user: { id: `u_${role}`, tenantId, email: "x@y.z", firstName: "A", lastName: "B", role, active: true, tenant: tenantId ? { id: tenantId, name: "A", slug: "a", status: "ACTIVE" } : null } };
};

function upload(fields: Record<string, string>, options: { origin?: string | null; headers?: Record<string, string> } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "x.jpg", { type: "image/jpeg" }));
  const origin = options.origin === undefined ? PLATFORM_ORIGIN : options.origin;
  return POST(new Request(`${PLATFORM_ORIGIN}/api/v1/media`, { method: "POST", body: form, headers: { ...(origin ? { origin } : {}), ...options.headers } }));
}
function remove(body: unknown) {
  return DELETE(new Request(`${PLATFORM_ORIGIN}/api/v1/media`, { method: "DELETE", body: JSON.stringify(body), headers: { origin: PLATFORM_ORIGIN, "content-type": "application/json" } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ ok: true, data: { assetId: "a1", image: { url: "/media/x", srcSet: null, width: 1, height: 1 }, replaced: false } });
  removeMock.mockResolvedValue({ ok: true, data: { removed: true } });
});

describe("görsel yükleme yetkisi", () => {
  it("Super Admin destek modunda yükleyemez / silemez (404)", async () => {
    session = make("SUPER_ADMIN", { tenantId: TENANT_A, startedAt: new Date() });
    await expect(upload({ kind: "PRODUCT", productId: "p1" })).rejects.toBeInstanceOf(NotFoundSignal);
    await expect(remove({ kind: "LOGO" })).rejects.toBeInstanceOf(NotFoundSignal);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it.each(["WAITER", "CASHIER", "KITCHEN", "BAR"] as const)("%s ürün görseli yükleyemez (404)", async (role) => {
    session = make(role);
    expect((await upload({ kind: "PRODUCT", productId: "p1" })).status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("şube müdürü ürün / kategori yükler; logo ve kapağı değiştiremez", async () => {
    session = make("BRANCH_MANAGER");
    expect((await upload({ kind: "PRODUCT", productId: "p1" })).status).toBe(200);
    expect((await upload({ kind: "CATEGORY", categoryId: "c1" })).status).toBe(200);
    expect((await upload({ kind: "LOGO" })).status).toBe(404);
    expect((await upload({ kind: "HERO" })).status).toBe(404);
    expect((await remove({ kind: "HERO" })).status).toBe(404);
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it("sahip: kiracı OTURUMDAN — formdaki tenantId / yol alanı yok sayılır; menü önbelleği hemen geçersiz", async () => {
    session = make("TENANT_OWNER");
    const res = await upload({ kind: "LOGO", tenantId: TENANT_B, path: "../../etc/passwd" });
    expect(res.status).toBe(200);
    const [actor, target] = uploadMock.mock.calls[0]! as [{ scope: { tenantId: string } }, unknown];
    expect(actor.scope.tenantId).toBe(TENANT_A);
    expect(target).toEqual({ kind: "LOGO" });
    expect(invalidateMock).toHaveBeenCalledWith(TENANT_A, "other");
    const json = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(json)).not.toMatch(/storage[\\/]uploads|[A-Z]:\\|\/var\//);
  });

  it("başka origin (CSRF) ve Origin'siz istek reddedilir", async () => {
    session = make("TENANT_OWNER");
    expect((await upload({ kind: "LOGO" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await upload({ kind: "LOGO" }, { origin: null })).status).toBe(403);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("beyan edilen gövde sınırı aşan istek okunmadan reddedilir (413)", async () => {
    session = make("TENANT_OWNER");
    const res = await upload({ kind: "PRODUCT", productId: "p1" }, { headers: { "content-length": String(200 * 1024 * 1024) } });
    expect(res.status).toBe(413);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("servis hatası dostça mesajla döner, istisna / yol sızmaz", async () => {
    session = make("TENANT_OWNER");
    uploadMock.mockResolvedValueOnce({ ok: false, error: "unsupported" });
    const res = await upload({ kind: "PRODUCT", productId: "p1" });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ ok: false, code: "unsupported", error: "Desteklenmeyen dosya. JPEG, PNG ya da WebP görsel yükleyin." });
  });
});

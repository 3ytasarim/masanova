import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
const svc = await import("@/server/services/staff.service");

/**
 * Personel yönetimi — gerçek PostgreSQL (Neon). İki geçici STARTER kiracı (limit 5 etkin kullanıcı):
 * rol yetki sınırları, sahip / kendi hesabı korunması, kiracı yalıtımı, paket limiti, oturum kapatma, parola işlemleri.
 */
const run = randomBytes(3).toString("hex");
const tenantIds: string[] = [];
type Scope = ReturnType<typeof createTenantScope>;

async function makeTenant(label: string) {
  const t = await prisma.tenant.create({
    data: { name: `Personel ${label} ${run}`, slug: `pers-${label}-${run}`, status: "ACTIVE", subscription: { create: { plan: "STARTER", status: "ACTIVE", internal: true } }, branches: { create: [{ name: "Merkez", slug: "merkez" }] } },
  });
  tenantIds.push(t.id);
  const owner = await prisma.user.create({ data: { tenantId: t.id, email: `owner-${label}-${run}@test.local`, firstName: "Sahip", lastName: label, role: "TENANT_OWNER", passwordHash: await hashPassword("eski-parola-123456") } });
  return { scope: createTenantScope(t.id) as Scope, owner };
}

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;
const ownerActor = () => ({ userId: A.owner.id, role: "TENANT_OWNER" as const, scope: A.scope });
const email = (n: string) => `${n}-${run}@test.local`;

beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
}, 60_000);

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user: { tenantId: { in: tenantIds } } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
}, 60_000);

describe("personel yönetimi (Neon)", () => {
  let managerId = "";
  let waiterId = "";

  it("sahip şube müdürü ekler (geçici parola tek seferlik; yalnızca özet saklanır) + denetim kaydı", async () => {
    const r = await svc.createStaff(ownerActor(), { passwordMode: "generate", firstName: "Mü", lastName: "Dür", email: email("mudur"), role: "BRANCH_MANAGER" });
    expect(r.ok).toBe(true);
    const temp = r.ok ? r.data.temporaryPassword! : "";
    expect(temp).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: email("mudur") } });
    managerId = u.id;
    expect(u.tenantId).toBe(A.scope.tenantId);
    expect(u.passwordHash).not.toContain(temp);
    expect(await verifyPassword(u.passwordHash!, temp)).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: A.scope.tenantId, action: "USER_CREATED", entityId: u.id } });
    expect(JSON.stringify(audit?.metadata)).not.toContain(temp);
  });

  it("aynı e-posta reddedilir", async () => {
    const r = await svc.createStaff(ownerActor(), { passwordMode: "manual", password: "baska-parola-123", firstName: "X", lastName: "Y", email: email("mudur"), role: "WAITER" });
    expect(r).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
  });

  it("şube müdürü yalnızca operasyon rollerini yönetir; müdür / sahip / kendi hesabı değiştirilemez", async () => {
    const mgr = { userId: managerId, role: "BRANCH_MANAGER" as const, scope: A.scope };
    expect(await svc.createStaff(mgr, { passwordMode: "generate", firstName: "A", lastName: "B", email: email("mudur2"), role: "BRANCH_MANAGER" })).toMatchObject({ ok: false });
    const w = await svc.createStaff(mgr, { passwordMode: "manual", password: "garson-parola-123", firstName: "Gar", lastName: "Son", email: email("garson"), role: "WAITER" });
    expect(w.ok).toBe(true);
    waiterId = (await prisma.user.findUniqueOrThrow({ where: { email: email("garson") } })).id;
    expect(await svc.updateStaff(mgr, waiterId, { firstName: "Gar", lastName: "Son", role: "BRANCH_MANAGER", active: true })).toMatchObject({ ok: false });
    expect(await svc.updateStaff(mgr, A.owner.id, { firstName: "S", lastName: "S", role: "WAITER", active: false })).toMatchObject({ ok: false });
    expect(await svc.updateStaff(mgr, managerId, { firstName: "M", lastName: "M", role: "WAITER", active: true })).toMatchObject({ ok: false });
    expect(await svc.resetStaffPassword(mgr, A.owner.id)).toMatchObject({ ok: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: A.owner.id } })).role).toBe("TENANT_OWNER");
  });

  it("kiracı yalıtımı: B'nin sahibi A'nın personelini göremez / değiştiremez", async () => {
    const bActor = { userId: B.owner.id, role: "TENANT_OWNER" as const, scope: B.scope };
    expect(await svc.updateStaff(bActor, waiterId, { firstName: "Hack", lastName: "X", role: "CASHIER", active: false })).toEqual({ ok: false, error: "Personel bulunamadı." });
    expect(await svc.resetStaffPassword(bActor, waiterId)).toEqual({ ok: false, error: "Personel bulunamadı." });
    expect((await svc.listStaff(B.scope)).map((s) => s.id)).not.toContain(waiterId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: waiterId } })).active).toBe(true);
  });

  it("pasifleştirme ve rol değişikliği oturumları kapatır; parola sıfırlama eski parolayı geçersiz kılar", async () => {
    const mk = () => prisma.session.create({ data: { userId: waiterId, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    await mk();
    expect((await svc.updateStaff(ownerActor(), waiterId, { firstName: "Gar", lastName: "Son", role: "CASHIER", active: true })).ok).toBe(true);
    expect(await prisma.session.count({ where: { userId: waiterId } })).toBe(0);
    await mk();
    const r = await svc.resetStaffPassword(ownerActor(), waiterId);
    expect(r.ok).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: waiterId } });
    expect(await verifyPassword(u.passwordHash!, "garson-parola-123")).toBe(false);
    expect(await verifyPassword(u.passwordHash!, r.ok ? r.data.temporaryPassword : "")).toBe(true);
    expect(await prisma.session.count({ where: { userId: waiterId } })).toBe(0);
    await mk();
    expect((await svc.updateStaff(ownerActor(), waiterId, { firstName: "Gar", lastName: "Son", role: "CASHIER", active: false })).ok).toBe(true);
    expect(await prisma.session.count({ where: { userId: waiterId } })).toBe(0);
  });

  it("paket limiti: STARTER 5 etkin kullanıcı (sahip dahil); pasif sayılmaz, yeniden aktifleştirme de limite tabi", async () => {
    // Etkin: sahip + müdür = 2 (garson pasif). 3 kişi daha → 5.
    for (const n of ["k1", "k2", "k3"]) expect((await svc.createStaff(ownerActor(), { passwordMode: "generate", firstName: n, lastName: "K", email: email(n), role: "KITCHEN" })).ok).toBe(true);
    const over = await svc.createStaff(ownerActor(), { passwordMode: "generate", firstName: "k4", lastName: "K", email: email("k4"), role: "KITCHEN" });
    expect(over).toMatchObject({ ok: false, error: expect.stringContaining("limit") });
    expect(await prisma.user.findUnique({ where: { email: email("k4") } })).toBeNull();
    expect(await svc.updateStaff(ownerActor(), waiterId, { firstName: "Gar", lastName: "Son", role: "CASHIER", active: true })).toMatchObject({ ok: false, error: expect.stringContaining("limit") });
  });

  it("kendi parolası: mevcut parola zorunlu; bu oturum korunur, diğerleri kapanır", async () => {
    const keep = await prisma.session.create({ data: { userId: A.owner.id, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    await prisma.session.create({ data: { userId: A.owner.id, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
    const actor = { ...ownerActor(), sessionId: keep.id };
    expect(await svc.changeOwnPassword(actor, { current: "yanlis-parola", next: "yeni-parola-123456" })).toMatchObject({ ok: false, fieldErrors: { current: expect.any(String) } });
    expect((await svc.changeOwnPassword(actor, { current: "eski-parola-123456", next: "yeni-parola-123456" })).ok).toBe(true);
    const sessions = await prisma.session.findMany({ where: { userId: A.owner.id }, select: { id: true } });
    expect(sessions.map((s) => s.id)).toEqual([keep.id]);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: A.owner.id } });
    expect(await verifyPassword(u.passwordHash!, "yeni-parola-123456")).toBe(true);
  });
});

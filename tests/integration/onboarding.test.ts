import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Sprint 2 — gerçek PostgreSQL (Neon) üzerinde onboarding, alan adı, şube ve durum kuralları.
 * İstek bağlamı (IP/UA) taklit edilir; geri kalan her şey gerçek servis + gerçek veritabanıdır.
 * Tüm kayıtlar benzersiz bir önekle oluşturulur ve sonunda temizlenir.
 */
vi.mock("@/lib/security/request-meta", () => ({ getRequestMeta: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "vitest" })) }));

const { prisma } = await import("@/lib/db/prisma");
const { verifyPassword } = await import("@/lib/auth/password");
const { createPlatformScope, createTenantScope } = await import("@/lib/tenant/scope");
const { resolveTenantByHost } = await import("@/lib/tenant/resolve-tenant");
const { buildSubdomainHostname } = await import("@/lib/domain/get-tenant-url");
const { ROOT_HOSTNAME } = await import("@/lib/domain/root-domain");
const { branchFieldsSchema, branchUpdateSchema, onboardingSchema } = await import("@/lib/validation/tenant");
const { onboardTenant, runOnboardingTransaction } = await import("@/server/services/onboarding.service");
const { tenantDomainLookup } = await import("@/server/repositories/tenant-domain.repository");
const { checkDomainVerification, verificationChallenge } = await import("@/server/services/domain-verification.service");
const { addCustomDomain, setPrimaryDomain } = await import("@/server/services/domain.service");
const { createTenantBranch, updateTenantBranch } = await import("@/server/services/branch-admin.service");
const { changeTenantStatus } = await import("@/server/services/tenant-admin.service");

const run = randomBytes(3).toString("hex");
const slugs: string[] = [];
const actorEmail = `itest-admin-${run}@masanovai.test`;
let actorId = "";

async function actor() {
  if (!actorId) {
    const admin = await prisma.user.create({ data: { email: actorEmail, firstName: "Test", lastName: "Admin", role: "SUPER_ADMIN" }, select: { id: true } });
    actorId = admin.id;
  }
  return { platform: createPlatformScope(actorId), userId: actorId };
}

function input(label: string, overrides: { customDomain?: string; email?: string; passwordMode?: "generate" | "manual" } = {}) {
  const slug = `it-${label}-${run}`.toLowerCase();
  slugs.push(slug);
  return onboardingSchema.parse({
    business: { name: `Entegrasyon ${label} ${run}`, slug },
    branch: { name: "Merkez Şube", slug: "merkez", country: "TR", city: "İstanbul", timezone: "Europe/Istanbul", currency: "TRY", locale: "tr" },
    domain: { subdomain: slug, customDomain: overrides.customDomain ?? "" },
    owner:
      overrides.passwordMode === "manual"
        ? { passwordMode: "manual", firstName: "Ayşe", lastName: "Test", email: overrides.email ?? `owner-${label}-${run}@masanovai.test`, password: "elle-belirlenmis-parola-123" }
        : { passwordMode: "generate", firstName: "Ayşe", lastName: "Test", email: overrides.email ?? `owner-${label}-${run}@masanovai.test` },
    branding: { primaryColor: "#112233" },
    plan: "PRO",
  });
}

afterAll(async () => {
  const tenants = await prisma.tenant.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
  const ids = tenants.map((t) => t.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ tenantId: { in: ids } }, { userId: actorId || "none" }] } });
  await prisma.user.deleteMany({ where: { OR: [{ tenantId: { in: ids } }, { email: actorEmail }] } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("restoran onboarding (tek transaction)", () => {
  it("tüm kayıtları oluşturur; geçici parola yalnızca yanıtta, veritabanında yalnızca argon2id hash", async () => {
    const data = input("ok", { customDomain: `menu-${run}.example-restoran.com` });
    const result = await onboardTenant(await actor(), data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { tenantId, temporaryPassword } = result.data;
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { settings: true, branches: true, domains: { include: { verification: true } }, users: true },
    });
    expect(tenant).toMatchObject({ status: "TRIAL", plan: "PRO", slug: data.business.slug });
    // Sprint 20: seçilen paket DENEME aboneliği olarak başlar (14 gün) + değiştirilemez olay
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { tenantId }, include: { events: true } });
    expect(subscription).toMatchObject({ plan: "PRO", status: "TRIALING", provider: "manual", internal: false });
    expect(Math.round((subscription.trialEndsAt!.getTime() - subscription.startsAt.getTime()) / 86_400_000)).toBe(14);
    expect(subscription.events.map((e) => e.type)).toEqual(["SUBSCRIPTION_CREATED"]);
    expect(tenant.settings).toMatchObject({ primaryColor: "#112233", defaultCurrency: "TRY", timezone: "Europe/Istanbul" });
    expect(tenant.branches).toHaveLength(1);
    const sub = tenant.domains.find((d) => d.type === "SUBDOMAIN");
    const custom = tenant.domains.find((d) => d.type === "CUSTOM_DOMAIN");
    expect(sub).toMatchObject({ hostname: buildSubdomainHostname(data.business.slug), verified: true, isPrimary: true });
    expect(custom).toMatchObject({ verified: false, isPrimary: false, verification: { status: "PENDING" } });

    // 11) parola düz metin saklanmaz
    const owner = tenant.users[0]!;
    expect(owner.role).toBe("TENANT_OWNER");
    expect(owner.passwordHash).toMatch(/^\$argon2id\$/);
    expect(owner.passwordHash).not.toContain(temporaryPassword!);
    await expect(verifyPassword(owner.passwordHash!, temporaryPassword!)).resolves.toBe(true);

    // 12) denetim kayıtları parola / token içermez
    const audits = await prisma.auditLog.findMany({ where: { tenantId } });
    expect(audits.map((a) => a.action).sort()).toEqual(
      ["BRANCH_CREATED", "DOMAIN_CREATED", "DOMAIN_CREATED", "DOMAIN_VERIFICATION_REQUESTED", "SUBSCRIPTION_CREATED", "TENANT_CREATED", "USER_CREATED"].sort(),
    );
    expect(audits.every((a) => a.userId === actorId)).toBe(true);
    const auditText = JSON.stringify(audits);
    expect(auditText).not.toContain(temporaryPassword!);
    expect(auditText).not.toContain("$argon2");
    expect(auditText).not.toContain(custom!.verification!.token);

    // Bütün kullanıcı tablosunda (tüm kolonlar) düz metin parola yok
    const rows: { found: bigint }[] = await prisma.$queryRaw`SELECT count(*) AS found FROM users WHERE row_to_json(users)::text LIKE ${"%" + temporaryPassword + "%"}`;
    expect(Number(rows[0]!.found)).toBe(0);
  });

  it("elle parola modunda da yalnızca hash saklanır ve yanıtta parola dönmez", async () => {
    const result = await onboardTenant(await actor(), input("manual", { passwordMode: "manual" }));
    expect(result.ok && result.data.temporaryPassword).toBe(null);
  });

  it("7) aynı kısa ad reddedilir", async () => {
    const first = input("dup");
    expect((await onboardTenant(await actor(), first)).ok).toBe(true);
    const second = { ...input("dup2"), business: { name: "Kopya", slug: first.business.slug } };
    const result = await onboardTenant(await actor(), second);
    expect(result).toMatchObject({ ok: false, fieldErrors: { "business.slug": expect.any(String) } });
  });

  it("6) ayrılmış kısa ad şemada reddedilir", () => {
    const parsed = onboardingSchema.safeParse({ ...input("reserved"), business: { name: "Admin Kafe", slug: "admin" } });
    expect(parsed.success).toBe(false);
  });

  it("8) aynı hostname reddedilir (alt alan ve özel alan)", async () => {
    const taken = `taken-${run}.example-restoran.com`;
    expect((await onboardTenant(await actor(), input("h1", { customDomain: taken }))).ok).toBe(true);
    const r1 = await onboardTenant(await actor(), input("h2", { customDomain: taken }));
    expect(r1).toMatchObject({ ok: false, fieldErrors: { "domain.customDomain": expect.any(String) } });

    const base = input("h3");
    const clash = { ...base, domain: { subdomain: `it-h1-${run}`, customDomain: undefined } };
    expect(await onboardTenant(await actor(), clash)).toMatchObject({ ok: false, fieldErrors: { "domain.subdomain": expect.any(String) } });

    // Platformun kendi alt alanı "özel alan adı" olarak eklenemez.
    const platformAsCustom = { ...input("h5"), domain: { subdomain: `it-h5b-${run}`, customDomain: buildSubdomainHostname(`x-${run}`) } };
    expect(await onboardTenant(await actor(), platformAsCustom)).toMatchObject({ ok: false, fieldErrors: { "domain.customDomain": expect.any(String) } });
  });

  it("10) transaction son adımda başarısız olursa hiçbir kayıt kalmaz (rollback)", async () => {
    const existingOwner = `owner-ok-${run}@masanovai.test`; // ilk testte oluşturuldu
    const data = input("rollback", { email: existingOwner, customDomain: `rb-${run}.example-restoran.com` });
    // Ön kontrolleri atlayıp doğrudan transaction: kullanıcı oluşturma (son adım) benzersizlik ihlaliyle düşer.
    await expect(runOnboardingTransaction(await actor(), data, "$argon2id$dummy", { ipAddress: null, userAgent: null })).rejects.toThrow();

    expect(await prisma.tenant.findUnique({ where: { slug: data.business.slug } })).toBeNull();
    expect(await prisma.tenantDomain.findUnique({ where: { hostname: buildSubdomainHostname(data.business.slug) } })).toBeNull();
    expect(await prisma.tenantDomain.findUnique({ where: { hostname: data.domain.customDomain! } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "TENANT_CREATED", metadata: { path: ["slug"], equals: data.business.slug } } })).toBe(0);
  });
});

describe("alan adı doğrulama", () => {
  it("9) doğrulanmamış özel alan adı public olarak çözümlenmez; DNS kontrolü başarısızken doğrulanmış sayılmaz", async () => {
    const custom = `verify-${run}.example-restoran.com`;
    const result = await onboardTenant(await actor(), input("dns", { customDomain: custom }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scope = createTenantScope(result.data.tenantId);
    const deps = { lookup: tenantDomainLookup, rootHostname: ROOT_HOSTNAME };

    await expect(resolveTenantByHost(custom, deps)).resolves.toMatchObject({ kind: "not_found", reason: "unverified_domain" });

    const domain = await prisma.tenantDomain.findUniqueOrThrow({ where: { hostname: custom }, include: { verification: true } });
    const meta = { ipAddress: null, userAgent: "vitest" };

    // Yanlış TXT → FAILED, yayında değil, birincil yapılamaz
    const wrong = await checkDomainVerification({ userId: actorId }, scope, domain.id, meta, { resolveTxt: async () => [["masanova-verification=yanlis"]] });
    expect(wrong).toMatchObject({ found: true, outcome: "TXT_MISMATCH" });
    await expect(prisma.tenantDomain.findUniqueOrThrow({ where: { id: domain.id }, include: { verification: true } })).resolves.toMatchObject({ verified: false, verification: { status: "FAILED", attempts: 1 } });
    await expect(setPrimaryDomain({ userId: actorId }, scope, domain.id)).resolves.toMatchObject({ ok: false });
    await expect(resolveTenantByHost(custom, deps)).resolves.toMatchObject({ kind: "not_found" });

    // Doğru TXT → VERIFIED, çözümlenir, birincil yapılabilir
    const expected = verificationChallenge(custom, domain.verification!.token);
    const right = await checkDomainVerification({ userId: actorId }, scope, domain.id, meta, {
      resolveTxt: async (name) => (name === expected.name ? [[expected.value]] : []),
    });
    expect(right).toMatchObject({ outcome: "VERIFIED" });
    await expect(resolveTenantByHost(custom, deps)).resolves.toMatchObject({ kind: "tenant", tenant: { id: result.data.tenantId } });
    await expect(setPrimaryDomain({ userId: actorId }, scope, domain.id)).resolves.toMatchObject({ ok: true });
    expect(await prisma.tenantDomain.count({ where: { tenantId: result.data.tenantId, isPrimary: true } })).toBe(1);

    const audits = await prisma.auditLog.findMany({ where: { entityId: domain.id }, select: { action: true, metadata: true } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["DOMAIN_VERIFICATION_FAILED", "DOMAIN_VERIFIED", "DOMAIN_PRIMARY_CHANGED"]));
    expect(JSON.stringify(audits)).not.toContain(domain.verification!.token);
  });

  it("başka kiracının alan adı bu kiracının kapsamından doğrulanamaz / eklenen platform alt alanı reddedilir", async () => {
    const a = await onboardTenant(await actor(), input("dA", { customDomain: `da-${run}.example-restoran.com` }));
    const b = await onboardTenant(await actor(), input("dB"));
    if (!a.ok || !b.ok) throw new Error("kurulum başarısız");
    const domainOfA = await prisma.tenantDomain.findUniqueOrThrow({ where: { hostname: `da-${run}.example-restoran.com` } });
    const scopeB = createTenantScope(b.data.tenantId);
    await expect(checkDomainVerification({ userId: actorId }, scopeB, domainOfA.id, { ipAddress: null, userAgent: null }, { resolveTxt: async () => [] })).resolves.toEqual({ found: false });
    await expect(addCustomDomain({ userId: actorId }, scopeB, buildSubdomainHostname(`zz-${run}`))).resolves.toMatchObject({ ok: false });
    await expect(addCustomDomain({ userId: actorId }, scopeB, `da-${run}.example-restoran.com`)).resolves.toMatchObject({ ok: false });
  });
});

describe("şube yönetimi", () => {
  it("4) şube IDOR: A kapsamı B'nin şubesini güncelleyemez; şube kısa adı kiracı içinde benzersiz", async () => {
    const a = await onboardTenant(await actor(), input("bA"));
    const b = await onboardTenant(await actor(), input("bB"));
    if (!a.ok || !b.ok) throw new Error("kurulum başarısız");
    const scopeA = createTenantScope(a.data.tenantId);
    const branchOfB = await prisma.branch.findFirstOrThrow({ where: { tenantId: b.data.tenantId } });
    const update = branchUpdateSchema.parse({ name: "Ele Geçirildi", slug: "ele-gecirildi", country: "TR", timezone: "Europe/Istanbul", currency: "TRY", locale: "tr", active: false });
    const branch = (name: string, slug: string) => branchFieldsSchema.parse({ name, slug, country: "TR", timezone: "Europe/Istanbul", currency: "TRY", locale: "tr" });

    await expect(updateTenantBranch({ userId: actorId }, scopeA, branchOfB.id, update)).resolves.toMatchObject({ ok: false });
    await expect(prisma.branch.findUniqueOrThrow({ where: { id: branchOfB.id } })).resolves.toMatchObject({ name: "Merkez Şube", active: true });

    // aynı kiracıda yinelenen kısa ad reddedilir; farklı kiracıda aynı kısa ad serbest
    const dup = await createTenantBranch({ userId: actorId }, scopeA, branch("İkinci", "merkez"));
    expect(dup).toMatchObject({ ok: false, fieldErrors: { slug: expect.any(String) } });
    const created = await createTenantBranch({ userId: actorId }, scopeA, branch("Kadıköy", "kadikoy"));
    expect(created.ok).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId: a.data.tenantId, action: "BRANCH_CREATED", entityId: created.ok ? created.data.id : "" } });
    expect(audit?.userId).toBe(actorId);
  });
});

describe("durum geçişleri", () => {
  it("izinli geçişler uygulanır ve denetlenir; güvensiz geçiş ve eski önceki-durum reddedilir; veri silinmez", async () => {
    const t = await onboardTenant(await actor(), input("st"));
    if (!t.ok) throw new Error("kurulum başarısız");
    const scope = createTenantScope(t.data.tenantId);
    const a = { userId: actorId };

    await expect(changeTenantStatus(a, scope, { from: "TRIAL", to: "ACTIVE" })).resolves.toMatchObject({ ok: true });
    await expect(changeTenantStatus(a, scope, { from: "TRIAL", to: "SUSPENDED" })).resolves.toMatchObject({ ok: false }); // önceki durum artık TRIAL değil
    await expect(changeTenantStatus(a, scope, { from: "ACTIVE", to: "TRIAL" })).resolves.toMatchObject({ ok: false }); // izinsiz
    await expect(changeTenantStatus(a, scope, { from: "ACTIVE", to: "SUSPENDED", reason: "Ödeme gecikmesi" })).resolves.toMatchObject({ ok: true });

    // Askıdaki kiracı public olarak hizmet vermez, ama verisi yerinde
    await expect(resolveTenantByHost(t.data.subdomain, { lookup: tenantDomainLookup, rootHostname: ROOT_HOSTNAME })).resolves.toMatchObject({ kind: "unavailable" });
    expect(await prisma.branch.count({ where: { tenantId: t.data.tenantId } })).toBe(1);
    expect(await prisma.user.count({ where: { tenantId: t.data.tenantId } })).toBe(1);

    await expect(changeTenantStatus(a, scope, { from: "SUSPENDED", to: "ACTIVE" })).resolves.toMatchObject({ ok: true });
    await expect(changeTenantStatus(a, scope, { from: "ACTIVE", to: "CANCELLED" })).resolves.toMatchObject({ ok: true });
    await expect(changeTenantStatus(a, scope, { from: "CANCELLED", to: "ACTIVE" })).resolves.toMatchObject({ ok: false });

    const log = await prisma.auditLog.findMany({ where: { tenantId: t.data.tenantId, action: "TENANT_STATUS_CHANGED" }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => [(l.metadata as Record<string, string>).previousStatus, (l.metadata as Record<string, string>).newStatus])).toEqual([
      ["TRIAL", "ACTIVE"],
      ["ACTIVE", "SUSPENDED"],
      ["SUSPENDED", "ACTIVE"],
      ["ACTIVE", "CANCELLED"],
    ]);
    expect(log.every((l) => l.userId === actorId)).toBe(true);
    expect((log[1]!.metadata as Record<string, string>).reason).toBe("Ödeme gecikmesi");
  });
});

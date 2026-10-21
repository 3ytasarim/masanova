import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantResolution } from "@/lib/tenant/resolve-tenant";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { resolveStableQrEntry } = await import("@/lib/tables/resolve-stable-entry");
const { resolveTableQrToken } = await import("@/lib/tables/resolve-table-token");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { publicThemeSchema } = await import("@/lib/validation/public-menu");
const { qrTokenLookup, stableEntryLookup } = await import("@/server/repositories/table-qr.repository");
const { getPublishedMenu } = await import("@/server/services/menu/public-menu.service");
const { loadPublicPresentation } = await import("@/server/services/public-menu/public-menu-cache");
const { toPublicMenuView } = await import("@/server/services/public-menu/serialize");
const { createMenuRefs } = await import("@/server/services/orders/menu-refs");
const { savePublicTheme } = await import("@/server/services/public-menu/theme.service");
const { createTableQr, revealTableQr, revokeTableQr } = await import("@/server/services/tables/qr.service");


/**
 * Public QR menü + kararlı QR girişi — gerçek PostgreSQL (Neon). İki geçici kiracı; sonunda silinir.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };

type Fixture = Awaited<ReturnType<typeof makeTenant>>;
let A: Fixture;
let B: Fixture;

async function makeTenant(label: string) {
  const hostname = `pm-${label}-${run}.localhost`;
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Menü ${label} ${run}`,
      slug: `pm-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr", defaultCurrency: "TRY" } },
      domains: { create: { hostname, type: "SUBDOMAIN", isPrimary: true } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }, { name: "Kadıköy", slug: "kadikoy" }] },
      users: { create: { email: `pm-${label}-${run}@masanovai.test`, firstName: "P", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, name: true, slug: true, status: true, plan: true, branches: { orderBy: { slug: "desc" }, select: { id: true } }, users: { select: { id: true } } },
  });
  const tenantId = tenant.id;
  const [merkez, kadikoy] = [tenant.branches[0]!.id, tenant.branches[1]!.id];
  const category = await prisma.menuCategory.create({ data: { tenantId, name: `Burgerler ${label}`, slug: "burgerler" } });
  const mk = (slug: string, extra: Record<string, unknown> = {}) =>
    prisma.product.create({ data: { tenantId, categoryId: category.id, name: `${slug} ${label}`, slug, basePriceMinor: 10000, sku: `SKU-SECRET-${label}`, ...extra }, select: { id: true } });
  const burger = await mk("burger", { allergensConfirmedAt: new Date() });
  const hidden = await mk("subede-yok");
  const soldOut = await mk("tukenen");
  await mk("arsivli", { archivedAt: new Date() });
  await mk("pasif", { active: false });
  const variant = await prisma.productVariant.create({ data: { tenantId, productId: burger.id, name: "Büyük", priceMinor: 15000, isDefault: true } });
  await prisma.productTranslation.create({ data: { tenantId, productId: burger.id, locale: "en", name: `Burger EN ${label}`, shortDescription: "Juicy" } });
  // Kadıköy: "satılmıyor", "tükendi", şube fiyatı
  await prisma.branchProduct.create({ data: { tenantId, branchId: kadikoy, productId: hidden.id, available: false } });
  await prisma.branchProduct.create({ data: { tenantId, branchId: kadikoy, productId: soldOut.id, soldOut: true } });
  await prisma.branchVariantPrice.create({ data: { tenantId, branchId: kadikoy, variantId: variant.id, priceMinor: 17500 } });
  const area = await prisma.diningArea.create({ data: { tenantId, branchId: kadikoy, name: "Teras", slug: "teras" } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId: kadikoy, diningAreaId: area.id, name: "Masa 12", number: 12 } });
  const actor = { userId: tenant.users[0]!.id, scope: createTenantScope(tenantId), meta };
  const host: TenantResolution = { kind: "tenant", tenant: { id: tenantId, name: tenant.name, slug: tenant.slug, status: tenant.status, plan: tenant.plan, domain: { hostname, type: "SUBDOMAIN", isPrimary: true } } };
  return { tenantId, hostname, merkez, kadikoy, tableId: table.id, actor, host };
}

async function stableToken(f: Fixture) {
  const r = await revealTableQr(f.actor.scope, f.tableId);
  if (!r.ok) throw new Error(r.reason);
  return r.qr.url.split("/q/")[1]!;
}

beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
  await createTableQr(A.actor, A.tableId);
  await createTableQr(B.actor, B.tableId);
});

afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantDomain.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

const presentationOf = (f: Fixture) => loadPublicPresentation(f.actor.scope);
async function viewFor(f: Fixture, branchId: string, locale = "tr") {
  return toPublicMenuView(await getPublishedMenu(f.actor.scope, { branchId, locale }), await presentationOf(f), { table: { name: "Masa 12", area: "Teras" }, refOf: createMenuRefs(f.tenantId), ordering: null });
}

describe("yayınlanmış public menü (gerçek veri)", () => {
  it("şube kuralları: gizli ürün yok, tükenen görünür + işaretli, arşivli/pasif yok", async () => {
    const view = await viewFor(A, A.kadikoy);
    const keys = view.categories.flatMap((c) => c.products.map((p) => p.key));
    expect(keys.sort()).toEqual(["burger", "tukenen"]);
    expect(view.categories[0]!.products.find((p) => p.key === "tukenen")!.soldOut).toBe(true);
    const merkez = await viewFor(A, A.merkez);
    expect(merkez.categories.flatMap((c) => c.products.map((p) => p.key)).sort()).toEqual(["burger", "subede-yok", "tukenen"]);
    expect(merkez.categories[0]!.products.find((p) => p.key === "tukenen")!.soldOut).toBe(false);
  });

  it("şube varyant fiyatı yalnızca o şubede uygulanır", async () => {
    const kadikoy = (await viewFor(A, A.kadikoy)).categories[0]!.products.find((p) => p.key === "burger")!;
    const merkez = (await viewFor(A, A.merkez)).categories[0]!.products.find((p) => p.key === "burger")!;
    expect(kadikoy.variants[0]!.priceLabel).toBe("₺175,00");
    expect(merkez.variants[0]!.priceLabel).toBe("₺150,00");
  });

  it("çeviri: EN var → EN; DE yok → varsayılan içerik (boş / undefined yok)", async () => {
    const en = (await viewFor(A, A.kadikoy, "en")).categories[0]!.products.find((p) => p.key === "burger")!;
    const de = (await viewFor(A, A.kadikoy, "de")).categories[0]!.products.find((p) => p.key === "burger")!;
    expect(en.name).toBe("Burger EN a");
    expect(de.name).toBe("burger a");
    expect(JSON.stringify(de)).not.toMatch(/undefined|"name":""/);
  });

  it("yönetim alanları (SKU, iç kimlikler) yükte yok", async () => {
    const json = JSON.stringify(await viewFor(A, A.kadikoy));
    expect(json).not.toContain("SKU-SECRET");
    expect(json).not.toContain(A.tenantId);
    expect(json).not.toContain(A.kadikoy);
    expect(json).not.toContain(A.tableId);
  });

  it("kiracı izolasyonu: A'nın bağlamı yalnızca A'nın menüsünü üretir; A, B'nin şubesiyle menü alamaz", async () => {
    const view = await viewFor(A, A.kadikoy);
    const json = JSON.stringify(view);
    for (const foreign of ["burger b", "Burgerler b", "Burger EN b", "SKU-SECRET-b"]) expect(json).not.toContain(foreign);
    expect(json).toContain("burger a");
    await expect(getPublishedMenu(A.actor.scope, { branchId: B.kadikoy, locale: "tr" })).rejects.toThrow("branch_not_found");
  });
});

describe("kararlı QR girişi (gerçek veri)", () => {
  const stable = (token: string) => resolveStableQrEntry({ token }, { lookup: stableEntryLookup });

  it("kararlı adres token sahibinin alan adına yönlendirir; B'nin alan adına asla", async () => {
    const tokenA = await stableToken(A);
    expect(await stable(tokenA)).toEqual({ ok: true, hostname: A.hostname, path: `/t/${tokenA}` });
    const tokenB = await stableToken(B);
    expect(await stable(tokenB)).toMatchObject({ ok: true, hostname: B.hostname });
  });

  it("birincil alan adı değişince AYNI basılı QR yeni alan adına gider; eski doğrudan adres B host'unda çalışmaz", async () => {
    const token = await stableToken(A);
    const newHost = `pm-a2-${run}.localhost`;
    await prisma.$transaction([
      prisma.tenantDomain.updateMany({ where: { tenantId: A.tenantId }, data: { isPrimary: false } }),
      prisma.tenantDomain.create({ data: { tenantId: A.tenantId, hostname: newHost, type: "SUBDOMAIN", isPrimary: true } }),
    ]);
    expect(await stable(token)).toEqual({ ok: true, hostname: newHost, path: `/t/${token}` });
    // Yeni host'ta host'a bağlı çözümleyici de çalışır; B'nin host'unda çalışmaz.
    const newHostA: TenantResolution = A.host.kind === "tenant" ? { kind: "tenant", tenant: { ...A.host.tenant, domain: { hostname: newHost, type: "SUBDOMAIN", isPrimary: true } } } : A.host;
    expect((await resolveTableQrToken({ host: newHostA, token }, { lookup: qrTokenLookup })).ok).toBe(true);
    expect(await resolveTableQrToken({ host: B.host, token }, { lookup: qrTokenLookup })).toEqual({ ok: false, reason: "tenant_mismatch" });
  });

  it("askıya alınan kiracı ve iptal edilen token reddedilir; bilinmeyen token nötr", async () => {
    const tokenB = await stableToken(B);
    await prisma.tenant.update({ where: { id: B.tenantId }, data: { status: "SUSPENDED" } });
    expect(await stable(tokenB)).toEqual({ ok: false, reason: "tenant_unavailable" });
    await prisma.tenant.update({ where: { id: B.tenantId }, data: { status: "ACTIVE" } });

    const tokenA = await stableToken(A);
    await revokeTableQr(A.actor, A.tableId);
    expect(await stable(tokenA)).toEqual({ ok: false, reason: "revoked" });
    expect(await stable("AAAAAAAAAAAAAAAAAAAAAA")).toEqual({ ok: false, reason: "unknown" });
  });

  it("pasif masa reddedilir", async () => {
    const tokenB = await stableToken(B);
    await prisma.diningTable.update({ where: { id: B.tableId }, data: { active: false } });
    expect(await stable(tokenB)).toEqual({ ok: false, reason: "inactive" });
    await prisma.diningTable.update({ where: { id: B.tableId }, data: { active: true } });
  });

  it("denetim kayıtlarında ham token yok", async () => {
    const tokenB = await stableToken(B);
    const logs = JSON.stringify(await prisma.auditLog.findMany({ where: { tenantId: { in: [A.tenantId, B.tenantId] } }, select: { metadata: true } }));
    expect(logs).not.toContain(tokenB);
  });
});

describe("QR menü görünüm ayarları", () => {
  it("kaydedilir, okunur, denetime yazılır; HTML işaretleri temizlenir", async () => {
    const input = publicThemeSchema.parse({
      style: "LUXURY",
      primaryColor: "#1E3A8A",
      accentColor: "",
      logoUrl: "",
      heroImageUrl: "https://images.example.com/hero.jpg",
      welcomeText: "Hoş geldiniz <script>alert(1)</script>",
      showNutrition: false,
      showAllergens: true,
      showIngredients: true,
      showPreparationTime: false,
      showPoweredBy: false,
    });
    expect((await savePublicTheme(A.actor, input)).ok).toBe(true);
    const p = await presentationOf(A);
    expect(p).toMatchObject({ style: "LUXURY", primaryColor: "#1e3a8a", accentColor: null, heroImageUrl: "https://images.example.com/hero.jpg", showNutrition: false, showPoweredBy: false });
    expect(p.welcomeText).not.toMatch(/[<>]/);
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "PUBLIC_MENU_SETTINGS_UPDATED" } })).toBe(1);
    const view = await viewFor(A, A.kadikoy);
    expect(view.theme.style).toBe("LUXURY");
    expect(view.categories[0]!.products.every((x) => x.nutrition === null && x.preparationMinutes === null)).toBe(true);
    // B etkilenmez.
    expect((await presentationOf(B)).style).toBe("MODERN");
  });

  it("geçersiz girdi reddedilir (renk, iç ağ görsel adresi, düzen)", () => {
    expect(publicThemeSchema.safeParse({ style: "NEON", showNutrition: true, showAllergens: true, showIngredients: true, showPreparationTime: true, showPoweredBy: true }).success).toBe(false);
    const base = { style: "VISUAL", showNutrition: true, showAllergens: true, showIngredients: true, showPreparationTime: true, showPoweredBy: true };
    expect(publicThemeSchema.safeParse({ ...base, primaryColor: "red" }).success).toBe(false);
    expect(publicThemeSchema.safeParse({ ...base, heroImageUrl: "http://images.example.com/a.jpg" }).success).toBe(false);
    expect(publicThemeSchema.safeParse({ ...base, heroImageUrl: "https://127.0.0.1/a.jpg" }).success).toBe(false);
  });
});

import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { exeBytes, fakeJpeg, jpegWithGps, pngBombHeader, solid, transparentPng } from "../support/images";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: (...a: unknown[]) => revalidateTag(...a), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { getServerEnv } = await import("@/lib/env");
const { LocalImageStorageProvider } = await import("@/server/media/storage/local");
const { setImageStorageForTests } = await import("@/server/media/storage");
const { uploadMedia, removeMedia, getTenantMediaUsage } = await import("@/server/media/media.service");
const { prefixBelongsToTenant } = await import("@/server/media/keys");
const { cleanupOrphanMedia } = await import("@/server/media/cleanup");
const { getPublishedMenu } = await import("@/server/services/menu/public-menu.service");
const { loadPublicPresentation, invalidatePublicMenu, publicMenuTag } = await import("@/server/services/public-menu/public-menu-cache");
const { getLabelBrand } = await import("@/server/services/tables/label.service");
const { updateProductImage } = await import("@/server/services/menu/product.service");

/**
 * Sprint 13 — yüklenen görseller, gerçek PostgreSQL (Neon) + GEÇİCİ yükleme klasörü (gerçek UPLOAD_ROOT'a yazılmaz).
 * İki kiracı; sonunda kiracılar (ve CASCADE ile varlık satırları) ve geçici klasör silinir.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: null };
let root: string;
let storage: InstanceType<typeof LocalImageStorageProvider>;

type Fx = Awaited<ReturnType<typeof makeTenant>>;
let A: Fx;
let B: Fx;

async function makeTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "PRO", status: "ACTIVE", internal: true } },
      name: `Medya ${label} ${run}`,
      slug: `md-${label}-${run}`,
      status: "ACTIVE",
      plan: "PRO",
      settings: { create: { defaultLocale: "tr", timezone: "Europe/Istanbul", defaultCurrency: "TRY" } },
      branches: { create: [{ name: "Merkez", slug: "merkez", timezone: "Europe/Istanbul" }] },
    },
    select: { id: true, branches: { select: { id: true } } },
  });
  const tenantId = tenant.id;
  const owner = await prisma.user.create({ data: { tenantId, email: `owner-${label}-${run}@e2e.masanovai.test`, firstName: "O", lastName: label, role: "TENANT_OWNER" } });
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Burgerler", slug: "burgerler" } });
  const legacyCat = await prisma.menuCategory.create({ data: { tenantId, name: "Tatlılar", slug: "tatlilar", imageUrl: "https://images.example.com/tatli.jpg" } });
  const burger = await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Cheeseburger", slug: "cheeseburger", basePriceMinor: 30000 } });
  const legacy = await prisma.product.create({ data: { tenantId, categoryId: legacyCat.id, name: "Künefe", slug: "kunefe", basePriceMinor: 20000 } });
  await prisma.productImage.create({ data: { tenantId, productId: legacy.id, storageProvider: "external", storageKey: "https://images.example.com/kunefe.jpg", isPrimary: true } });
  return { tenantId, scope: createTenantScope(tenantId), branchId: tenant.branches[0]!.id, actor: { userId: owner.id, scope: createTenantScope(tenantId), meta }, cat, legacyCat, burger, legacy };
}

const menu = (fx: Fx) => getPublishedMenu(fx.scope, { branchId: fx.branchId, locale: "tr" });
const productOf = async (fx: Fx, slug: string) => (await menu(fx)).categories.flatMap((c) => [...c.products, ...c.children.flatMap((x) => x.products)]).find((p) => p.slug === slug)!;
async function filesOf(prefix: string): Promise<string[]> {
  return readdir(path.join(root, ...prefix.split("/"))).catch(() => []);
}
const assetOf = (id: string) => prisma.mediaAsset.findUnique({ where: { id } });

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "masanova-media-it-"));
  storage = new LocalImageStorageProvider(root, "/media");
  setImageStorageForTests(storage);
  [A, B] = await Promise.all([makeTenant("a"), makeTenant("b")]);
});

afterAll(async () => {
  setImageStorageForTests(null);
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  // Kiracı silme, bileşik FK'li varlık satırlarıyla birlikte CASCADE çalışmalı.
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  expect(await prisma.mediaAsset.count({ where: { tenantId: { in: ids } } })).toBe(0);
  await rm(root, { recursive: true, force: true });
});

describe("ürün görseli", () => {
  let firstAssetId: string;
  let firstPrefix: string;

  it("1. ürün görseli yüklenir: varlık + ürün görseli + diskte çıktılar", async () => {
    const r = await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id, altText: "Cheeseburger" }, await solid(1600, 1200));
    if (!r.ok) throw new Error(r.error);
    firstAssetId = r.data.assetId;
    const asset = (await assetOf(firstAssetId))!;
    firstPrefix = asset.storageKey;
    expect(asset).toMatchObject({ tenantId: A.tenantId, kind: "PRODUCT", storageProvider: "local", mimeType: "image/webp", width: 1600, height: 1200 });
    expect(prefixBelongsToTenant(asset.storageKey, A.tenantId, getServerEnv().QR_TOKEN_SECRET)).toBe(true);
    expect((await filesOf(asset.storageKey)).sort()).toEqual(["lg.webp", "md.webp", "sm.webp"]);
    const image = await prisma.productImage.findFirstOrThrow({ where: { productId: A.burger.id } });
    expect(image).toMatchObject({ storageProvider: "media", storageKey: firstAssetId, mediaAssetId: firstAssetId, isPrimary: true, altText: "Cheeseburger" });
    expect(r.data.replaced).toBe(false);
  });

  it("2. public menü görseli gösterir (sürümlü /media adresi + srcset; dosya yolu yok)", async () => {
    const p = await productOf(A, "cheeseburger");
    expect(p.images[0]!.url).toBe(`/media/${firstPrefix}/md.webp`);
    expect(p.images[0]!.srcSet).toContain("sm.webp 400w");
    expect(p.images[0]!.srcSet).toContain("lg.webp 1600w");
    expect(JSON.stringify(p.images)).not.toContain(root);
  });

  let secondAssetId: string;
  it("3–4. değiştirme: yeni varlık bağlanır, eski varlık satırı ve dosyaları silinir; eski adres artık referanssız", async () => {
    const image = await prisma.productImage.findFirstOrThrow({ where: { productId: A.burger.id } });
    const r = await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id, replaceImageId: image.id }, await solid(1200, 900, { r: 10, g: 10, b: 200 }));
    if (!r.ok) throw new Error(r.error);
    secondAssetId = r.data.assetId;
    expect(r.data.replaced).toBe(true);
    expect(secondAssetId).not.toBe(firstAssetId);
    expect(await assetOf(firstAssetId)).toBeNull();
    expect(await filesOf(firstPrefix)).toEqual([]);
    const after = await prisma.productImage.findUniqueOrThrow({ where: { id: image.id } });
    expect(after.mediaAssetId).toBe(secondAssetId);
    const p = await productOf(A, "cheeseburger");
    expect(p.images.some((i) => i.url.includes(firstPrefix))).toBe(false);
    expect(p.images[0]!.url).toContain((await assetOf(secondAssetId))!.storageKey);
  });

  it("5. kaldırma (panel eylemi): görsel, varlık ve dosyalar gider", async () => {
    const image = await prisma.productImage.findFirstOrThrow({ where: { productId: A.burger.id } });
    const prefix = (await assetOf(secondAssetId))!.storageKey;
    expect((await updateProductImage(A.actor, A.burger.id, image.id, { kind: "remove" })).ok).toBe(true);
    expect(await prisma.productImage.count({ where: { productId: A.burger.id } })).toBe(0);
    expect(await assetOf(secondAssetId)).toBeNull();
    expect(await filesOf(prefix)).toEqual([]);
    expect((await productOf(A, "cheeseburger")).images).toEqual([]);
  });
});

describe("kategori / kapak / logo", () => {
  it("6. kategori banner'ı: 1500×500 gösterim, menüde görünür, harici adres yerine geçer", async () => {
    const r = await uploadMedia(A.actor, { kind: "CATEGORY", categoryId: A.cat.id }, await solid(3000, 1200));
    if (!r.ok) throw new Error(r.error);
    const asset = (await assetOf(r.data.assetId))!;
    expect((await filesOf(asset.storageKey)).sort()).toEqual(["lg.webp", "orig.webp", "sm.webp"]);
    const cat = (await menu(A)).categories.find((c) => c.slug === "burgerler")!;
    expect(cat.imageUrl).toBe(`/media/${asset.storageKey}/lg.webp`);
    const lg = await storage.get(`${asset.storageKey}/lg.webp`);
    expect(await sharp(lg!.data).metadata()).toMatchObject({ width: 1500, height: 500 });
  });

  it("7. kapak: sunum ayarlarında yönetilen kapak", async () => {
    const r = await uploadMedia(A.actor, { kind: "HERO" }, await solid(2400, 900, undefined, "png"));
    if (!r.ok) throw new Error(r.error);
    const p = await loadPublicPresentation(A.scope);
    expect(p.heroManaged).toBe(true);
    expect(p.heroImageUrl).toMatch(/^\/media\/tenants\/[A-Za-z0-9_-]+\/hero\/[A-Za-z0-9_-]+\/lg\.webp$/);
    expect(p.heroExternalUrl).toBeNull();
  });

  it("8. logo: şeffaf, menüde + panel etiket PDF'inde (PNG, ağ isteği yok)", async () => {
    await prisma.tenantSettings.update({ where: { tenantId: A.tenantId }, data: { logoUrl: "https://images.example.com/eski-logo.png" } });
    const r = await uploadMedia(A.actor, { kind: "LOGO" }, await transparentPng(600, 300));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.replaced).toBe(true); // harici logonun yerine geçti
    const p = await loadPublicPresentation(A.scope);
    expect(p).toMatchObject({ logoManaged: true, logoExternalUrl: null });
    expect(p.logoUrl).toMatch(/\/logo\/[A-Za-z0-9_-]+\/md\.webp$/);
    const md = await storage.get(p.logoUrl!.replace(/^\/media\//, ""));
    expect((await sharp(md!.data).metadata()).hasAlpha).toBe(true);
    const brand = await getLabelBrand(A.scope, true);
    expect(brand.logo).toMatchObject({ mime: "image/png", width: 512, height: 256 });
    expect(brand.logoFailed).toBe(false);
  });

  it("logo / kapak kaldırma: referans + varlık + dosyalar", async () => {
    const settings = await prisma.tenantSettings.findUniqueOrThrow({ where: { tenantId: A.tenantId }, include: { logoAsset: true } });
    const prefix = settings.logoAsset!.storageKey;
    expect((await removeMedia(A.actor, { kind: "LOGO" })).ok).toBe(true);
    expect(await assetOf(settings.logoAsset!.id)).toBeNull();
    expect(await filesOf(prefix)).toEqual([]);
    expect((await loadPublicPresentation(A.scope)).logoUrl).toBeNull();
  });
});

describe("kiracı yalıtımı ve güvenlik", () => {
  it("9. B, A'nın ürün görselini değiştiremez / silemez, A'nın kategorisine yükleyemez; FK çapraz bağlamayı engeller", async () => {
    const up = await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id }, await solid(800, 600));
    if (!up.ok) throw new Error(up.error);
    const image = await prisma.productImage.findFirstOrThrow({ where: { productId: A.burger.id } });
    // B, A'nın kimlikleriyle
    expect(await uploadMedia(B.actor, { kind: "PRODUCT", productId: A.burger.id, replaceImageId: image.id }, await solid(100, 100))).toEqual({ ok: false, error: "not_found" });
    expect(await uploadMedia(B.actor, { kind: "PRODUCT", productId: B.burger.id, replaceImageId: image.id }, await solid(100, 100))).toEqual({ ok: false, error: "not_found" });
    expect(await removeMedia(B.actor, { kind: "PRODUCT", productId: A.burger.id, imageId: image.id })).toEqual({ ok: false, error: "not_found" });
    expect(await uploadMedia(B.actor, { kind: "CATEGORY", categoryId: A.cat.id }, await solid(100, 100))).toEqual({ ok: false, error: "not_found" });
    expect(await removeMedia(B.actor, { kind: "CATEGORY", categoryId: A.cat.id })).toEqual({ ok: false, error: "not_found" });
    // A'nın görseli sağlam
    expect((await prisma.productImage.findUniqueOrThrow({ where: { id: image.id } })).mediaAssetId).toBe(up.data.assetId);
    expect((await filesOf((await assetOf(up.data.assetId))!.storageKey)).length).toBe(3);
    // Veritabanı ikinci savunma hattı: B'nin kategorisi A'nın varlığına bağlanamaz (bileşik FK)
    await expect(prisma.menuCategory.update({ where: { id: B.cat.id }, data: { imageAssetId: up.data.assetId } })).rejects.toThrow();
    // Kiracı klasörleri ayrı
    const bUp = await uploadMedia(B.actor, { kind: "HERO" }, await solid(400, 200));
    if (!bUp.ok) throw new Error(bUp.error);
    const bPrefix = (await assetOf(bUp.data.assetId))!.storageKey;
    const secret = getServerEnv().QR_TOKEN_SECRET;
    expect(prefixBelongsToTenant(bPrefix, B.tenantId, secret)).toBe(true);
    expect(prefixBelongsToTenant(bPrefix, A.tenantId, secret)).toBe(false);
  });

  it("10 (güvenlik). başarısız değiştirmede eski görsel korunur; yeni dosyalar yetim kalmaz", async () => {
    const image = await prisma.productImage.findFirstOrThrow({ where: { productId: A.burger.id } });
    const oldAsset = (await assetOf(image.mediaAssetId!))!;
    const dirsBefore = await readdir(path.join(root, ...oldAsset.storageKey.split("/").slice(0, 3)));
    const r = await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id, replaceImageId: image.id }, await solid(900, 600), {
      beforeCommit: () => {
        throw new Error("simulated db failure");
      },
    });
    expect(r).toEqual({ ok: false, error: "failed" });
    expect((await prisma.productImage.findUniqueOrThrow({ where: { id: image.id } })).mediaAssetId).toBe(oldAsset.id);
    expect(await assetOf(oldAsset.id)).not.toBeNull();
    expect((await filesOf(oldAsset.storageKey)).length).toBe(3);
    expect(await readdir(path.join(root, ...oldAsset.storageKey.split("/").slice(0, 3)))).toEqual(dirsBefore);
  });

  it("depolama yazımı yarıda kalırsa: eski görsel korunur, yazılan çıktılar silinir", async () => {
    const image = await prisma.productImage.findFirstOrThrow({ where: { productId: A.burger.id } });
    let puts = 0;
    const flaky = Object.assign(Object.create(Object.getPrototypeOf(storage)), storage, {
      put: async (...args: Parameters<typeof storage.put>) => {
        if (++puts === 2) throw new Error("disk full");
        return storage.put(...args);
      },
    });
    setImageStorageForTests(flaky);
    try {
      expect(await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id, replaceImageId: image.id }, await solid(900, 600))).toEqual({ ok: false, error: "failed" });
    } finally {
      setImageStorageForTests(storage);
    }
    expect((await prisma.productImage.findUniqueOrThrow({ where: { id: image.id } })).mediaAssetId).toBe(image.mediaAssetId);
    expect(await prisma.mediaAsset.count({ where: { tenantId: A.tenantId, kind: "PRODUCT" } })).toBe(1);
  });

  it("GPS / EXIF diskteki çıktıda yok; sahte JPEG, .exe, aşırı büyük dosya, görüntü bombası reddedilir — hiçbiri kayıt / dosya bırakmaz", async () => {
    const before = await prisma.mediaAsset.count({ where: { tenantId: A.tenantId } });
    const ok = await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id }, await jpegWithGps(1200, 800, 6));
    if (!ok.ok) throw new Error(ok.error);
    const prefix = (await assetOf(ok.data.assetId))!.storageKey;
    for (const name of await filesOf(prefix)) {
      const file = await storage.get(`${prefix}/${name}`);
      expect((await sharp(file!.data).metadata()).exif).toBeUndefined();
      expect(file!.data.includes(Buffer.from("TestPhone"))).toBe(false);
    }
    expect(await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id }, fakeJpeg())).toEqual({ ok: false, error: "processing_failed" });
    expect(await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id }, exeBytes())).toEqual({ ok: false, error: "unsupported" });
    expect(await uploadMedia(A.actor, { kind: "LOGO" }, Buffer.alloc(5 * 1024 * 1024 + 1, 0xff))).toEqual({ ok: false, error: "too_large" });
    expect(await uploadMedia(A.actor, { kind: "HERO" }, pngBombHeader())).toEqual({ ok: false, error: "dimensions" });
    expect(await prisma.mediaAsset.count({ where: { tenantId: A.tenantId } })).toBe(before + 1);
  });

  it("ürün başına görsel sınırı (10)", async () => {
    const count = await prisma.productImage.count({ where: { productId: A.burger.id } });
    for (let i = count; i < 10; i++) {
      await prisma.productImage.create({ data: { tenantId: A.tenantId, productId: A.burger.id, storageProvider: "external", storageKey: `https://images.example.com/${i}.jpg`, sortOrder: 100 + i } });
    }
    expect(await uploadMedia(A.actor, { kind: "PRODUCT", productId: A.burger.id }, await solid(200, 200))).toEqual({ ok: false, error: "limit" });
    await prisma.productImage.deleteMany({ where: { productId: A.burger.id, storageProvider: "external" } });
  });
});

describe("önbellek, geriye uyumluluk, denetim, kota, yetim temizliği", () => {
  it("10. menü / tema önbelleği anında geçersiz kılınır (route handler: expire 0)", () => {
    invalidatePublicMenu(A.tenantId, "other");
    expect(revalidateTag).toHaveBeenCalledWith(publicMenuTag(A.tenantId), { expire: 0 });
  });

  it("11. harici (eski) https görseller çalışmaya devam eder", async () => {
    const legacy = await productOf(A, "kunefe");
    expect(legacy.images).toEqual([{ url: "https://images.example.com/kunefe.jpg", srcSet: null, alt: null, primary: true }]);
    expect((await menu(A)).categories.find((c) => c.slug === "tatlilar")!.imageUrl).toBe("https://images.example.com/tatli.jpg");
  });

  it("12. denetim kayıtları güvenli: tür / biçim / boyut — bayt, dosya yolu, depolama anahtarı yok", async () => {
    const logs = await prisma.auditLog.findMany({ where: { tenantId: A.tenantId, action: { in: ["MEDIA_UPLOADED", "MEDIA_REPLACED", "MEDIA_DELETED"] } } });
    const actions = new Set(logs.map((l) => l.action));
    expect(actions).toEqual(new Set(["MEDIA_UPLOADED", "MEDIA_REPLACED", "MEDIA_DELETED"]));
    const allowed = new Set(["kind", "mime", "sourceMime", "bytes", "sourceBytes", "width", "height", "target", "managed"]);
    for (const l of logs) {
      const m = (l.metadata ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(m)) expect(allowed.has(k)).toBe(true);
      const text = JSON.stringify(l.metadata);
      expect(text).not.toContain(root);
      expect(text).not.toContain("tenants/");
      expect(text.length).toBeLessThan(400);
    }
  });

  it("kota temeli: kiracının toplam görsel boyutu ve sayısı", async () => {
    const usage = await getTenantMediaUsage(A.scope);
    const rows = await prisma.mediaAsset.findMany({ where: { tenantId: A.tenantId }, select: { sizeBytes: true } });
    expect(usage).toEqual({ count: rows.length, bytes: rows.reduce((s, r) => s + r.sizeBytes, 0) });
    expect(usage.count).toBeGreaterThan(0);
  });

  it("yetim temizliği: referanssız eski satır + karşılıksız klasör silinir; kullanılan varlıklara dokunulmaz", async () => {
    const referenced = await prisma.mediaAsset.findMany({ where: { tenantId: { in: [A.tenantId, B.tenantId] } }, select: { id: true, storageKey: true } });
    // Referanssız satır (ör. commit sonrası silme yarıda kaldı) — 2 saat önce
    const orphanPrefix = `tenants/${"o".repeat(22)}/products/${randomBytes(16).toString("base64url")}`;
    await storage.put(`${orphanPrefix}/md.webp`, await solid(10, 10, undefined, "webp"), { contentType: "image/webp" });
    const orphanRow = await prisma.mediaAsset.create({
      data: { tenantId: A.tenantId, kind: "PRODUCT", storageProvider: "local", storageKey: orphanPrefix, mimeType: "image/webp", width: 10, height: 10, sizeBytes: 1, renditions: [], createdAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    // Diskte olup veritabanında olmayan klasör (eski tarihli)
    const strayPrefix = `tenants/${"s".repeat(22)}/hero/${randomBytes(16).toString("base64url")}`;
    await storage.put(`${strayPrefix}/lg.webp`, await solid(10, 10, undefined, "webp"), { contentType: "image/webp" });
    const old = new Date(Date.now() - 3 * 3_600_000);
    const { utimes } = await import("node:fs/promises");
    await utimes(path.join(root, ...strayPrefix.split("/")), old, old);
    await utimes(path.join(root, ...orphanPrefix.split("/")), old, old);

    const dry = await cleanupOrphanMedia(prisma, storage, { minAgeMinutes: 60, dryRun: true });
    expect(dry.orphanRows).toBeGreaterThanOrEqual(1);
    expect(await assetOf(orphanRow.id)).not.toBeNull();

    const report = await cleanupOrphanMedia(prisma, storage, { minAgeMinutes: 60 });
    expect(report.orphanRows).toBeGreaterThanOrEqual(1);
    expect(report.orphanDirs).toBeGreaterThanOrEqual(1);
    expect(await assetOf(orphanRow.id)).toBeNull();
    await expect(stat(path.join(root, ...strayPrefix.split("/")))).rejects.toThrow();
    for (const r of referenced) {
      expect(await assetOf(r.id)).not.toBeNull();
      expect((await filesOf(r.storageKey)).length).toBeGreaterThan(0);
    }
  });
});

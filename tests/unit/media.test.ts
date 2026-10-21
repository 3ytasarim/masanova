import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_RULES, MAX_UPLOAD_BYTES } from "@/lib/media/limits";
import { sniffImageMime } from "@/lib/media/sniff";
import { isValidStorageKey, newAssetPrefix, prefixBelongsToTenant, renditionKey, tenantStorageKey } from "@/server/media/keys";
import { processImage } from "@/server/media/process";
import { LocalImageStorageProvider, StorageKeyError } from "@/server/media/storage/local";
import { resolveUploadRoot } from "@/server/media/storage/root";
import { BodyTooLarge, isTrustedOrigin, parseRemoveBody, parseUploadForm, readLimitedBody } from "@/server/media/upload-request";
import { animatedWebp, exeBytes, fakeJpeg, jpegWithGps, pngBombHeader, solid, transparentPng } from "../support/images";

const SECRET = "test-secret-test-secret-test-secret-0123456789";
const TENANT_A = "cmaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "cmbbbbbbbbbbbbbbbbbbbbbbb";

describe("dosya imzası (uzantı / Content-Type'a güvenilmez)", () => {
  it("JPEG / PNG / WebP gerçek baytlardan tanınır", async () => {
    expect(sniffImageMime(await solid(10, 10, undefined, "jpeg"))).toBe("image/jpeg");
    expect(sniffImageMime(await solid(10, 10, undefined, "png"))).toBe("image/png");
    expect(sniffImageMime(await solid(10, 10, undefined, "webp"))).toBe("image/webp");
  });
  it("adı .jpg olan çalıştırılabilir dosya, GIF ve SVG reddedilir", () => {
    expect(sniffImageMime(exeBytes())).toBeNull();
    expect(sniffImageMime(Buffer.from("GIF89a....."))).toBeNull();
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });
});

describe("depolama anahtarları (kiracı ad alanı, yol geçişi yok)", () => {
  it("kiracı anahtarı deterministik, kiracı kimliğini içermez, kiracılar arasında farklı", () => {
    const a = tenantStorageKey(TENANT_A, SECRET);
    expect(a).toBe(tenantStorageKey(TENANT_A, SECRET));
    expect(a).not.toContain(TENANT_A);
    expect(a).not.toBe(tenantStorageKey(TENANT_B, SECRET));
    expect(a).not.toBe(tenantStorageKey(TENANT_A, `${SECRET}x`));
  });
  it("her varlık yeni rastgele önek alır (çakışma yok) ve doğru kiracıya aittir", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newAssetPrefix(TENANT_A, "PRODUCT", SECRET)));
    expect(keys.size).toBe(200);
    const prefix = [...keys][0]!;
    expect(prefix).toMatch(/^tenants\/[A-Za-z0-9_-]{22}\/products\/[A-Za-z0-9_-]{22}$/);
    expect(prefixBelongsToTenant(prefix, TENANT_A, SECRET)).toBe(true);
    expect(prefixBelongsToTenant(prefix, TENANT_B, SECRET)).toBe(false);
    expect(isValidStorageKey(renditionKey(prefix, "md", "webp"))).toBe(true);
  });
  it.each([
    "../../etc/passwd",
    "tenants/../../../etc/passwd",
    "tenants/aaaaaaaaaaaaaaaaaaaaaa/products/../../../x.webp",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "tenants\\aaaaaaaaaaaaaaaaaaaaaa\\products\\bbbbbbbbbbbbbbbbbbbbbb\\md.webp",
    "tenants/aaaaaaaaaaaaaaaaaaaaaa/products/bbbbbbbbbbbbbbbbbbbbbb/md.webp?x=1",
    "tenants/aaaaaaaaaaaaaaaaaaaaaa/products/bbbbbbbbbbbbbbbbbbbbbb/md.svg",
    "tenants/aaaaaaaaaaaaaaaaaaaaaa/secrets/bbbbbbbbbbbbbbbbbbbbbb/md.webp",
    "tenants/aaaaaaaaaaaaaaaaaaaaaa/products/bbbbbbbbbbbbbbbbbbbbbb/%2e%2e.webp",
  ])("geçersiz anahtar reddedilir: %s", (key) => {
    expect(isValidStorageKey(key)).toBe(false);
  });
});

describe("LocalImageStorageProvider (geçici klasör)", () => {
  let root: string;
  let storage: LocalImageStorageProvider;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "masanova-media-"));
    storage = new LocalImageStorageProvider(root, "/media");
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("put / exists / get / metadata / public URL / delete", async () => {
    const key = renditionKey(newAssetPrefix(TENANT_A, "PRODUCT", SECRET), "md", "webp");
    const data = await solid(20, 20, undefined, "webp");
    await storage.put(key, data, { contentType: "image/webp" });
    expect(await storage.exists(key)).toBe(true);
    expect((await storage.get(key))!.data.equals(data)).toBe(true);
    expect(await storage.getMetadata(key)).toMatchObject({ size: data.length, contentType: "image/webp" });
    expect(storage.getPublicUrl(key)).toBe(`/media/${key}`);
    expect(storage.getPublicUrl(key)).not.toContain(root);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await storage.delete(key); // idempotent
  });

  it("aynı anahtarın üzerine yazılmaz (çakışma koruması); içerik türü uzantıyla uyuşmalı", async () => {
    const key = renditionKey(newAssetPrefix(TENANT_A, "LOGO", SECRET), "png", "png");
    const data = await solid(8, 8, undefined, "png");
    await storage.put(key, data, { contentType: "image/png" });
    await expect(storage.put(key, data, { contentType: "image/png" })).rejects.toThrow();
    await expect(storage.put(renditionKey(newAssetPrefix(TENANT_A, "LOGO", SECRET), "md", "webp"), data, { contentType: "image/png" })).rejects.toBeInstanceOf(StorageKeyError);
  });

  it("kiracı ad alanı: iki kiracının dosyaları ayrı klasörlerde", async () => {
    const a = renditionKey(newAssetPrefix(TENANT_A, "HERO", SECRET), "lg", "webp");
    const b = renditionKey(newAssetPrefix(TENANT_B, "HERO", SECRET), "lg", "webp");
    const img = await solid(8, 8, undefined, "webp");
    await storage.put(a, img, { contentType: "image/webp" });
    await storage.put(b, img, { contentType: "image/webp" });
    const tenants = await readdir(path.join(root, "tenants"));
    expect(tenants).toEqual(expect.arrayContaining([tenantStorageKey(TENANT_A, SECRET), tenantStorageKey(TENANT_B, SECRET)]));
    expect(a.split("/")[1]).not.toBe(b.split("/")[1]);
  });

  it("yol geçişi her işlemde reddedilir", async () => {
    for (const bad of ["../../outside.webp", "tenants/../../x.webp", "/abs.webp"]) {
      await expect(storage.put(bad, Buffer.from("x"), { contentType: "image/webp" })).rejects.toBeInstanceOf(StorageKeyError);
      await expect(storage.get(bad)).rejects.toBeInstanceOf(StorageKeyError);
      await expect(storage.delete(bad)).rejects.toBeInstanceOf(StorageKeyError);
      expect(() => storage.getPublicUrl(bad)).toThrow(StorageKeyError);
    }
    await expect(storage.deletePrefix("tenants/../..")).rejects.toBeInstanceOf(StorageKeyError);
  });

  it("değiştirme temizliği: eski varlığın çıktıları silinir, klasörü kalmaz; listAssetPrefixes yalnızca geçerli önekler", async () => {
    const old = newAssetPrefix(TENANT_A, "CATEGORY", SECRET);
    const img = await solid(8, 8, undefined, "webp");
    for (const n of ["orig", "lg", "sm"]) await storage.put(renditionKey(old, n, "webp"), img, { contentType: "image/webp" });
    const listed: string[] = [];
    for await (const p of storage.listAssetPrefixes()) listed.push(p.prefix);
    expect(listed).toContain(old);
    for (const n of ["orig", "lg", "sm"]) await storage.delete(renditionKey(old, n, "webp"));
    await expect(stat(path.join(root, ...old.split("/")))).rejects.toThrow();
  });
});

describe("yükleme kökü", () => {
  it("uygulama kaynak / derleme klasörlerine yazılmaz", () => {
    const cwd = path.resolve("/srv/app");
    for (const bad of ["src/uploads", "public/uploads", ".next/cache/x", "./", "prisma"]) expect(() => resolveUploadRoot(bad, cwd)).toThrow();
    expect(resolveUploadRoot("", cwd)).toBe(path.resolve(cwd, "storage/uploads"));
    expect(resolveUploadRoot("/var/lib/masanova/uploads", cwd)).toBe(path.resolve("/var/lib/masanova/uploads"));
  });
});

describe("görsel işleme (sharp)", () => {
  it("ürün: 1600×1200 → lg 1600 / md 900 / sm 400 WebP, oran korunur", async () => {
    const r = await processImage(await solid(1600, 1200), "PRODUCT");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.image.renditions.map((x) => [x.name, x.width, x.height, x.format])).toEqual([
      ["lg", 1600, 1200, "webp"],
      ["md", 900, 675, "webp"],
      ["sm", 400, 300, "webp"],
    ]);
    for (const x of r.image.renditions) expect(sniffImageMime(x.data)).toBe("image/webp");
  });

  it("küçük görsel BÜYÜTÜLMEZ", async () => {
    const r = await processImage(await solid(300, 200), "PRODUCT");
    expect(r.ok && r.image.renditions.every((x) => x.width <= 300 && x.height <= 200)).toBe(true);
  });

  it("kategori: ana kopya kırpılmaz, gösterim 1500×500 ortadan kırpılır", async () => {
    const r = await processImage(await solid(4000, 2000), "CATEGORY");
    if (!r.ok) throw new Error(r.error);
    const by = Object.fromEntries(r.image.renditions.map((x) => [x.name, [x.width, x.height]]));
    expect(by).toEqual({ orig: [3000, 1500], lg: [1500, 500], sm: [750, 250] });
  });

  it("kapak: 1920×640 gösterim + 960×320", async () => {
    const r = await processImage(await solid(2400, 1200, undefined, "png"), "HERO");
    if (!r.ok) throw new Error(r.error);
    expect(r.image.renditions.find((x) => x.name === "lg")).toMatchObject({ width: 1920, height: 640 });
    expect(r.image.renditions.find((x) => x.name === "md")).toMatchObject({ width: 960, height: 320 });
  });

  it("logo: kırpılmaz (contain), şeffaflık korunur, etiket için PNG çıktısı", async () => {
    const r = await processImage(await transparentPng(800, 400), "LOGO");
    if (!r.ok) throw new Error(r.error);
    const md = r.image.renditions.find((x) => x.name === "md")!;
    expect([md.width, md.height]).toEqual([512, 256]);
    expect((await sharp(md.data).metadata()).hasAlpha).toBe(true);
    const png = r.image.renditions.find((x) => x.name === "png")!;
    expect(png.contentType).toBe("image/png");
    expect((await sharp(png.data).metadata()).hasAlpha).toBe(true);
  });

  it("GPS / EXIF atılır, EXIF yönü uygulanır (6 → 90°: genişlik / yükseklik yer değiştirir)", async () => {
    const source = await jpegWithGps(1200, 800, 6);
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const r = await processImage(source, "PRODUCT");
    if (!r.ok) throw new Error(r.error);
    for (const x of r.image.renditions) {
      const m = await sharp(x.data).metadata();
      expect(m.exif).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(x.data.includes(Buffer.from("TestPhone"))).toBe(false);
    }
    expect([r.image.width, r.image.height]).toEqual([800, 1200]);
    expect(r.image.renditions[0]).toMatchObject({ width: 800, height: 1200 });
  });

  it("sahte JPEG (imza doğru, içerik değil) → işlenemedi; çalıştırılabilir dosya → desteklenmiyor", async () => {
    expect(await processImage(fakeJpeg(), "PRODUCT")).toEqual({ ok: false, error: "processing_failed" });
    expect(await processImage(exeBytes(), "PRODUCT")).toEqual({ ok: false, error: "unsupported" });
  });

  it("imza ile çözülen biçim uyuşmazsa reddedilir (PNG imzası + WebP gövde)", async () => {
    const webp = await solid(20, 20, undefined, "webp");
    const disguised = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), webp]);
    expect((await processImage(disguised, "PRODUCT")).ok).toBe(false);
  });

  it("görüntü bombası: 100000 × 100000 başlık işlenmez", async () => {
    const started = Date.now();
    expect(await processImage(pngBombHeader(), "HERO")).toEqual({ ok: false, error: "dimensions" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("hareketli görsel reddedilir (animasyon dizisi işlenmez)", async () => {
    expect(await processImage(await animatedWebp(), "PRODUCT")).toEqual({ ok: false, error: "animated" });
  });
});

describe("yükleme isteği", () => {
  it("Origin platform origin'i olmalı (CSRF)", () => {
    const req = (origin: string | null, host = "localhost:3820") => new Request("http://localhost:3820/api/v1/media", { method: "POST", headers: { ...(origin ? { origin } : {}), host } });
    expect(isTrustedOrigin(req("http://localhost:3820"), "http://localhost:3820")).toBe(true);
    expect(isTrustedOrigin(req("https://evil.example"), "http://localhost:3820")).toBe(false);
    expect(isTrustedOrigin(req(null), "http://localhost:3820")).toBe(false);
    expect(isTrustedOrigin(req("https://evil.example", "evil.example"), "https://masanovai.com")).toBe(false);
  });

  it("gövde sınırı: beyan edilen ve gerçek boyut", async () => {
    const big = new Request("http://x/api", { method: "POST", headers: { "content-length": String(MAX_UPLOAD_BYTES * 2) }, body: "x" });
    await expect(readLimitedBody(big)).rejects.toBeInstanceOf(BodyTooLarge);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(1024));
        c.close();
      },
    });
    await expect(readLimitedBody(new Request("http://x/api", { method: "POST", body: stream, duplex: "half" } as RequestInit), 10_000)).rejects.toBeInstanceOf(BodyTooLarge);
    expect((await readLimitedBody(new Request("http://x/api", { method: "POST", body: "hello" }), 10)).toString()).toBe("hello");
  });

  it("form alanları doğrulanır: tür, kimlik biçimi (yol geçişi yok), dosya zorunlu", () => {
    const file = new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" });
    const form = (fields: Record<string, string>, withFile = true) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      if (withFile) f.set("file", file);
      return f;
    };
    expect(parseUploadForm(form({ kind: "PRODUCT", productId: "cmabc123" }))?.target).toEqual({ kind: "PRODUCT", productId: "cmabc123", replaceImageId: null, altText: null });
    expect(parseUploadForm(form({ kind: "LOGO", tenantId: "cmother" }))?.target).toEqual({ kind: "LOGO" });
    expect(parseUploadForm(form({ kind: "PRODUCT", productId: "../../etc" }))).toBeNull();
    expect(parseUploadForm(form({ kind: "PRODUCT" }))).toBeNull();
    expect(parseUploadForm(form({ kind: "AVATAR" }))).toBeNull();
    expect(parseUploadForm(form({ kind: "HERO" }, false))).toBeNull();
    expect(parseRemoveBody({ kind: "CATEGORY", categoryId: "cmcat" })).toEqual({ kind: "CATEGORY", categoryId: "cmcat" });
    expect(parseRemoveBody({ kind: "PRODUCT", productId: "p1" })).toBeNull();
    expect(parseRemoveBody({ kind: "CATEGORY", categoryId: "../x" })).toBeNull();
    expect(parseRemoveBody({ kind: "PRODUCT", productId: "p1", imageId: "i1", path: "/etc/passwd" })).toEqual({ kind: "PRODUCT", productId: "p1", imageId: "i1" });
  });

  it("tür sınırları merkezi", () => {
    expect(MEDIA_RULES.PRODUCT.maxBytes).toBe(10 * 1024 * 1024);
    expect(MEDIA_RULES.HERO.maxBytes).toBe(15 * 1024 * 1024);
    expect(MEDIA_RULES.LOGO.maxBytes).toBe(5 * 1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBe(MEDIA_RULES.HERO.maxBytes);
  });
});

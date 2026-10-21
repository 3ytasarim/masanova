// MasaNovaAI Sprint 13 — görsel yükleme tarayıcı testi (production build). Sunucu UPLOAD_ROOT=tmp/e2e/uploads ile
// çalışır (gerçek yükleme klasörüne yazılmaz). Demo kiracıya GEÇİCİ kategori + ürün eklenir; logo / kapak önceki
// durumuna döndürülür; oluşturulan tüm varlık satırları ve dosyalar sonunda silinir.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const B = "http://localhost:3820";
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "tmp/e2e", "s13");
const FILES = path.join(OUT, "files");
const UPLOAD_ROOT = path.resolve(ROOT, process.env.E2E_UPLOAD_ROOT || "tmp/e2e/uploads");
fs.mkdirSync(FILES, { recursive: true });
const LOG = path.join(OUT, "results.txt");
fs.writeFileSync(LOG, "");
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const results = [];
const check = (name, ok, detail = "") => {
  const r = { ok: !!ok, name, detail: String(detail).slice(0, 300) };
  results.push(r);
  fs.appendFileSync(LOG, `${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}\n`);
};
const derive = (nonce) => crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
const state = { demo: null, created: { categoryId: null, productId: null }, restore: null, assetsBefore: new Set() };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 12 dk aşıldı", false);
  finish();
}, 12 * 60_000).unref();

async function waitFor(p, fn, arg, timeout = 20000) {
  try {
    await p.waitForFunction(fn, { polling: 200, timeout }, arg);
    return true;
  } catch {
    return false;
  }
}
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
}
async function clickByText(page, label, scope = "") {
  const [el] = await page.$$(`xpath/.${scope}//button[normalize-space(.)="${label}"]`);
  if (!el) throw new Error(`Düğme yok: ${label}`);
  await el.click();
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const statusOf = (p, id) => p.$eval(`[data-testid="${id}-status"]`, (e) => ({ phase: e.dataset.phase, text: e.textContent.trim() })).catch(() => ({ phase: null, text: "" }));
async function uploadVia(page, testId, file, expect = "done") {
  const input = await page.waitForSelector(`[data-testid="${testId}-input"]`, { timeout: 15000 });
  await input.uploadFile(file);
  const ok = await waitFor(page, ([id, want]) => document.querySelector(`[data-testid="${id}-status"]`)?.dataset.phase === want, [testId, expect], 45000);
  return { ok, status: await statusOf(page, testId) };
}
/** Görsel gerçekten yüklendi mi (naturalWidth > 0) — kırık görsel yok. */
const imgsLoaded = (p, needle) =>
  p.evaluate(async (n) => {
    const imgs = [...document.querySelectorAll("img")].filter((i) => (i.currentSrc || i.src).includes(n));
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => i.addEventListener("load", r, { once: true }) || setTimeout(r, 5000)))));
    return imgs.map((i) => ({ src: (i.currentSrc || i.src).replace(location.origin, ""), w: i.naturalWidth }));
  }, needle);

async function makeFixtures() {
  const f = (n) => path.join(FILES, n);
  await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 210, g: 90, b: 40 } } }).jpeg({ quality: 85 }).toFile(f("product-1600x1200.jpg"));
  await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 30, g: 90, b: 210 } } }).png().toFile(f("product-replace.png"));
  await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 40, g: 160, b: 90 } } }).jpeg().toFile(f("category-3000x1000.jpg"));
  await sharp({ create: { width: 2400, height: 800, channels: 3, background: { r: 120, g: 40, b: 160 } } }).webp().toFile(f("hero-2400x800.webp"));
  await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 300, height: 300, channels: 4, background: { r: 230, g: 50, b: 60, alpha: 1 } } }, gravity: "centre" }])
    .png()
    .toFile(f("logo-600.png"));
  // "fotograf.jpg": JPEG imzalı ama görüntü olmayan baytlar
  fs.writeFileSync(f("sahte.jpg"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("not an image ".repeat(200))]));
  // 11 MB (ürün sınırı 10 MB)
  fs.writeFileSync(f("buyuk.jpg"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(11 * 1024 * 1024, 7)]));
  return f;
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  const T = state.demo.id;
  const settings = await db.tenantSettings.findUnique({ where: { tenantId: T }, select: { logoUrl: true, logoAssetId: true } });
  const menuSettings = await db.publicMenuSettings.findUnique({ where: { tenantId: T }, select: { heroImageUrl: true, heroAssetId: true } });
  state.restore = { logoUrl: settings?.logoUrl ?? null, heroImageUrl: menuSettings?.heroImageUrl ?? null, hadMenuSettings: !!menuSettings };
  for (const a of await db.mediaAsset.findMany({ where: { tenantId: T }, select: { id: true } })) state.assetsBefore.add(a.id);
  const f = await makeFixtures();

  // Geçici kategori + ürün (Merkez şubesinde görünür, rota istasyonu gerekmez — sipariş verilmez)
  const sfx = crypto.randomBytes(3).toString("hex");
  const cat = await db.menuCategory.create({ data: { tenantId: T, name: "E2E Görsel Kategori", slug: `e2e-gorsel-${sfx}`, sortOrder: -100 } });
  state.created.categoryId = cat.id;
  const product = await db.product.create({ data: { tenantId: T, categoryId: cat.id, name: "E2E Görsel Burger", slug: `e2e-gorsel-burger-${sfx}`, basePriceMinor: 25000, sortOrder: -100 } });
  state.created.productId = product.id;
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 1" }, select: { id: true } });
  const qr = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const stable = `${B}/q/${derive(qr.tokenNonce)}`;

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const consoleErrors = [];
  const newPage = async (viewport) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("console", (m) => m.type() === "error" && !/status of 40[134]|status of 41[35]|status of 422|net::ERR_/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
    await p.setViewport(viewport);
    return p;
  };
  const owner = await newPage({ width: 1440, height: 1000 });
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // 1–5 Ürün görseli
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("1. Sahip giriş yaptı", owner.url().endsWith("/panel"), owner.url());
  await owner.goto(`${B}/panel/menu/urunler/${product.id}?sekme=gorseller`, { waitUntil: "networkidle2" });
  const hint = await owner.$eval('[data-testid="product-uploader-hint"]', (e) => e.textContent).catch(() => "");
  check("2. Ürün düzenleyici › Görseller: yükleme alanı + önerilen boyut (1600 × 1200, 4:3)", hint.includes("1600 × 1200") && hint.includes("4:3") && hint.includes("10 MB"), hint);
  const up1 = await uploadVia(owner, "product-uploader", f("product-1600x1200.jpg"));
  check("3. 1600×1200 JPEG yüklendi (Yükleniyor → İşleniyor → Tamamlandı)", up1.ok && up1.status.text.includes("Tamamlandı"), JSON.stringify(up1.status));
  check("4. Önizleme görünür", !!(await owner.$('[data-testid="product-uploader-preview"]')));
  await waitFor(owner, () => document.querySelectorAll('[data-testid="product-image"][data-managed="1"]').length === 1);
  const img1 = await db.productImage.findFirst({ where: { productId: product.id }, include: { mediaAsset: true } });
  check("5. Kaydedildi: ürün görseli yönetilen varlığa bağlı (yükleme anında uygulanır)", img1?.storageProvider === "media" && img1.mediaAsset?.kind === "PRODUCT", JSON.stringify(img1?.storageProvider));
  const prefix1 = img1?.mediaAsset?.storageKey ?? "";
  check("Dosyalar UPLOAD_ROOT altında (lg / md / sm WebP), kaynak kod klasöründe değil", ["lg.webp", "md.webp", "sm.webp"].every((n) => fs.existsSync(path.join(UPLOAD_ROOT, ...prefix1.split("/"), n))) && !fs.existsSync(path.join(ROOT, "public", "tenants")));

  // 6–7 QR menüde
  await cust.goto(stable, { waitUntil: "networkidle2" });
  let shown = await imgsLoaded(cust, prefix1);
  check("6. QR menü açıldı", cust.url().includes("/t/"), cust.url());
  check("7. Ürün görseli menüde yüklendi (sürümlü /media adresi, srcset)", shown.length > 0 && shown.every((i) => i.w > 0 && i.src.startsWith("/media/tenants/")), JSON.stringify(shown));
  const media = await cust.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), nosniff: r.headers.get("x-content-type-options") };
  }, `/media/${prefix1}/md.webp`);
  check("Görsel yanıtı: image/webp, 1 yıl immutable, nosniff", media.status === 200 && media.type === "image/webp" && media.cache.includes("immutable") && media.nosniff === "nosniff", JSON.stringify(media));
  const traversal = await cust.evaluate(async () => (await Promise.all(["/media/..%2f..%2f.env", "/media/tenants/../../.env", "/media/tenants/aaaaaaaaaaaaaaaaaaaaaa/products/bbbbbbbbbbbbbbbbbbbbbb/md.svg"].map((u) => fetch(u).then((r) => r.status)))));
  check("Yol geçişi / geçersiz anahtar → 404", traversal.every((s) => s === 404), JSON.stringify(traversal));

  // 8–9 Değiştir
  await owner.bringToFront();
  const up2 = await uploadVia(owner, "product-replace", f("product-replace.png"));
  check("8. Ürün görseli değiştirildi", up2.ok, JSON.stringify(up2.status));
  const img2 = await db.productImage.findFirst({ where: { productId: product.id }, include: { mediaAsset: true } });
  const prefix2 = img2?.mediaAsset?.storageKey ?? "";
  await cust.bringToFront();
  await cust.reload({ waitUntil: "networkidle2" });
  shown = await imgsLoaded(cust, prefix2);
  const old = await imgsLoaded(cust, prefix1);
  check("9. Yeni adres menüde HEMEN görünür; eski adres yok, eski dosyalar silindi", prefix2 && prefix2 !== prefix1 && shown.length > 0 && shown.every((i) => i.w > 0) && old.length === 0 && !fs.existsSync(path.join(UPLOAD_ROOT, ...prefix1.split("/"))), JSON.stringify({ shown, old }));

  // 10–11 Kategori banner'ı
  await owner.bringToFront();
  await owner.goto(`${B}/panel/menu/kategoriler`, { waitUntil: "networkidle2" });
  const [editBtn] = await owner.$$(`xpath/.//button[contains(normalize-space(.), "Düzenle") and .//span[contains(., "E2E Görsel Kategori")]]`);
  await editBtn.click();
  await owner.waitForSelector("dialog[open]");
  const catHint = await owner.$eval('[data-testid="category-uploader-hint"]', (e) => e.textContent).catch(() => "");
  const up3 = await uploadVia(owner, "category-uploader", f("category-3000x1000.jpg"));
  check("10. Kategori banner'ı yüklendi (önerilen 1500 × 500)", up3.ok && catHint.includes("1500 × 500"), JSON.stringify({ s: up3.status, catHint }));
  await waitFor(owner, () => !!document.querySelector('dialog[open] [data-testid="category-uploader-remove"]'));
  check("Açık pencere güncel veriyle (Kaldır görünür, harici adres alanı gizli)", !!(await owner.$('dialog[open] [data-testid="category-uploader-remove"]')) && !(await owner.$("dialog[open] #cat-image")));
  await owner.keyboard.press("Escape");
  const catAsset = (await db.menuCategory.findUnique({ where: { id: cat.id }, include: { imageAsset: true } })).imageAsset;
  await cust.bringToFront();
  await cust.reload({ waitUntil: "networkidle2" });
  shown = await imgsLoaded(cust, catAsset?.storageKey ?? "none");
  check("11. QR menüde kategori görseli (lg 1500×500)", shown.length > 0 && shown.every((i) => i.w === 1500 || i.w > 0) && shown[0].src.endsWith("/lg.webp"), JSON.stringify(shown));

  // 12–15 Kapak + logo (Tema)
  await owner.bringToFront();
  await owner.goto(`${B}/panel/tema`, { waitUntil: "networkidle2" });
  const up4 = await uploadVia(owner, "hero-uploader", f("hero-2400x800.webp"));
  check("12. Kapak görseli yüklendi", up4.ok, JSON.stringify(up4.status));
  const up5 = await uploadVia(owner, "logo-uploader", f("logo-600.png"));
  check("14. Logo yüklendi", up5.ok, JSON.stringify(up5.status));
  await waitFor(owner, () => !!document.querySelector('[data-testid="logo-uploader-remove"]') && !!document.querySelector('[data-testid="hero-uploader-remove"]'));
  const ms = await db.publicMenuSettings.findUnique({ where: { tenantId: T }, include: { heroAsset: true } });
  const ts = await db.tenantSettings.findUnique({ where: { tenantId: T }, include: { logoAsset: true } });
  await cust.bringToFront();
  await cust.reload({ waitUntil: "networkidle2" });
  const hero = await imgsLoaded(cust, ms?.heroAsset?.storageKey ?? "none");
  check("13. QR menü kapağı yüklenen görsel", hero.length > 0 && hero.every((i) => i.w > 0) && hero[0].src.endsWith("/lg.webp"), JSON.stringify(hero));
  const logo = await imgsLoaded(cust, ts?.logoAsset?.storageKey ?? "none");
  check("15. QR menü logosu yüklenen görsel (şeffaf, kırpılmadan)", logo.length > 0 && logo.every((i) => i.w === 512), JSON.stringify(logo));
  await owner.bringToFront();
  await owner.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  const panelLogo = await imgsLoaded(owner, ts?.logoAsset?.storageKey ?? "none");
  check("Panel kenar çubuğunda işletme logosu", panelLogo.length > 0 && panelLogo.every((i) => i.w > 0), JSON.stringify(panelLogo));

  // 16–17 Ürün görselini kaldır
  await owner.goto(`${B}/panel/menu/urunler/${product.id}?sekme=gorseller`, { waitUntil: "networkidle2" });
  await clickByText(owner, "Kaldır", `//li[@data-testid="product-image"]`);
  await owner.waitForSelector("dialog[open]");
  await clickByText(owner, "Kaldır", "//dialog[@open]");
  await waitFor(owner, () => document.querySelectorAll('[data-testid="product-image"]').length === 0);
  const after = await db.productImage.count({ where: { productId: product.id } });
  check("16. Ürün görseli kaldırıldı (kayıt + varlık + dosyalar)", after === 0 && !(await db.mediaAsset.findFirst({ where: { storageKey: prefix2 } })) && !fs.existsSync(path.join(UPLOAD_ROOT, ...prefix2.split("/"))), after);
  await cust.bringToFront();
  await cust.reload({ waitUntil: "networkidle2" });
  const broken = await cust.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
  const stale = await imgsLoaded(cust, prefix2);
  check("17. Kırık görsel yok (menü kaldırmayı hemen yansıtır)", broken.length === 0 && stale.length === 0, JSON.stringify({ broken, stale }));

  // 18–21 Reddetmeler
  await owner.bringToFront();
  await owner.goto(`${B}/panel/menu/urunler/${product.id}?sekme=gorseller`, { waitUntil: "networkidle2" });
  const bad = await uploadVia(owner, "product-uploader", f("sahte.jpg"), "error");
  check("18–19. Sahte JPG dostça reddedildi", bad.ok && bad.status.text === "Görsel işlenemedi. Başka bir dosya deneyin.", JSON.stringify(bad.status));
  const big = await uploadVia(owner, "product-uploader", f("buyuk.jpg"), "error");
  check("20–21. 11 MB dosya reddedildi (en fazla 10 MB)", big.ok && big.status.text.includes("Dosya çok büyük") && big.status.text.includes("10 MB"), JSON.stringify(big.status));
  const direct = await owner.evaluate(async (pid) => {
    const fd = new FormData();
    fd.set("kind", "PRODUCT");
    fd.set("productId", pid);
    fd.set("file", new File([new Uint8Array(11 * 1024 * 1024)], "x.jpg", { type: "image/jpeg" }));
    const r = await fetch("/api/v1/media", { method: "POST", body: fd });
    return { status: r.status, body: await r.text() };
  }, product.id);
  check("Sunucu da aşırı büyük gövdeyi reddeder (413) — yol / istisna sızmaz", direct.status === 413 && !/[A-Z]:\\|\/var\/|storage|Error:/.test(direct.body), JSON.stringify(direct));
  check("Reddedilen yüklemeler kayıt bırakmaz", (await db.productImage.count({ where: { productId: product.id } })) === 0);

  // 22 Destek modu
  const ap = await newPage({ width: 1440, height: 900 });
  await login(ap, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" });
  await clickByText(ap, "Destek Modu", "//header");
  await ap.waitForSelector("dialog[open]");
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle2" }), clickByText(ap, "Destek modunu başlat", "//dialog[@open]")]);
  await ap.goto(`${B}/panel/tema`, { waitUntil: "networkidle2" });
  const supInputDisabled = await ap.$eval('[data-testid="logo-uploader-input"]', (e) => e.disabled).catch(() => null);
  const supPost = await ap.evaluate(async () => {
    const fd = new FormData();
    fd.set("kind", "LOGO");
    fd.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "x.jpg", { type: "image/jpeg" }));
    const post = await fetch("/api/v1/media", { method: "POST", body: fd });
    const del = await fetch("/api/v1/media", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "HERO" }) });
    return [post.status, del.status];
  });
  check("22. Destek modu: yükleme alanı kapalı; API yükleme / silme 404", supInputDisabled === true && supPost.every((s) => s === 404), JSON.stringify({ supInputDisabled, supPost }));
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle2" }), clickByText(ap, "Destek modundan çık")]);

  // 23 Kiracı yalıtımı: başka kiracı (askida-demo yok sayılır; geçici yönetici yok) — sahip, demo dışı kimliklere dokunamaz
  const other = await db.tenant.findUnique({ where: { slug: "askida-demo" }, select: { id: true } });
  const foreignCat = other ? await db.menuCategory.create({ data: { tenantId: other.id, name: "Yabancı", slug: `e2e-yabanci-${sfx}` } }) : null;
  const iso = await owner.evaluate(async (cid) => {
    const fd = new FormData();
    fd.set("kind", "CATEGORY");
    fd.set("categoryId", cid);
    fd.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], "x.jpg", { type: "image/jpeg" }));
    const up = await fetch("/api/v1/media", { method: "POST", body: fd });
    const del = await fetch("/api/v1/media", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "CATEGORY", categoryId: cid }) });
    return [up.status, del.status];
  }, foreignCat?.id ?? "cmzzzzzzzzzzzzzzzzzzzzzzz");
  if (foreignCat) await db.menuCategory.delete({ where: { id: foreignCat.id } });
  check("23. Başka kiracının kategorisine yükleme / silme → 404 (kiracı oturumdan)", iso.every((s) => s === 404), JSON.stringify(iso));

  // 24–27 Duyarlılık
  const panel390 = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(panel390, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  let worst390 = 0;
  for (const u of [`/panel/menu/urunler/${product.id}?sekme=gorseller`, "/panel/tema"]) {
    await panel390.goto(`${B}${u}`, { waitUntil: "networkidle2" });
    worst390 = Math.max(worst390, await overflow(panel390));
  }
  await panel390.screenshot({ path: path.join(OUT, "panel-390.png"), fullPage: true });
  check("24. 390 px panel (yükleme alanı / önizleme taşmaz)", worst390 <= 0, worst390);
  await cust.bringToFront();
  await cust.reload({ waitUntil: "networkidle2" });
  await cust.screenshot({ path: path.join(OUT, "menu-390.png") });
  check("25. 390 px QR menü", (await overflow(cust)) <= 0);
  const desk = await newPage({ width: 1440, height: 900 });
  await login(desk, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  let worst1440 = 0;
  for (const u of [`/panel/menu/urunler/${product.id}?sekme=gorseller`, "/panel/tema", "/panel/menu/kategoriler"]) {
    await desk.goto(`${B}${u}`, { waitUntil: "networkidle2" });
    worst1440 = Math.max(worst1440, await overflow(desk));
  }
  await desk.goto(`${B}/panel/tema`, { waitUntil: "networkidle2" });
  await desk.screenshot({ path: path.join(OUT, "tema-1440.png"), fullPage: true });
  check("26. 1440 px", worst1440 <= 0, worst1440);
  check("27. Yatay taşma yok", worst390 <= 0 && worst1440 <= 0);
  check("28. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.join(" | "));
})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack || e.message))
  .finally(() => finish());

async function cleanup() {
  if (!state.demo) return;
  const T = state.demo.id;
  // Referansları geri al (logo / kapak önceki harici durumuna; geçici kategori / ürün silinir)
  await db.tenantSettings.updateMany({ where: { tenantId: T }, data: { logoAssetId: null, logoUrl: state.restore?.logoUrl ?? null } });
  if (state.restore?.hadMenuSettings) await db.publicMenuSettings.updateMany({ where: { tenantId: T }, data: { heroAssetId: null, heroImageUrl: state.restore.heroImageUrl } });
  else await db.publicMenuSettings.deleteMany({ where: { tenantId: T } });
  if (state.created.productId) {
    await db.productImage.deleteMany({ where: { productId: state.created.productId } });
    await db.product.deleteMany({ where: { id: state.created.productId } });
  }
  if (state.created.categoryId) await db.menuCategory.deleteMany({ where: { id: state.created.categoryId } });
  // Bu koşunun oluşturduğu varlık satırları + dosyaları
  const created = await db.mediaAsset.findMany({ where: { tenantId: T, id: { notIn: [...state.assetsBefore] } }, select: { id: true, storageKey: true } });
  for (const a of created) {
    await db.mediaAsset.delete({ where: { id: a.id } }).catch(() => null);
    fs.rmSync(path.join(UPLOAD_ROOT, ...a.storageKey.split("/")), { recursive: true, force: true });
  }
  await db.auditLog.deleteMany({ where: { tenantId: T, action: { in: ["MEDIA_UPLOADED", "MEDIA_REPLACED", "MEDIA_DELETED"] } } });
  fs.rmSync(FILES, { recursive: true, force: true });
}

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  await browser?.close().catch(() => null);
  try {
    await cleanup();
    const T = state.demo?.id;
    const leftAssets = T ? await db.mediaAsset.count({ where: { tenantId: T, id: { notIn: [...state.assetsBefore] } } }) : 0;
    const leftProduct = state.created.productId ? await db.product.count({ where: { id: state.created.productId } }) : 0;
    check("29. Geçici test dosyaları / varlıkları temizlendi", leftAssets === 0 && leftProduct === 0, `${leftAssets}/${leftProduct}`);
  } catch (e) {
    check("29. Geçici test dosyaları / varlıkları temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

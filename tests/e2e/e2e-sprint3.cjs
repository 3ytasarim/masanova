// MasaNova AI Sprint 3 (menü) uçtan uca doğrulama — production build, headless Chrome. Parolalar yazdırılmaz.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s3");
fs.mkdirSync(OUT, { recursive: true });
const run = Math.random().toString(36).slice(2, 7);
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const results = [];
const check = (name, ok, detail = "") => results.push({ ok: !!ok, name, detail: String(detail).slice(0, 300) });
const fixtures = { waiterId: null, foreignCategoryId: null, foreignProductId: null };
let currentPage = null;

const text = (page) => page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function setValue(page, selector, value) {
  await page.$eval(selector, (el) => {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type(selector, value);
}
async function waitText(page, t, timeout = 15000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { polling: 300, timeout }, t);
}
async function clickByText(page, label, scope = "") {
  const [el] = await page.$$(`xpath/.${scope}//button[normalize-space(.)="${label}"]`);
  if (!el) throw new Error(`Düğme yok: ${label}`);
  await el.click();
}
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle0" });
  if (!(await page.$("#email"))) {
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('form button[type="submit"]')]);
  }
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !location.pathname.startsWith("/giris") && document.querySelector("main h1"), { polling: 300, timeout: 20000 }).catch(() => null);
}
async function gotoTab(page, productUrl, tab) {
  await page.goto(`${productUrl}?sekme=${tab}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[role="tabpanel"]:not([hidden])', { timeout: 15000 });
}
/** Görünür sekme panelindeki formu gönderir. */
async function submitVisible(page, label) {
  await clickByText(page, label, '//div[@role="tabpanel" and not(@hidden)]');
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  for (const blank of await browser.pages()) await blank.close(); // ilk about:blank sekmesi öne çıkıp sayfamızı arka plana itmesin
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.bringToFront();
  currentPage = page;
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && consoleErrors.push(page.url() + " " + m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.setViewport({ width: 1440, height: 900 });

  const demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });

  // 1) İşletme sahibi girişi + menü gösterge paneli
  await login(page, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("Sahip girişi → /panel", new URL(page.url()).pathname === "/panel", page.url());
  await page.goto(`${B}/panel/menu`, { waitUntil: "networkidle0" });
  const cards = await page.$$eval('section[aria-label="Menü özeti"] > div', (d) => d.map((x) => x.innerText.split("\n")[0]));
  check("Menü paneli: 6 kart", cards.length === 6, cards.join(" | "));
  const dash = await text(page);
  check("Menü paneli: hızlı eylemler + son güncellenenler", dash.includes("Yeni Ürün") && dash.includes("Yeni Kategori") && dash.includes("Son güncellenen ürünler"));
  await page.screenshot({ path: path.join(OUT, "menu-dashboard.png"), fullPage: true });

  // 2) Kategori oluştur
  const catName = `E2E Pideler ${run}`;
  await page.goto(`${B}/panel/menu/kategoriler`, { waitUntil: "networkidle0" });
  check("Kategoriler: seed iç içe yapı", (await text(page)).includes("Sıcak İçecekler") && (await text(page)).includes("Soğuk İçecekler"));
  await clickByText(page, "Yeni Kategori");
  await page.waitForSelector("dialog[open]");
  await page.type("#cat-name", catName);
  check("Kategori: kısa ad addan önerilir", (await page.$eval("#cat-slug", (e) => e.value)) === `e2e-pideler-${run}`);
  await page.type(`#cat-t-en-name`, `E2E Pide ${run}`);
  await clickByText(page, "Kategoriyi oluştur", "//dialog[@open]");
  await waitText(page, "Kategori oluşturuldu.");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"), { polling: 300, timeout: 10000 });
  await page.reload({ waitUntil: "networkidle0" });
  check("Kategori listede", (await text(page)).includes(catName));
  await page.screenshot({ path: path.join(OUT, "categories.png"), fullPage: true });

  // 3) Ürün oluştur (kategori ata)
  await page.goto(`${B}/panel/menu/urunler/yeni`, { waitUntil: "networkidle0" });
  const productName = `E2E Lahmacun ${run}`;
  await page.type("#np-name", productName);
  const catOption = await page.$$eval("#np-category option", (os, n) => os.find((o) => o.textContent === n)?.value, catName);
  await page.select("#np-category", catOption);
  await page.type("#np-price", "95,50");
  await page.type("#np-short", "İnce hamur, bol kıymalı.");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickByText(page, "Ürünü oluştur ve düzenle")]);
  await waitText(page, "Ürün oluşturuldu").catch(() => null);
  const productUrl = page.url().split("?")[0];
  const productId = productUrl.split("/").pop();
  check("Ürün oluşturuldu → editöre yönlendi + toast", /\/panel\/menu\/urunler\/c[a-z0-9]+$/.test(productUrl) && (await page.evaluate(() => document.body.innerText)).includes("Ürün oluşturuldu"), productUrl);
  check("Editör sekmeleri", (await page.$$eval('[role="tab"]', (t) => t.map((x) => x.textContent.trim()))).length === 9); // Sprint 7: + İstasyonlar

  // 4) Görsel
  await gotoTab(page, productUrl, "gorseller");
  // Sprint 13: birincil yol bilgisayardan yükleme; harici https adresi katlanmış "Harici adresle ekle" bölümünde.
  const [externalToggle] = await page.$$('xpath/.//div[@role="tabpanel" and not(@hidden)]//summary[contains(., "Harici adresle ekle")]');
  await externalToggle.click();
  await page.waitForSelector("#img-url", { visible: true });
  await page.type("#img-url", "https://picsum.photos/seed/masanova-e2e/800/600");
  await page.type("#img-alt", "Lahmacun tabağı");
  await submitVisible(page, "Ekle");
  await waitText(page, "Görsel eklendi.");
  await page.reload({ waitUntil: "networkidle0" });
  check("Görsel eklendi (ana görsel)", (await text(page)).includes("Ana görsel"));

  // 5) Varyantlar
  await gotoTab(page, productUrl, "varyasyonlar");
  for (const [name, price] of [["Küçük", ""], ["Büyük", "120"]]) {
    await clickByText(page, "Varyant ekle", '//div[@role="tabpanel" and not(@hidden)]');
    await page.waitForSelector("dialog[open]");
    await page.type("#v-name", name);
    if (price) await page.type("#v-price", price);
    await page.type("#v-t-en-name", name === "Küçük" ? "Small" : "Large");
    await clickByText(page, "Kaydet", "//dialog[@open]");
    await waitText(page, "Varyant eklendi.");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"), { polling: 300, timeout: 10000 });
  }
  await gotoTab(page, productUrl, "varyasyonlar");
  const variantsText = await text(page);
  check("2 varyant, tam bir varsayılan", variantsText.includes("Küçük") && variantsText.includes("Büyük") && (variantsText.match(/Varsayılan/g) || []).length === 1);

  // 6) Ekstra grubu oluştur + seçenek ekle
  const groupName = `E2E Soslar ${run}`;
  await page.goto(`${B}/panel/menu/ekstralar`, { waitUntil: "networkidle0" });
  await clickByText(page, "Yeni grup");
  await page.waitForSelector("dialog[open]");
  await page.type("#mg-name", groupName);
  await setValue(page, "#mg-max", "2");
  await clickByText(page, "Kaydet", "//dialog[@open]");
  await waitText(page, "Ekstra grubu oluşturuldu.");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"), { polling: 300, timeout: 10000 });
  await page.reload({ waitUntil: "networkidle0" });
  const [addOption] = await page.$$(`xpath/.//li[.//h3[normalize-space(.)="${groupName}"]]//button[contains(., "Seçenek ekle")]`);
  await addOption.click();
  await page.waitForSelector("dialog[open]");
  await page.type("#mo-name", "Acı sos");
  await setValue(page, "#mo-price", "5");
  await clickByText(page, "Kaydet", "//dialog[@open]");
  await waitText(page, "Ekstra eklendi.");
  check("Ekstra grubu + seçenek oluşturuldu", true);
  // Zorunlu/min kuralı ihlali → doğrulama hatası
  await page.waitForFunction(() => !document.querySelector("dialog[open]"), { polling: 300, timeout: 10000 });
  await clickByText(page, "Yeni grup");
  await page.waitForSelector("dialog[open]");
  await page.type("#mg-name", `Hatalı ${run}`);
  await page.click("#mg-required");
  await clickByText(page, "Kaydet", "//dialog[@open]");
  await page.waitForSelector("#mg-min-error", { timeout: 10000 });
  check("Zorunlu grupta en az 0 → satır içi hata", (await page.$eval("#mg-min-error", (e) => e.textContent)).includes("Zorunlu"));
  await page.keyboard.press("Escape");

  // 7) Ürüne ekstra grubu bağla
  await gotoTab(page, productUrl, "ekstralar");
  const groupOption = await page.$$eval("#attach-group option", (os, n) => os.find((o) => o.textContent === n)?.value, groupName);
  await page.select("#attach-group", groupOption);
  await submitVisible(page, "Bağla");
  await waitText(page, "ürüne bağlandı");
  check("Ekstra grubu ürüne bağlandı", true);

  // 8) Malzeme ekle (kütüphane)
  const ingredientName = `E2E Kıyma ${run}`;
  await page.goto(`${B}/panel/menu/kutuphane`, { waitUntil: "networkidle0" });
  check("Kütüphane: 14 standart alerjen", (await text(page)).includes("Alerjenler (14)"));
  await page.click('[role="tab"]:nth-child(3)');
  await clickByText(page, "Malzeme ekle", '//div[@role="tabpanel" and not(@hidden)]');
  await page.waitForSelector("dialog[open]");
  await page.type("#lib-name", ingredientName);
  await page.type("#lib-t-en-name", "Minced meat");
  await clickByText(page, "Kaydet", "//dialog[@open]");
  await waitText(page, "Kayıt eklendi.");
  check("Malzeme eklendi", true);

  // 9) İçerik: malzeme + alerjen + diyet etiketi + kalori
  await gotoTab(page, productUrl, "icerik");
  for (const label of [ingredientName, "Gluten", "Acılı"]) {
    const [box] = await page.$$(`xpath/.//div[@role="tabpanel" and not(@hidden)]//label[.//span[normalize-space(.)="${label}"]]//input`);
    await box.click();
  }
  await page.type("#pc-calories", "450");
  check("Kaydedilmemiş değişiklik uyarısı", (await text(page)).includes("Kaydedilmemiş değişiklikler var."));
  await submitVisible(page, "İçeriği kaydet");
  await waitText(page, "İçerik ve alerjen bilgisi kaydedildi.");
  const content = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { allergens: { include: { allergen: true } }, ingredients: { include: { ingredient: true } }, dietaryTags: { include: { dietaryTag: true } } } });
  check(
    "İçerik veritabanında",
    content.allergens.map((a) => a.allergen.code).join() === "gluten" && content.ingredients[0]?.ingredient.name === ingredientName && content.dietaryTags[0]?.dietaryTag.code === "spicy" && content.calories === 450,
  );

  // 10) Çeviriler EN / DE / AR (RTL)
  await gotoTab(page, productUrl, "ceviriler");
  await page.type("#pt-en-name", "Lahmacun (Turkish pizza)");
  await page.type("#pt-de-name", "Lahmacun (türkische Pizza)");
  await page.type("#pt-ar-name", "لحم بعجين");
  const dir = await page.$eval("#pt-ar-name", (e) => [e.getAttribute("dir"), e.getAttribute("lang"), getComputedStyle(e).direction]);
  check("Arapça alan RTL (dir/lang/computed)", dir.join() === "rtl,ar,rtl", dir.join());
  await submitVisible(page, "Çevirileri kaydet");
  await waitText(page, "Çeviriler kaydedildi.");
  const tr = await db.productTranslation.findMany({ where: { productId }, orderBy: { locale: "asc" } });
  check("EN/DE/AR çeviri kayıtları", tr.map((t) => t.locale).join() === "ar,de,en" && tr[0].name === "لحم بعجين");

  // 11) Şube geçersiz kılma (Kadıköy)
  await gotoTab(page, productUrl, "subeler");
  const kadikoy = await db.branch.findFirstOrThrow({ where: { tenantId: demo.id, slug: "kadikoy" } });
  await page.type(`#bo-${kadikoy.id}-price`, "99,90");
  await clickByText(page, "Kadıköy Şube için kaydet");
  await waitText(page, "Kadıköy Şube ayarları kaydedildi.");
  await gotoTab(page, productUrl, "subeler");
  const branchText = await page.$eval(`#bo-${kadikoy.id}-price`, (e) => e.closest("form").innerText);
  check("Şube fiyatı çözümlendi (₺99,90)", branchText.includes("99,90"), branchText.slice(0, 120));
  await gotoTab(page, productUrl, "fiyat");
  check("Fiyat önizlemesi: şube fiyatı kaynağı", (await text(page)).includes("Şube fiyatı"));

  // 12) Tükendi → yeniden satış
  await page.goto(productUrl, { waitUntil: "networkidle0" });
  await clickByText(page, "Tükendi işaretle");
  await waitText(page, "Ürün tükendi olarak işaretlendi.");
  await page.reload({ waitUntil: "networkidle0" });
  check("Durum: Tükendi", (await text(page)).includes("Tükendi"));
  await clickByText(page, "Yeniden satışa aç");
  await waitText(page, "Ürün yeniden satışta.");
  await page.reload({ waitUntil: "networkidle0" });
  check("Durum: Satışta", (await page.$eval("main", (m) => m.innerText)).includes("Satışta"));

  // 13) Liste: arama / filtre / toplu işlem
  await page.goto(`${B}/panel/menu/urunler?q=${run}`, { waitUntil: "networkidle0" });
  const listText = await text(page);
  check("Liste: arama", listText.includes(productName) && listText.includes("1 kayıttan"));
  await page.goto(`${B}/panel/menu/urunler?q=${encodeURIComponent("Turkish pizza")}`, { waitUntil: "networkidle0" });
  check("Liste: çeviri adıyla arama", (await text(page)).includes(productName));
  await page.goto(`${B}/panel/menu/urunler?kategori=${catOption}`, { waitUntil: "networkidle0" });
  check("Liste: kategori filtresi + menü sırası okları", (await text(page)).includes(productName) && !!(await page.$('button[aria-label$=": yukarı"]')));
  await page.goto(`${B}/panel/menu/urunler?q=${run}`, { waitUntil: "networkidle0" });
  await page.click(`input[name="ids"][value="${productId}"]`);
  await page.select("#bulk-op", "feature");
  await clickByText(page, "Uygula");
  await waitText(page, "1 ürün güncellendi.");
  await page.goto(`${B}/panel/menu/urunler?onecikan=evet&q=${run}`, { waitUntil: "networkidle0" });
  check("Toplu işlem: öne çıkan + filtre", (await text(page)).includes(productName));
  await page.goto(`${B}/panel/menu/urunler?tukendi=evet`, { waitUntil: "networkidle0" });
  check("Liste: tükendi filtresi", !(await text(page)).includes(productName));
  await page.goto(`${B}/panel/menu/urunler`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, "product-list.png"), fullPage: true });

  // 14) IDOR (tarayıcı): başka kiracının ürünü
  const askida = await db.tenant.findUniqueOrThrow({ where: { slug: "askida-demo" }, select: { id: true } });
  const fCat = await db.menuCategory.create({ data: { tenantId: askida.id, name: "Yabancı", slug: `e2e-foreign-${run}` }, select: { id: true } });
  fixtures.foreignCategoryId = fCat.id;
  const fProd = await db.product.create({ data: { tenantId: askida.id, categoryId: fCat.id, name: "Yabancı ürün", slug: `e2e-foreign-${run}`, basePriceMinor: 100 }, select: { id: true } });
  fixtures.foreignProductId = fProd.id;
  let res = await page.goto(`${B}/panel/menu/urunler/${fProd.id}`, { waitUntil: "networkidle0" });
  check("IDOR: başka kiracının ürünü → 404", res.status() === 404, res.status());

  // 15) Mobil (375 / 390)
  for (const width of [375, 390]) {
    await page.setViewport({ width, height: 812, isMobile: true, hasTouch: true });
    for (const p of [productUrl, `${productUrl}?sekme=subeler`, `${productUrl}?sekme=icerik`, `${productUrl}?sekme=ceviriler`, `${B}/panel/menu/urunler`, `${B}/panel/menu/kategoriler`, `${B}/panel/menu/ekstralar`, `${B}/panel/menu/kutuphane`, `${B}/panel/menu`]) {
      await page.goto(p, { waitUntil: "networkidle0" });
      const o = await overflow(page);
      check(`${width}px ${p.replace(B, "")} yatay taşma yok`, o <= 0, `fazla=${o}`);
    }
  }
  for (const width of [1024, 1440]) {
    await page.setViewport({ width, height: 900 });
    for (const p of [productUrl, `${B}/panel/menu/urunler`, `${B}/panel/menu/kategoriler`, `${B}/panel/menu/ekstralar`, `${B}/panel/menu/kutuphane`, `${B}/panel/menu`]) {
      await page.goto(p, { waitUntil: "networkidle0" });
      const o = await overflow(page);
      check(`${width}px ${p.replace(B, "")} yatay taşma yok`, o <= 0, `fazla=${o}`);
    }
  }
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await page.goto(productUrl, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, "mobile-editor.png"), fullPage: true });
  await page.goto(`${B}/panel/menu/urunler`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, "mobile-list.png"), fullPage: true });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${productUrl}?sekme=ceviriler`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, "editor-translations.png"), fullPage: true });
  await page.goto(`${productUrl}?sekme=subeler`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, "editor-branches.png"), fullPage: true });

  // 16) Garson: salt okunur
  const waiterEmail = `waiter-${run}@e2e.masanovai.test`;
  const waiterPassword = `Waiter-${run}-${Math.random().toString(36).slice(2)}`;
  const waiter = await db.user.create({ data: { tenantId: demo.id, email: waiterEmail, firstName: "E2E", lastName: "Garson", role: "WAITER", passwordHash: await hash(waiterPassword) }, select: { id: true } });
  fixtures.waiterId = waiter.id;
  const wp = await (await browser.createBrowserContext()).newPage();
  await wp.setViewport({ width: 1440, height: 900 });
  await wp.bringToFront();
  await login(wp, waiterEmail, waiterPassword);
  await wp.goto(`${B}/panel/menu`, { waitUntil: "networkidle0" });
  const wText = await text(wp);
  check("Garson: menüyü salt okunur görür", wText.includes("Salt okunur görünüm") && !wText.includes("Yeni Ürün"));
  await wp.goto(productUrl, { waitUntil: "networkidle0" });
  check("Garson: editör alanları devre dışı", await wp.$eval("#pg-name", (e) => e.closest("fieldset").disabled));
  res = await wp.goto(`${B}/panel/menu/urunler/yeni`, { waitUntil: "networkidle0" });
  check("Garson: yeni ürün sayfası → 404", res.status() === 404, res.status());

  // 17) Super Admin regresyon + destek modu menüde salt okunur
  const ap = await (await browser.createBrowserContext()).newPage();
  await ap.setViewport({ width: 1440, height: 900 });
  await ap.bringToFront();
  await login(ap, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  check("Super Admin girişi → /admin", new URL(ap.url()).pathname === "/admin");
  res = await ap.goto(`${B}/admin/isletmeler`, { waitUntil: "networkidle0" });
  check("Super Admin: işletmeler listesi", res.status() === 200 && (await text(ap)).includes("3Y Demo Restaurant"));
  for (const width of [1024, 1440]) {
    await ap.setViewport({ width, height: 900 });
    for (const p of ["/admin", "/admin/isletmeler", "/admin/domainler", "/admin/subeler", "/admin/demo-talepleri", "/admin/audit-logs"]) {
      await ap.goto(`${B}${p}`, { waitUntil: "networkidle0" });
      const o = await overflow(ap);
      check(`${width}px ${p} yatay taşma yok`, o <= 0, `fazla=${o}`);
    }
  }
  await ap.setViewport({ width: 1440, height: 900 });
  await ap.goto(`${B}/admin/isletmeler/${demo.id}`, { waitUntil: "networkidle0" });
  await clickByText(ap, "Destek Modu", "//header");
  await ap.waitForSelector("dialog[open]");
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle0" }), clickByText(ap, "Destek modunu başlat", "//dialog[@open]")]);
  await ap.goto(`${B}/panel/menu/urunler`, { waitUntil: "networkidle0" });
  const supText = await ap.evaluate(() => document.body.innerText);
  check("Destek modu: menü görünür ama salt okunur", supText.includes("Destek Modu") && supText.includes("Salt okunur görünüm") && supText.includes("Cheeseburger"));
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle0" }), clickByText(ap, "Destek modundan çık")]);
  res = await ap.goto(`${B}/panel/menu`, { waitUntil: "networkidle0" });
  check("Destek modu kapalı → Super Admin /panel/menu 404", res.status() === 404, res.status());

  // 18) Sahip /admin → 404 (regresyon)
  await page.bringToFront();
  res = await page.goto(`${B}/admin`, { waitUntil: "networkidle0" });
  check("Sahip /admin → 404", res.status() === 404, res.status());

  // 19) Denetim kayıtları
  const audits = await db.auditLog.findMany({ where: { tenantId: demo.id, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }, select: { action: true } });
  const actions = new Set(audits.map((a) => a.action));
  const expected = ["CATEGORY_CREATED", "PRODUCT_CREATED", "PRODUCT_UPDATED", "PRODUCT_SOLD_OUT_CHANGED", "VARIANT_CREATED", "MODIFIER_GROUP_CREATED", "MODIFIER_CREATED", "MENU_LIBRARY_UPDATED", "BRANCH_PRODUCT_OVERRIDE_UPDATED", "PRODUCT_BULK_UPDATED"];
  check("Menü denetim kayıtları", expected.every((a) => actions.has(a)), expected.filter((a) => !actions.has(a)).join(","));

  check("Tarayıcı konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" || "));
  await browser.close();

  // Temizlik (yalnızca bu testin oluşturduğu fikstürler)
  const fixtureProduct = await db.product.findFirst({ where: { tenantId: demo.id, slug: { startsWith: "e2e-lahmacun-" } }, select: { id: true } });
  const fixtureGroupIds = (await db.modifierGroup.findMany({ where: { tenantId: demo.id, name: { startsWith: "E2E Soslar" } }, select: { id: true } })).map((g) => g.id);
  const fixtureIngredientIds = (await db.ingredient.findMany({ where: { tenantId: demo.id, name: { startsWith: "E2E Kıyma" } }, select: { id: true } })).map((i) => i.id);
  const fixtureCatIds = (await db.menuCategory.findMany({ where: { tenantId: demo.id, slug: { startsWith: "e2e-pideler-" } }, select: { id: true } })).map((c) => c.id);
  if (fixtureProduct) await db.product.delete({ where: { id: fixtureProduct.id } });
  await db.product.deleteMany({ where: { tenantId: demo.id, slug: { startsWith: "e2e-lahmacun-" } } });
  await db.modifierGroup.deleteMany({ where: { id: { in: fixtureGroupIds } } });
  await db.ingredient.deleteMany({ where: { id: { in: fixtureIngredientIds } } });
  await db.menuCategory.deleteMany({ where: { id: { in: fixtureCatIds } } });
  if (fixtures.foreignProductId) await db.product.delete({ where: { id: fixtures.foreignProductId } });
  if (fixtures.foreignCategoryId) await db.menuCategory.delete({ where: { id: fixtures.foreignCategoryId } });
  if (fixtures.waiterId) {
    await db.session.deleteMany({ where: { userId: fixtures.waiterId } });
    await db.user.delete({ where: { id: fixtures.waiterId } });
  }
  await db.$disconnect();

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} geçti`);
})().catch(async (e) => {
  console.error("E2E HATA", e.message);
  if (currentPage) {
    await currentPage.screenshot({ path: path.join(OUT, "FAIL.png"), fullPage: true }).catch(() => null);
    console.log("URL:", currentPage.url(), "TEXT:", (await currentPage.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 900));
  }
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
  if (fixtures.waiterId) await db.session.deleteMany({ where: { userId: fixtures.waiterId } }).then(() => db.user.delete({ where: { id: fixtures.waiterId } })).catch(() => null);
  if (fixtures.foreignProductId) await db.product.delete({ where: { id: fixtures.foreignProductId } }).catch(() => null);
  if (fixtures.foreignCategoryId) await db.menuCategory.delete({ where: { id: fixtures.foreignCategoryId } }).catch(() => null);
  await db.$disconnect();
  process.exit(1);
});

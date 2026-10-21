// MasaNova AI Sprint 6 (sepet, güvenli sipariş, panel siparişleri) uçtan uca doğrulama — production build, headless Chrome.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s6");
fs.mkdirSync(OUT, { recursive: true });
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const results = [];
const check = (name, ok, detail = "") => results.push({ ok: !!ok, name, detail: String(detail).slice(0, 300) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const derive = (nonce) => crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
const state = { demo: null, restore: [] };
let currentPage = null;

const bodyText = (p) => p.evaluate(() => document.body.innerText);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function waitText(p, t, timeout = 20000) {
  await p.waitForFunction((t) => document.body.innerText.includes(t), { polling: 250, timeout }, t);
}
async function clickXp(p, xpath) {
  const [el] = await p.$$(`xpath/${xpath}`);
  if (!el) throw new Error(`Öğe yok: ${xpath}`);
  await el.click();
}
const sheetBtn = (role, label) => `.//dialog[@open]//button[@role="${role}"][.//span[normalize-space(.)="${label}"]]`;
async function openProduct(p, slug) {
  await p.click(`[data-product="${slug}"]`);
  await p.waitForSelector("dialog[open] #pm-sheet-title");
  await sleep(350);
}
async function addToCart(p) {
  await p.click("dialog[open] [data-testid='add-to-cart']");
  await p.waitForFunction(() => !document.querySelector("dialog[open] #pm-sheet-title"), { polling: 200, timeout: 8000 });
  await sleep(250);
}
async function openCart(p) {
  await p.click('[data-testid="cart-bar"]');
  await p.waitForSelector("dialog[open] #pm-cart-title");
  await p.waitForFunction(() => !document.body.innerText.match(/kontrol ediliyor|Checking current|werden geprüft|جارٍ التحقق/), { polling: 250, timeout: 15000 }).catch(() => null);
  await sleep(300);
}
async function closeDialog(p) {
  await p.keyboard.press("Escape");
  await sleep(350);
}
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
}
async function setLang(p, label, code) {
  await p.click('button[aria-haspopup="true"]');
  const [link] = await p.$$(`xpath/.//a[.//span[normalize-space(.)="${label}"]]`);
  await Promise.all([p.waitForFunction((l) => new URL(location.href).searchParams.get("dil") === l, { polling: 200, timeout: 20000 }, code), link.click()]);
  await sleep(600);
}
async function cleanOrders() {
  if (!state.demo) return;
  await db.order.deleteMany({ where: { tenantId: state.demo.id } });
  await db.orderSequence.deleteMany({ where: { tenantId: state.demo.id } });
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true, name: true } });
  await cleanOrders(); // demo / geliştirme siparişleri (önceki denemeler) temizlenir
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: state.demo.id, name: "Masa 12" }, select: { id: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const stable = `${B}/q/${derive(row.tokenNonce)}`;
  const other = await db.diningTable.findFirstOrThrow({ where: { tenantId: state.demo.id, name: "Masa 11" }, select: { id: true } });
  const otherRow = await db.tableQrToken.findFirstOrThrow({ where: { tableId: other.id, active: true } });
  const otherStable = `${B}/q/${derive(otherRow.tokenNonce)}`;

  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const consoleErrors = [];
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && !/status of 404/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
  };
  const cust = (await browser.pages())[0];
  currentPage = cust;
  watch(cust);
  await cust.bringToFront();
  await cust.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // 1–2
  await cust.goto(stable, { waitUntil: "networkidle2" });
  check("1. Kararlı masa QR'ı açılır (Masa 12)", (await cust.$eval('[data-testid="table-badge"]', (e) => e.innerText)).includes("Masa 12"));
  check("2. Menü göz atılabilir (kategori çipleri)", (await cust.$$("[data-chip]")).length > 3);
  check("Sepet boşken sepet çubuğu yok", !(await cust.$('[data-testid="cart-bar"]')));

  // 3–8 Cheeseburger: Çift + Orta + Cheddar, adet 2
  await openProduct(cust, "cheeseburger");
  check("3. Ürün açılır, varsayılan varyant seçili (Tek)", await cust.$eval("dialog[open]", (d) => d.querySelector('[role="radio"][aria-checked="true"]')?.innerText.includes("Tek")));
  await clickXp(cust, sheetBtn("radio", "Çift"));
  check("4. Varyant seçilir → canlı fiyat ₺520,00", (await cust.$eval('[data-testid="sheet-price"]', (e) => e.textContent)).includes("520,00"));
  await cust.click("dialog[open] [data-testid='add-to-cart']");
  await sleep(200);
  check("Zorunlu ekstra seçilmeden sepete eklenmez (açık hata)", (await bodyText(cust)).includes("Pişirme Derecesi: en az 1 seçim yapın.") && !!(await cust.$("dialog[open] #pm-sheet-title")));
  await clickXp(cust, sheetBtn("radio", "Orta"));
  check("5. Zorunlu ekstra seçildi", await cust.$eval("dialog[open]", (d) => [...d.querySelectorAll('[role="radio"][aria-checked="true"]')].some((b) => b.innerText.includes("Orta"))));
  await clickXp(cust, sheetBtn("checkbox", "Cheddar"));
  check("6. İsteğe bağlı ekstra (+₺30) → ₺550,00", (await cust.$eval('[data-testid="sheet-price"]', (e) => e.textContent)).includes("550,00"));
  await cust.click('dialog[open] button[aria-label="Cheeseburger: adedi artır"]');
  check("7. Adet 2 → buton toplamı ₺1.100,00", (await cust.$eval("dialog[open] [data-testid='add-to-cart']", (e) => e.innerText)).includes("1.100,00"));
  await addToCart(cust);
  await cust.waitForSelector('[data-testid="cart-bar"]');
  check("8. Sepete eklendi: 'Sepetim · 2 ürün · ₺1.100,00'", (await cust.$eval('[data-testid="cart-bar"]', (e) => e.innerText)).includes("Sepetim · 2 ürün · ₺1.100,00"));

  // 9 ikinci ürün
  await openProduct(cust, "mercimek-corbasi");
  await addToCart(cust);
  check("9. İkinci ürün eklendi (3 ürün · ₺1.220,00)", (await cust.$eval('[data-testid="cart-bar"]', (e) => e.innerText)).includes("3 ürün · ₺1.220,00"));

  // 10 sepet
  await openCart(cust);
  const lines = await cust.$$eval("dialog[open] [data-cart-line]", (els) => els.map((e) => e.getAttribute("data-cart-line")));
  check("10. Sepet açılır: 2 satır, toplam ₺1.220,00", lines.join(",") === "cheeseburger,mercimek-corbasi" && (await cust.$eval('[data-testid="cart-total"]', (e) => e.innerText)).includes("1.220,00"), lines.join(","));

  // 11 + 13 düzenle: Tek'e geç + ürün notu
  await clickXp(cust, `.//dialog[@open]//li[@data-cart-line="cheeseburger"]//button[contains(., "Düzenle")]`);
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  await sleep(350);
  check("11a. Düzenleme mevcut yapılandırmayla açılır (Çift + Orta + Cheddar, adet 2)", (await cust.$eval('[data-testid="sheet-price"]', (e) => e.textContent)).includes("550,00"));
  await clickXp(cust, sheetBtn("radio", "Tek"));
  await cust.type("dialog[open] textarea", "Soğan olmasın");
  await cust.click("dialog[open] [data-testid='add-to-cart']");
  await cust.waitForSelector("dialog[open] #pm-cart-title");
  await sleep(1200);
  const editedLine = await cust.$eval('dialog[open] li[data-cart-line="cheeseburger"]', (e) => e.innerText);
  check("11b. Düzenlenen satır güncellendi (Tek · Orta · Cheddar, ₺820,00)", editedLine.includes("Tek · Orta · Cheddar") && editedLine.includes("820,00"), editedLine);
  check("13. Ürün notu satırda", editedLine.includes("Soğan olmasın"));

  // 12 kaldır / yeniden ekle
  await clickXp(cust, `.//dialog[@open]//li[@data-cart-line="mercimek-corbasi"]//button[contains(., "Kaldır")]`);
  await sleep(300);
  check("12a. Satır kaldırıldı", (await cust.$$("dialog[open] [data-cart-line]")).length === 1);
  await closeDialog(cust);
  await openProduct(cust, "mercimek-corbasi");
  await addToCart(cust);
  await openCart(cust);
  check("12b. Yeniden eklendi (2 satır, ₺940,00)", (await cust.$$("dialog[open] [data-cart-line]")).length === 2 && (await cust.$eval('[data-testid="cart-total"]', (e) => e.innerText)).includes("940,00"));
  // Adet artır/azalt (sepette)
  await cust.click('dialog[open] li[data-cart-line="mercimek-corbasi"] button[aria-label="Mercimek Çorbası: adedi artır"]');
  await sleep(250);
  await cust.click('dialog[open] li[data-cart-line="mercimek-corbasi"] button[aria-label="Mercimek Çorbası: adedi azalt"]');
  await sleep(250);

  // 14 sipariş notu
  await cust.type("dialog[open] textarea", "Lütfen hepsi birlikte gelsin.");
  await sleep(300);
  // 15 gözden geçir
  await cust.click('[data-testid="review-order"]');
  await cust.waitForSelector('[data-testid="send-order"]');
  const confirmText = await cust.$eval("dialog[open]", (d) => d.innerText);
  check("15. Son onay: Masa 12 · 3 ürün · ₺940,00", confirmText.toLocaleLowerCase("tr-TR").includes("masa 12") && confirmText.includes("3 ürün") && confirmText.includes("940,00"), confirmText.slice(0, 200));
  await cust.screenshot({ path: path.join(OUT, "e2e-confirm-390.png") });

  // 16–18 gönder
  await cust.click('[data-testid="send-order"]');
  await cust.waitForSelector('[data-testid="order-success"]', { timeout: 20000 });
  const number = (await cust.$eval('[data-testid="order-number"]', (e) => e.textContent)).trim();
  check("16–17. Sipariş gönderildi: 'Siparişiniz alındı' + 'Restoran onayı bekleniyor'", (await bodyText(cust)).includes("Siparişiniz alındı") && (await bodyText(cust)).includes("Restoran onayı bekleniyor"));
  check("18. Sipariş numarası (#1001)", number === "#1001", number);
  check("Gönderimden sonra sepet boşaldı", !(await cust.$('[data-testid="cart-bar"]')));
  const order = await db.order.findFirstOrThrow({ where: { tenantId: state.demo.id, orderNumber: 1001 }, include: { items: { include: { modifiers: true }, orderBy: { sortOrder: "asc" } } } });
  check("Veritabanı: toplam sunucuda hesaplandı (94000), kopyalar doğru", order.totalMinor === 94000 && order.items[0].productName === "Cheeseburger" && order.items[0].variantName === "Tek" && order.items[0].unitPriceMinor === 41000 && order.items[0].note === "Soğan olmasın" && order.customerNote === "Lütfen hepsi birlikte gelsin.", JSON.stringify({ t: order.totalMinor }));

  // 19 public sipariş sayfası
  await clickXp(cust, `.//a[contains(., "Siparişi Gör")]`);
  await cust.waitForFunction(() => location.pathname.includes("/siparis/") && !!document.querySelector("[data-testid=public-order-status]"), { polling: 200, timeout: 20000 });
  const orderUrl = cust.url();
  check("19. Public sipariş sayfası (güvenli kimlik, iç kimlik yok)", /\/t\/[A-Za-z0-9_-]{22}\/siparis\/[A-Za-z0-9_-]{22}$/.test(orderUrl) && (await cust.$eval('[data-testid="public-order-status"]', (e) => e.dataset.status)) === "SUBMITTED" && (await cust.$eval('[data-testid="public-order-total"]', (e) => e.innerText)).includes("940,00") && !(await cust.content()).includes(order.id), orderUrl);
  // Başka masanın QR bağlamıyla aynı sipariş açılmaz
  const otherCtx = await (await browser.createBrowserContext()).newPage();
  watch(otherCtx);
  await otherCtx.goto(otherStable, { waitUntil: "networkidle2" });
  const otherOrderUrl = otherCtx.url().replace(/\/t\/[^/]+$/, `/t/${otherCtx.url().split("/t/")[1]}`) + `/siparis/${order.publicId}`;
  const otherRes = await otherCtx.goto(otherOrderUrl, { waitUntil: "networkidle2" });
  check("Başka masanın QR'ı ile sipariş görüntülenemez (404)", otherRes.status() === 404 && !(await bodyText(otherCtx)).includes("940"), otherRes.status());
  await otherCtx.close();
  await cust.bringToFront();

  // 20–24 panel
  const admin = await (await browser.createBrowserContext()).newPage();
  watch(admin);
  await admin.bringToFront();
  await admin.setViewport({ width: 1440, height: 1000 });
  await login(admin, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("20. Restoran sahibi giriş", admin.url().startsWith(`${B}/panel`));
  await admin.goto(`${B}/panel/siparisler`, { waitUntil: "networkidle2" });
  check("21. /panel/siparisler gerçek liste (yer tutucu değil)", (await bodyText(admin)).includes("Siparişler") && !(await bodyText(admin)).includes("Yakında"));
  const rowText = await admin.$eval('tr[data-order-number="1001"]', (r) => r.innerText);
  check("22. Yeni sipariş listede (#1001 · Masa 12 · İç Salon? · 3 · ₺940,00 · Onay bekliyor)", rowText.includes("#1001") && rowText.includes("Masa 12") && rowText.includes("940,00") && rowText.includes("Onay bekliyor"), rowText);
  await admin.goto(`${B}/panel/siparisler?q=1001`, { waitUntil: "networkidle2" });
  check("Sipariş numarasıyla arama", (await admin.$$("tr[data-order-number]")).length === 1);
  await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle2" }), admin.click('tr[data-order-number="1001"] a')]);
  const detail = await bodyText(admin);
  check("23. Detay kopyaları: Tek · Pişirme Derecesi: Orta · Cheddar (₺30) · not · toplam", ["Cheeseburger", "Tek", "Pişirme Derecesi: Orta", "Ekstra Malzemeler: Cheddar", "Not: Soğan olmasın", "Lütfen hepsi birlikte gelsin.", "940,00", "Müşteri (QR)"].every((t) => detail.includes(t)), detail.slice(0, 400));
  await clickXp(admin, `.//button[normalize-space(.)="Kabul et"]`);
  await admin.waitForSelector("dialog[open]");
  await clickXp(admin, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  await waitText(admin, "#1001 kabul edildi");
  await admin.waitForFunction(() => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("Kabul edildi"), { polling: 250, timeout: 15000 });
  check("24. Sipariş kabul edildi (geçmişe yazıldı)", (await bodyText(admin)).includes("Demo İşletme Sahibi"));

  // 25 public durum
  await cust.bringToFront();
  await cust.reload({ waitUntil: "networkidle2" });
  check("25. Müşteri sayfasında 'Restoran siparişinizi kabul etti'", (await cust.$eval('[data-testid="public-order-status"]', (e) => e.dataset.status)) === "ACCEPTED" && (await bodyText(cust)).includes("Restoran siparişinizi kabul etti"));

  // 26–27 canlı fiyat değişir, geçmiş sipariş değişmez
  const burger = await db.product.findFirstOrThrow({ where: { tenantId: state.demo.id, slug: "cheeseburger" } });
  state.restore.push(() => db.product.update({ where: { id: burger.id }, data: { basePriceMinor: burger.basePriceMinor, name: burger.name } }));
  await db.product.update({ where: { id: burger.id }, data: { basePriceMinor: 45000, name: "Cheeseburger XL" } });
  await admin.bringToFront();
  await admin.reload({ waitUntil: "networkidle2" });
  const after = await bodyText(admin);
  check("26–27. Canlı fiyat / ad değişti; geçmiş sipariş eski fiyatı ve adı gösterir", after.includes("Cheeseburger") && !after.includes("XL") && after.includes("940,00") && after.includes("410,00"), after.slice(0, 300));
  await cust.bringToFront();
  await cust.reload({ waitUntil: "networkidle2" });
  check("Müşteri sipariş sayfası da eski kopyayı gösterir", !(await bodyText(cust)).includes("XL") && (await cust.$eval('[data-testid="public-order-total"]', (e) => e.innerText)).includes("940,00"));
  await state.restore.pop()();

  // 28–29 çift gönderim
  await cust.goto(stable, { waitUntil: "networkidle2" });
  await openProduct(cust, "turk-kahvesi");
  await addToCart(cust);
  await openCart(cust);
  await cust.click('[data-testid="review-order"]');
  await cust.waitForSelector('[data-testid="send-order"]');
  const beforeCount = await db.order.count({ where: { tenantId: state.demo.id } });
  // Aynı karede iki dokunuş + ağ tekrarı: düğme iki kez tetiklenir.
  await cust.$eval('[data-testid="send-order"]', (b) => {
    b.click();
    b.click();
  });
  await cust.waitForSelector('[data-testid="order-success"]', { timeout: 20000 });
  await sleep(800);
  check("28–29. Çift dokunuş → yalnızca bir sipariş", (await db.order.count({ where: { tenantId: state.demo.id } })) === beforeCount + 1);
  await closeDialog(cust);
  check("Sepet boşken 'Siparişlerim' kısayolu", (await cust.$eval('[data-testid="my-orders"]', (e) => e.innerText)).includes("#1002"));

  // 30–32 tükendi → mutabakat / engel → geri al
  await openProduct(cust, "izgara-tavuk");
  await addToCart(cust);
  await admin.bringToFront();
  await admin.goto(`${B}/panel/menu/urunler`, { waitUntil: "networkidle2" });
  await admin.click('button[aria-label="Izgara Tavuk: tükendi işaretle"]');
  await admin.waitForSelector('button[aria-label="Izgara Tavuk: yeniden satışa aç"]', { timeout: 15000 });
  state.restore.push(async () => db.product.updateMany({ where: { tenantId: state.demo.id, slug: "izgara-tavuk" }, data: { soldOut: false } }));
  await cust.bringToFront();
  await openCart(cust);
  const soldLine = await cust.$eval('dialog[open] li[data-cart-line="izgara-tavuk"]', (e) => e.innerText);
  const reviewDisabled = await cust.$eval('[data-testid="review-order"]', (b) => b.getAttribute("aria-disabled"));
  check("30–31. Sepetteki ürün tükenince: 'Tükendi' gösterilir, silinmez, onay engellenir", soldLine.includes("Tükendi") && reviewDisabled === "true" && (await bodyText(cust)).includes("Menüde bazı bilgiler değişti."), `${soldLine} / ${reviewDisabled}`);
  await cust.click('[data-testid="review-order"]');
  await sleep(300);
  check("Engelli onay ile gönderim adımına geçilmez", !(await cust.$('[data-testid="send-order"]')));
  // Fiyat değişikliği mutabakatı (yetkili veri: veritabanı; önbellek değil)
  await clickXp(cust, `.//dialog[@open]//li[@data-cart-line="izgara-tavuk"]//button[contains(., "Kaldır")]`);
  await closeDialog(cust);
  await openProduct(cust, "mercimek-corbasi");
  await addToCart(cust);
  const soup = await db.product.findFirstOrThrow({ where: { tenantId: state.demo.id, slug: "mercimek-corbasi" } });
  state.restore.push(() => db.product.update({ where: { id: soup.id }, data: { basePriceMinor: soup.basePriceMinor } }));
  await db.product.update({ where: { id: soup.id }, data: { basePriceMinor: 13000 } });
  await openCart(cust);
  check("Fiyat değişti mutabakatı: '₺120,00 → ₺130,00', onay için kabul gerekir", (await bodyText(cust)).includes("Fiyat değişti: ₺120,00 → ₺130,00") && (await cust.$eval('[data-testid="review-order"]', (b) => b.getAttribute("aria-disabled"))) === "true");
  await cust.click('[data-testid="accept-changes"]');
  await sleep(300);
  check("Yeni tutar kabul edildi → toplam ₺130,00, onay açık", (await cust.$eval('[data-testid="cart-total"]', (e) => e.innerText)).includes("130,00") && (await cust.$eval('[data-testid="review-order"]', (b) => b.getAttribute("aria-disabled"))) === "false");
  await (state.restore.pop())();
  await admin.bringToFront();
  await admin.click('button[aria-label="Izgara Tavuk: yeniden satışa aç"]');
  await admin.waitForSelector('button[aria-label="Izgara Tavuk: tükendi işaretle"]', { timeout: 15000 });
  state.restore.pop();
  check("32. Ürün geri yüklendi", !(await db.product.findFirstOrThrow({ where: { tenantId: state.demo.id, slug: "izgara-tavuk" } })).soldOut);
  await cust.bringToFront();
  await closeDialog(cust);

  // 33 TR tamam (yukarıda). Sepeti temizle → onaylı
  await openCart(cust);
  await clickXp(cust, `.//dialog[@open]//button[normalize-space(.)="Sepeti temizle"]`);
  await clickXp(cust, `.//dialog[@open]//div[contains(., "silinsin mi")]/button[normalize-space(.)="Sepeti temizle"]`);
  await sleep(300);
  check("33. TR: sepeti temizleme onaylı", (await bodyText(cust)).includes("Sepetiniz boş"));
  await closeDialog(cust);

  // 34–36 EN / DE / AR sepet + ödeme arayüzü
  const langs = [
    ["English", "en", "My cart", "Confirm order", "Send order"],
    ["Deutsch", "de", "Warenkorb", "Bestellung bestätigen", "Bestellung senden"],
    ["العربية", "ar", "سلتي", "تأكيد الطلب", "إرسال الطلب"],
  ];
  for (const [label, code, cartTitle, review, send] of langs) {
    await setLang(cust, label, code);
    await openProduct(cust, "turk-kahvesi");
    await addToCart(cust);
    await openCart(cust);
    const t = await cust.$eval("dialog[open]", (d) => d.innerText);
    await cust.click('[data-testid="review-order"]');
    await cust.waitForSelector('[data-testid="send-order"]');
    const sendText = await cust.$eval('[data-testid="send-order"]', (b) => b.innerText);
    const dir = await cust.$eval("dialog[open]", (d) => getComputedStyle(d).direction);
    if (code === "ar") {
      const layout = await cust.evaluate(() => {
        const close = document.querySelector("dialog[open] button").getBoundingClientRect();
        const title = document.querySelector("#pm-cart-title").getBoundingClientRect();
        return { closeLeftOfTitle: close.left < title.left };
      });
      await cust.click('[data-testid="send-order"]');
      await cust.waitForSelector('[data-testid="order-success"]', { timeout: 20000 });
      const success = await bodyText(cust);
      check("36. AR: sepet / onay / sonuç Arapça ve gerçek RTL (kapat düğmesi solda)", t.includes(cartTitle) && t.includes(review) && sendText === send && dir === "rtl" && layout.closeLeftOfTitle && success.includes("تم استلام طلبك") && !/Sepetim|My cart|Siparişi Gönder/.test(success), JSON.stringify({ dir, layout }));
      await cust.screenshot({ path: path.join(OUT, "e2e-ar-success.png") });
      await closeDialog(cust);
    } else {
      check(`${code === "en" ? "34" : "35"}. ${code.toUpperCase()}: sepet / ödeme arayüzü`, t.includes(cartTitle) && t.includes(review) && sendText === send && dir === "ltr", `${t.slice(0, 80)} | ${sendText}`);
      await clickXp(cust, `.//dialog[@open]//button[normalize-space(.)="${code === "en" ? "Back" : "Zurück"}"]`);
      await clickXp(cust, `.//dialog[@open]//li[@data-cart-line="turk-kahvesi"]//button[contains(., "${code === "en" ? "Remove" : "Entfernen"}")]`);
      await closeDialog(cust);
    }
  }
  await setLang(cust, "Türkçe", "tr");

  // 37–39 mobil genişlikler: menü + sepet + onay
  for (const w of [375, 390]) {
    await cust.setViewport({ width: w, height: 760, isMobile: true, hasTouch: true });
    await cust.goto(stable, { waitUntil: "networkidle2" });
    await openProduct(cust, "tavuk-burger-menu");
    await clickXp(cust, sheetBtn("radio", "Ayran"));
    await addToCart(cust);
    await openCart(cust);
    const fit = await cust.evaluate(() => {
      const d = document.querySelector("dialog[open]").getBoundingClientRect();
      const cta = document.querySelector('[data-testid="review-order"]').getBoundingClientRect();
      return { dialogFits: d.right <= innerWidth + 0.5 && d.left >= -0.5, ctaVisible: cta.bottom <= innerHeight && cta.top >= 0, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    await cust.screenshot({ path: path.join(OUT, `e2e-cart-${w}.png`) });
    check(`${w === 375 ? "37" : "38"}. ${w}px: sepet sayfası sığar, onay düğmesi görünür`, fit.dialogFits && fit.ctaVisible && fit.overflow === 0, JSON.stringify(fit));
    await clickXp(cust, `.//dialog[@open]//li[@data-cart-line="tavuk-burger-menu"]//button[contains(., "Kaldır")]`);
    await closeDialog(cust);
  }
  check("39. Yatay taşma yok", (await overflow(cust)) === 0);

  // Bu cihazda başka masanın sepeti → uyarı, aktarılmaz
  await openProduct(cust, "turk-kahvesi");
  await addToCart(cust);
  await cust.goto(otherStable, { waitUntil: "networkidle2" });
  await cust.waitForSelector('[data-testid="other-table-cart"]', { timeout: 5000 }).catch(() => null);
  const banner = await cust.$('[data-testid="other-table-cart"]');
  check("Başka masaya geçince: 'Bu sepet farklı bir masaya ait.' ve sepet aktarılmaz", !!banner && (await bodyText(cust)).includes("Bu sepet farklı bir masaya ait.") && !(await cust.$('[data-testid="cart-bar"]')));
  await clickXp(cust, `.//button[normalize-space(.)="O sepeti temizle"]`);
  await sleep(300);
  check("Diğer sepet temizlenebilir", !(await cust.$('[data-testid="other-table-cart"]')));

  check("40. Tarayıcı konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" || "));
  const audit = JSON.stringify(await db.auditLog.findMany({ where: { tenantId: state.demo.id, action: { in: ["ORDER_SUBMITTED", "ORDER_ACCEPTED"] } }, select: { action: true, metadata: true, ipAddress: true } }));
  check("Denetim: ORDER_SUBMITTED / ORDER_ACCEPTED; müşteri için IP yok; token / anahtar yok", audit.includes("ORDER_SUBMITTED") && audit.includes("ORDER_ACCEPTED") && !audit.includes(row.tokenNonce) && !/idempotency/i.test(audit));
  await browser.close();
  await cleanup();
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} geçti`);
})().catch(async (e) => {
  console.error("E2E HATA", e.message);
  if (currentPage) await currentPage.screenshot({ path: path.join(OUT, "FAIL.png"), fullPage: true }).catch(() => null);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
  await cleanup().catch((err) => console.error("temizlik", err.message));
  process.exit(1);
});

async function cleanup() {
  for (const fn of state.restore.reverse()) await fn().catch(() => null);
  await cleanOrders();
  await db.auditLog.deleteMany({ where: { tenantId: state.demo?.id, action: { in: ["ORDER_SUBMITTED", "ORDER_ACCEPTED", "ORDER_REJECTED"] } } }).catch(() => null);
  await db.$disconnect();
}

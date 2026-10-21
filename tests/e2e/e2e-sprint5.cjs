// MasaNova AI Sprint 5 (kararlı QR girişi + premium public QR menü) uçtan uca doğrulama — production build, headless Chrome.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s5");
fs.mkdirSync(OUT, { recursive: true });
const run = Math.random().toString(36).slice(2, 7);
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const results = [];
const check = (name, ok, detail = "") => results.push({ ok: !!ok, name, detail: String(detail).slice(0, 300) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = { demo: null, originalSlug: null, originalHost: null, masa1: null, slugChanged: false, soldOutSet: false, revoked: false };
let currentPage = null;

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function waitText(page, t, timeout = 20000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { polling: 300, timeout }, t);
}
async function clickByText(page, label, scope = "") {
  const [el] = await page.$$(`xpath/.${scope}//button[normalize-space(.)="${label}"]`);
  if (!el) throw new Error(`Düğme yok: ${label}`);
  await el.click();
}
async function setValue(page, selector, value) {
  await page.$eval(selector, (el) => {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type(selector, value);
}
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !location.pathname.startsWith("/giris") && document.querySelector("main h1"), { polling: 300, timeout: 20000 }).catch(() => null);
}
const scanCount = async () => (await db.tableQrToken.findFirst({ where: { tableId: state.masa1.id, active: true }, select: { scanCount: true } }))?.scanCount ?? null;
async function readStableUrl(page) {
  await page.goto(`${B}/panel/masalar/${state.masa1.id}`, { waitUntil: "networkidle0" });
  return page.$eval("main code", (c) => c.textContent.trim());
}
async function openLanguage(page, label) {
  await page.click('button[aria-haspopup="true"]');
  const [link] = await page.$$(`xpath/.//a[.//span[normalize-space(.)="${label}"]]`);
  await Promise.all([page.waitForFunction((l) => new URL(location.href).searchParams.get("dil") === l, { polling: 200, timeout: 20000 }, { English: "en", Deutsch: "de", "العربية": "ar", Türkçe: "tr" }[label]), link.click()]);
  await sleep(500);
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true, name: true, slug: true } });
  state.originalSlug = state.demo.slug;
  state.originalHost = (await db.tenantDomain.findFirstOrThrow({ where: { tenantId: state.demo.id, type: "SUBDOMAIN" }, select: { hostname: true } })).hostname;
  const merkez = await db.branch.findFirstOrThrow({ where: { tenantId: state.demo.id, slug: "merkez" }, select: { id: true, name: true } });
  state.masa1 = await db.diningTable.findFirstOrThrow({ where: { tenantId: state.demo.id, branchId: merkez.id, name: "Masa 1" }, select: { id: true } });
  if (!(await db.tableQrToken.count({ where: { tableId: state.masa1.id, active: true } }))) throw new Error("Masa 1'in etkin QR'ı yok (seed çalıştırın)");

  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  currentPage = page;
  const consoleErrors = [];
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && !/status of 404/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
  };
  watch(page);
  await page.bringToFront();
  await page.setViewport({ width: 1440, height: 1000 });

  // 1–4. Tema
  await login(page, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("1. İşletme sahibi giriş", page.url().startsWith(`${B}/panel`));
  await page.goto(`${B}/panel/tema`, { waitUntil: "networkidle0" });
  check("2. Tema & Tasarım sayfası (nav'da gerçek bölüm)", (await bodyText(page)).includes("Canlı önizleme") && !(await bodyText(page)).includes("Yakında"));
  await page.click('input[name="style"][value="VISUAL"]');
  const welcome = `E2E hoş geldiniz ${run}`;
  await setValue(page, "#theme-welcome", welcome);
  await page.waitForFunction((w) => document.querySelector('[data-testid="theme-preview"]')?.innerText.includes(w), { polling: 200, timeout: 10000 }, welcome);
  check("Canlı önizleme anında güncellenir (karşılama metni)", true);
  check("Önizleme masa bağlamı uydurmaz ('Önizleme' rozeti)", (await page.$eval('[data-testid="theme-preview"]', (el) => el.innerText)).includes("Önizleme"));
  await clickByText(page, "Görünümü kaydet");
  await waitText(page, "QR menü görünümü kaydedildi.");
  const saved = await db.publicMenuSettings.findUnique({ where: { tenantId: state.demo.id } });
  check("3–4. Görsel düzen + karşılama metni kaydedildi", saved && saved.style === "VISUAL" && saved.welcomeText === welcome, JSON.stringify(saved));

  // 5–6. Masa QR → kararlı adres
  const stableUrl = await readStableUrl(page);
  check("5–6. Masa QR'ı kararlı giriş adresini kodlar (/q/<token>)", /^http:\/\/localhost:3820\/q\/[A-Za-z0-9_-]{22}$/.test(stableUrl), stableUrl);
  const token = stableUrl.split("/q/")[1];

  // 7–9. Müşteri olarak aç
  const before = await scanCount();
  const cust = await (await browser.createBrowserContext()).newPage();
  watch(cust);
  await cust.bringToFront();
  await cust.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const res = await cust.goto(stableUrl, { waitUntil: "networkidle0" });
  check("7. Kararlı adres → kiracının alan adındaki /t/<token> (geçici yönlendirme)", res.status() === 200 && cust.url() === `http://${state.originalHost}:3820/t/${token}`, cust.url());
  const chain = res.request().redirectChain();
  check("Yönlendirme geçici (307) ve önbelleksiz", chain.length === 1 && chain[0].response().status() === 307 && !/max-age=[1-9]/.test(chain[0].response().headers()["cache-control"] ?? ""), `${chain[0]?.response().status()} ${chain[0]?.response().headers()["cache-control"]}`);
  const t1 = await bodyText(cust);
  check("8. Doğru restoran", t1.includes(state.demo.name));
  check("9. Şube ve masa görünür (masayı tekrar seçtirmez)", t1.includes(merkez.name) && (await cust.$eval('[data-testid="table-badge"]', (e) => e.innerText)).includes("Masa 1"));
  check("Karşılama metni public menüde", t1.includes(welcome));
  await sleep(1200);
  check("Bir okutma = bir sayım (/q + /t iki istek → +1)", (await scanCount()) === before + 1, `${before} → ${await scanCount()}`);
  const html = await cust.content();
  check("Sayfa noindex + noarchive + no-referrer", /name="robots" content="[^"]*noindex[^"]*noarchive/.test(html) && html.includes('name="referrer" content="no-referrer"'));
  check("Yükte SKU / iç kimlik yok", ![state.demo.id, merkez.id, state.masa1.id].some((id) => html.includes(id)) && !/"sku"/i.test(html));

  // 10. Kategoriler
  await cust.$$eval("[data-chip]", (els) => els.find((e) => e.textContent.trim() === "Tatlılar").click());
  await cust.waitForFunction(() => document.querySelector('[data-chip][aria-current="true"]')?.textContent.trim() === "Tatlılar", { polling: 200, timeout: 8000 });
  await cust.waitForFunction(() => { const t = document.querySelector('[data-pm-section="tatlilar"]').getBoundingClientRect().top; return t > 0 && t < 260; }, { polling: 100, timeout: 6000 }).catch(() => null);
  const tatliTop = await cust.$eval('[data-pm-section="tatlilar"]', (e) => e.getBoundingClientRect().top);
  check("10. Kategori gezinme: kaydırır, etkin çip işaretli", tatliTop < 260 && tatliTop > 0, tatliTop);

  // 11. Arama
  await cust.type('input[type="search"]', "kahve");
  await waitText(cust, "1 sonuç");
  check("11. Arama ('kahve' → Türk Kahvesi)", (await bodyText(cust)).includes("Türk Kahvesi"));
  await setValue(cust, 'input[type="search"]', "zzqx");
  await waitText(cust, "Sonuç bulunamadı");
  check("Arama: sonuç yok durumu", true);
  await clickByText(cust, "Temizle");

  // 12–16. Ürün detayı — kategori bölümündeki kart, ortalanarak (yapışkan başlığın altına tıklanmasın)
  const burgerCard = '[data-pm-section="burgerler"] [data-product="cheeseburger"]';
  await cust.$eval(burgerCard, (e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(300);
  await cust.click(burgerCard);
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  const sheet = () => cust.$eval("dialog[open]", (d) => d.innerText);
  check("12. Ürün detayı açılır", (await sheet()).includes("Cheeseburger"));
  const [cift] = await cust.$$('xpath/.//dialog[@open]//button[@role="radio"][contains(., "Çift")]');
  await cift.click();
  await cust.waitForFunction(() => document.querySelector('dialog[open] [aria-live="polite"]')?.textContent.includes("520"), { polling: 200, timeout: 5000 });
  check("13. Varyant incelenir (Çift → ₺520,00, sunucu fiyatı)", true);
  const s = await sheet();
  check("14. Ekstra seçenekleri (Pişirme Derecesi / Orta, kural metni)", s.includes("Pişirme Derecesi".toUpperCase()) || s.includes("PİŞİRME DERECESİ") ? s.includes("Orta") && s.includes("Zorunlu") : false, s.slice(0, 300));
  check("15. İçindekiler", s.includes("Dana köfte"));
  check("16. Alerjen bildirimi (tıbbi garanti vermez)", s.includes("Çapraz bulaşma riski") && s.includes("işletme tarafından sağlanmaktadır"));
  // Sprint 6: QR masa bağlamında detay artık sepete ekleme içerir; doğrudan "sipariş ver" yoktur (sepet → onay akışı).
  check("Detay: sepete ekle var, doğrudan sipariş düğmesi yok", s.includes("Sepete ekle") && !/sipariş ver\b/i.test(s));
  await cust.keyboard.press("Escape");
  await sleep(300);

  // 17. Vegan filtresi
  await cust.click('button[aria-haspopup="dialog"]');
  await cust.waitForSelector("dialog[open] #pm-filters-title");
  const [vegan] = await cust.$$('xpath/.//dialog[@open]//button[@aria-pressed][normalize-space(.)="Vegan"]');
  await vegan.click();
  check("Filtre penceresinde beyan uyarısı", (await sheet()).includes("Restoranın belirttiği bilgilere göre"));
  await cust.keyboard.press("Escape");
  await sleep(400);
  const veganText = await bodyText(cust);
  check("17. Vegan filtresi (Türk Kahvesi var, Cheeseburger yok)", veganText.includes("Türk Kahvesi") && !veganText.includes("Cheeseburger"));
  await cust.click('button[aria-haspopup="dialog"]');
  await cust.waitForSelector("dialog[open] #pm-filters-title");
  await clickByText(cust, "Temizle", "//dialog[@open]");
  await cust.keyboard.press("Escape");
  await sleep(300);

  // 18–21. Diller
  const scansBeforeLang = await scanCount();
  await openLanguage(cust, "English");
  check("18. EN: arayüz İngilizce", (await cust.$eval('input[type="search"]', (i) => i.placeholder)) === "Search the menu");
  await openLanguage(cust, "Deutsch");
  check("19. DE: arayüz Almanca, eksik çeviri varsayılana düşer (boş başlık yok)", (await cust.$eval('input[type="search"]', (i) => i.placeholder)) === "Speisekarte durchsuchen" && !(await bodyText(cust)).includes("undefined"));
  await openLanguage(cust, "العربية");
  const rtl = await cust.evaluate(() => {
    const root = document.querySelector("[dir]");
    const badge = document.querySelector('[data-testid="table-badge"]').getBoundingClientRect();
    const search = document.querySelector('input[type="search"]');
    const icon = search.parentElement.querySelector("svg").getBoundingClientRect();
    const input = search.getBoundingClientRect();
    return { dir: root.getAttribute("dir"), lang: root.getAttribute("lang"), direction: getComputedStyle(search).direction, badgeLeft: badge.left < window.innerWidth / 2, iconRight: icon.left > input.left + input.width / 2, placeholder: search.placeholder };
  });
  check("20. AR: Arapça arayüz", rtl.placeholder === "ابحث في القائمة" && rtl.lang === "ar", JSON.stringify(rtl));
  check("21. Gerçek RTL yerleşim (dir=rtl, masa rozeti solda, arama simgesi sağda)", rtl.dir === "rtl" && rtl.direction === "rtl" && rtl.badgeLeft && rtl.iconRight, JSON.stringify(rtl));
  await cust.click('[data-product="cheeseburger"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  check("AR: detay penceresi de RTL", await cust.$eval("dialog[open]", (d) => getComputedStyle(d).direction === "rtl"));
  await cust.keyboard.press("Escape");
  await sleep(1000);
  check("Dil değişimi okutma sayılmaz", (await scanCount()) === scansBeforeLang, `${scansBeforeLang} → ${await scanCount()}`);
  await openLanguage(cust, "Türkçe");

  // 22. Tükendi (panelden işaretle → önbellek geçersiz kılınır → müşteri anında görür)
  await page.bringToFront();
  await page.goto(`${B}/panel/menu/urunler`, { waitUntil: "networkidle0" });
  await page.click('button[aria-label="Izgara Tavuk: tükendi işaretle"]');
  await page.waitForSelector('button[aria-label="Izgara Tavuk: yeniden satışa aç"]', { timeout: 15000 });
  state.soldOutSet = true;
  await cust.bringToFront();
  await cust.reload({ waitUntil: "networkidle0" });
  const card = await cust.$eval('[data-product="izgara-tavuk"]', (b) => {
    const art = b.closest("article");
    return { text: art.innerText, opacity: getComputedStyle(art).opacity };
  });
  check("22. Tükenen ürün görünür, 'Tükendi' rozetli, soluk (önbellek anında yenilendi)", card.text.includes("Tükendi") && Number(card.opacity) < 1, JSON.stringify(card));
  check("23. Görseli olmayan ürün: kırık görsel yok, metin kartı", (await cust.$$eval("article img", (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0).length)) === 0 && (await cust.$$eval("article", (a) => a.length)) > 3);

  // Kiracı izolasyonu: aynı token başka kiracının alan adında
  const foreign = await cust.goto(`http://askida.localhost:3820/t/${token}`, { waitUntil: "networkidle0" });
  check("A'nın token'ı başka kiracının alan adında çalışmaz", foreign.status() !== 200 || !(await bodyText(cust)).includes("Masa 1"), foreign.status());

  // 24–25. Birincil alan adı değişir (Super Admin kısa ad + alt alan taşıma) → aynı basılı QR çalışır
  const admin = await (await browser.createBrowserContext()).newPage();
  watch(admin);
  await admin.bringToFront();
  await admin.setViewport({ width: 1440, height: 900 });
  await login(admin, process.env.SEED_SUPER_ADMIN_EMAIL || "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await admin.goto(`${B}/admin/isletmeler/${state.demo.id}`, { waitUntil: "networkidle0" });
  await clickByText(admin, "Kısa adı değiştir");
  await admin.waitForSelector("dialog[open] #slug-new");
  const newSlug = `demo-e2e-${run}`;
  await setValue(admin, "#slug-new", newSlug);
  await admin.click('dialog[open] input[name="moveSubdomain"]');
  await admin.click('dialog[open] input[name="confirm"]');
  await clickByText(admin, "Kısa adı değiştir", "//dialog[@open]");
  state.slugChanged = true;
  await admin.waitForFunction(() => !document.querySelector("dialog[open]"), { polling: 300, timeout: 20000 });
  const newHost = (await db.tenantDomain.findFirstOrThrow({ where: { tenantId: state.demo.id, type: "SUBDOMAIN" }, select: { hostname: true } })).hostname;
  check("24. İşletmenin alan adı değişti", newHost === `${newSlug}.localhost`, newHost);
  await cust.bringToFront();
  const moved = await cust.goto(stableUrl, { waitUntil: "networkidle0" });
  check("25. AYNI basılı QR çalışmaya devam eder → yeni alan adı", moved.status() === 200 && cust.url() === `http://${newHost}:3820/t/${token}` && (await bodyText(cust)).includes(state.demo.name), cust.url());
  const oldDirect = await cust.goto(`http://${state.originalHost}:3820/t/${token}`, { waitUntil: "networkidle0" });
  check("Eski alan adındaki doğrudan adres artık hizmet vermez (kararlı adres neden gerekli)", oldDirect.status() === 404, oldDirect.status());
  await restoreDomain();

  // 26–27. İptal → nötr geçersiz sayfa
  await page.bringToFront();
  await page.goto(`${B}/panel/masalar/${state.masa1.id}`, { waitUntil: "networkidle0" });
  await clickByText(page, "QR'ı iptal et");
  await page.waitForSelector("dialog[open]");
  await clickByText(page, "QR'ı iptal et", "//dialog[@open]");
  await waitText(page, "QR kodu iptal edildi.");
  state.revoked = true;
  await cust.bringToFront();
  const revoked = await cust.goto(stableUrl, { waitUntil: "networkidle0" });
  const revokedText = await bodyText(cust);
  check("26–27. İptal edilen kararlı QR → nötr geçersiz sayfa (404, ayrıntı yok)", revoked.status() === 404 && revokedText.includes("Bu QR kod artık geçerli değil.") && revokedText.includes("personelinden güncel QR") && !revokedText.includes(state.demo.name), revoked.status());
  const unknown = await cust.goto(`${B}/q/AAAAAAAAAAAAAAAAAAAAAA`, { waitUntil: "networkidle0" });
  const unknownText = await bodyText(cust);
  check("Bilinmeyen token: aynı nötr sayfa (kiracı/masa varlığı sızmaz)", unknown.status() === 404 && unknownText === revokedText);
  const malformed = await cust.goto(`${B}/q/..%2F..%2Fadmin`, { waitUntil: "networkidle0" });
  check("Biçimsiz adres: nötr 404", malformed.status() === 404);

  // Masa 1'e yeni QR (demo verisi yeniden kullanılabilir kalsın)
  await page.bringToFront();
  await clickByText(page, "QR kodu oluştur");
  await waitText(page, "QR kodu oluşturuldu.");
  state.revoked = false;
  const freshUrl = await readStableUrl(page);
  check("Yeni QR yeni kararlı adres üretir", freshUrl !== stableUrl && /\/q\/[A-Za-z0-9_-]{22}$/.test(freshUrl));

  // 28–31. Duyarlı yerleşim
  await cust.bringToFront();
  for (const [w, h, label] of [
    [375, 812, "28. 375 px"],
    [390, 844, "29. 390 px"],
    [768, 1024, "30a. tablet 768 px"],
    [1440, 900, "30b. masaüstü 1440 px"],
  ]) {
    await cust.setViewport({ width: w, height: h, isMobile: w < 768, hasTouch: w < 1024 });
    await cust.goto(freshUrl, { waitUntil: "networkidle0" });
    const o = await overflow(cust);
    const contentWidth = await cust.$eval("main", (m) => m.getBoundingClientRect().width);
    const tapOk = await cust.$$eval("[data-chip], button[aria-haspopup]", (els) => els.every((e) => e.getBoundingClientRect().height >= 36));
    await cust.screenshot({ path: path.join(OUT, `e2e-${w}.png`) });
    check(`${label}: taşma yok, içerik ortalanmış ve sınırlı, dokunma hedefleri yeterli`, o === 0 && contentWidth <= 800 && tapOk, `overflow=${o} main=${contentWidth}`);
  }
  check("31. Yatay taşma yok (tüm genişlikler)", results.filter((r) => /px:/.test(r.name)).every((r) => r.ok));
  await cust.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await cust.goto(freshUrl, { waitUntil: "networkidle0" });
  await cust.click('[data-product="cheeseburger"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  await sleep(500); // giriş animasyonu (260 ms) bitsin
  const sheetBox = await cust.$eval("dialog[open]", (d) => {
    const r = d.getBoundingClientRect();
    return { w: r.width, bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
  check("Mobilde detay alttan açılan tam genişlik sayfa", sheetBox.w === 390 && Math.abs(sheetBox.bottom - sheetBox.vh) <= 1, JSON.stringify(sheetBox));
  await cust.screenshot({ path: path.join(OUT, "e2e-390-sheet.png") });

  // Tükendi işaretini geri al (panelden — önbellek tutarlı kalsın)
  await page.bringToFront();
  await page.goto(`${B}/panel/menu/urunler`, { waitUntil: "networkidle0" });
  await page.click('button[aria-label="Izgara Tavuk: yeniden satışa aç"]');
  await page.waitForSelector('button[aria-label="Izgara Tavuk: tükendi işaretle"]', { timeout: 15000 });
  state.soldOutSet = false;

  // Denetim: ham token yok
  const audits = JSON.stringify(await db.auditLog.findMany({ where: { tenantId: state.demo.id, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }, select: { action: true, metadata: true } }));
  check("Denetim: PUBLIC_MENU_SETTINGS_UPDATED yazıldı, ham token yok", audits.includes("PUBLIC_MENU_SETTINGS_UPDATED") && !audits.includes(token) && !audits.includes(freshUrl.split("/q/")[1]));

  check("32. Tarayıcı konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" || "));
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

async function restoreDomain() {
  if (!state.slugChanged) return;
  await db.tenant.update({ where: { id: state.demo.id }, data: { slug: state.originalSlug } });
  await db.tenantDomain.updateMany({ where: { tenantId: state.demo.id, type: "SUBDOMAIN" }, data: { hostname: state.originalHost } });
  state.slugChanged = false;
}

async function cleanup() {
  await restoreDomain();
  if (state.demo) await db.publicMenuSettings.deleteMany({ where: { tenantId: state.demo.id, welcomeText: { startsWith: "E2E hoş geldiniz" } } });
  if (state.soldOutSet) await db.product.updateMany({ where: { tenantId: state.demo.id, slug: "izgara-tavuk" }, data: { soldOut: false } });
  if (state.revoked && state.masa1) {
    const { issueQrToken } = require("./qr-token-shim.cjs");
    const issued = issueQrToken(process.env.QR_TOKEN_SECRET);
    const t = await db.diningTable.findUnique({ where: { id: state.masa1.id }, select: { branchId: true, tenantId: true } });
    await db.tableQrToken.create({ data: { tenantId: t.tenantId, branchId: t.branchId, tableId: state.masa1.id, tokenHash: issued.tokenHash, tokenNonce: issued.nonce } });
  }
  await db.$disconnect();
}

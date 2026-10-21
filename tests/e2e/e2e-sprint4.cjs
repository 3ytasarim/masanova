// MasaNova AI Sprint 4 (masalar, QR, etiketler) uçtan uca doğrulama — production build, headless Chrome. Parolalar yazdırılmaz.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const { PDFDocument } = require("pdf-lib");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s4");
const DL = path.join(OUT, "downloads");
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });
const MM = 72 / 25.4;
const run = Math.random().toString(36).slice(2, 7);
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const results = [];
const check = (name, ok, detail = "") => results.push({ ok: !!ok, name, detail: String(detail).slice(0, 300) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fixtures = { waiterId: null, foreignTableId: null, foreignAreaId: null, foreignBranchId: null };
let currentPage = null;
let branch2 = null;
let demo = null;

const text = (page) => page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function setValue(page, selector, value) {
  await page.$eval(selector, (el) => {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type(selector, value);
}
async function waitText(page, t, timeout = 20000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { polling: 300, timeout }, t);
}
async function clickByText(page, label, scope = "") {
  const [el] = await page.$$(`xpath/.${scope}//button[normalize-space(.)="${label}"]`);
  if (!el) throw new Error(`Düğme yok: ${label}`);
  await el.click();
}
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !location.pathname.startsWith("/giris") && document.querySelector("main h1"), { polling: 300, timeout: 20000 }).catch(() => null);
}
/** İndirme klasöründe yeni (tamamlanmış) dosyayı bekler. */
async function waitDownload(before, ext, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(DL).filter((f) => !before.has(f) && f.endsWith(ext));
    if (files.length) {
      await sleep(300);
      return path.join(DL, files[0]);
    }
    await sleep(250);
  }
  throw new Error(`İndirme gelmedi (${ext})`);
}
const listing = () => new Set(fs.readdirSync(DL));
async function cleanupBranch2() {
  if (!branch2) return;
  await db.tableQrToken.deleteMany({ where: { branchId: branch2.id } });
  await db.diningTable.deleteMany({ where: { branchId: branch2.id } });
  await db.diningArea.deleteMany({ where: { branchId: branch2.id } });
}

(async () => {
  demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true, name: true } });
  branch2 = await db.branch.findFirstOrThrow({ where: { tenantId: demo.id, slug: { not: "merkez" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  await cleanupBranch2(); // önceki yarım kalmış çalışmalardan kalıntı varsa

  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  currentPage = page;
  await page.bringToFront();
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
  const consoleErrors = [];
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && !/status of 404/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
  };
  watch(page);
  await page.setViewport({ width: 1440, height: 1000 });

  // 1. Giriş
  await login(page, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("1. İşletme sahibi giriş", page.url().startsWith(`${B}/panel`), page.url());

  // 2. Masalar
  await page.goto(`${B}/panel/masalar?sube=${branch2.id}`, { waitUntil: "networkidle0" });
  check("2. Masalar sayfası açılır (Kadıköy şubesi, boş)", (await text(page)).includes("Henüz bölge ya da masa yok"));
  const navHas = await page.evaluate(() => [...document.querySelectorAll("nav a")].some((a) => a.getAttribute("href") === "/panel/masalar"));
  check("Gezinmede 'Masalar & QR' gerçek bölüme gider", navHas);

  // 3. Salon
  await clickByText(page, "Bölge");
  await page.waitForSelector("dialog[open] #area-name");
  await page.type("#area-name", "Salon");
  await clickByText(page, "Bölgeyi oluştur", "//dialog[@open]");
  await waitText(page, "Bölge oluşturuldu.");
  await page.waitForSelector('section[data-area="Salon"]');
  check("3. 'Salon' bölgesi oluşturuldu", true);

  // Doğrulama: boş ad → alan hatası, girdi korunur
  await clickByText(page, "Bölge");
  await page.waitForSelector("dialog[open] #area-name");
  await page.type("#area-slug", "salon");
  await clickByText(page, "Bölgeyi oluştur", "//dialog[@open]");
  await waitText(page, "Lütfen işaretli alanları düzeltin.");
  check("Doğrulama hatasında girdi korunur", (await page.$eval("#area-slug", (el) => el.value)) === "salon");
  await page.keyboard.press("Escape");
  await sleep(300);

  // 4. Toplu 10 masa (QR olmadan — QR'lar sonra tek tek / eksikleri tamamla ile)
  const [salonBulk] = await page.$$('xpath/.//section[@data-area="Salon"]//button[contains(., "Toplu")]');
  await salonBulk.click();
  await page.waitForSelector("dialog[open] #bulk-count");
  check("Toplu: bölge önceden seçili", (await page.$eval("#bulk-area option:checked", (o) => o.textContent)) === "Salon");
  await setValue(page, "#bulk-count", "10");
  await setValue(page, "#bulk-start", "1");
  await waitText(page, "Masa 1, Masa 2 … Masa 10");
  await page.click("#bulk-qr");
  await clickByText(page, "10 masa oluştur", "//dialog[@open]");
  await waitText(page, "10 masa oluşturuldu.");
  await page.waitForFunction(() => document.querySelectorAll('section[data-area="Salon"] li').length === 10, { polling: 300, timeout: 20000 }).catch(() => null);
  const salonTables = await page.$$eval('section[data-area="Salon"] li', (els) => els.length);
  check("4. Toplu 10 masa (tek transaction)", salonTables === 10, salonTables);
  check("Toplu: QR'sız oluşturuldu (rozet 'QR yok')", (await page.$$eval('section[data-area="Salon"] li', (els) => els.filter((e) => e.innerText.includes("QR yok")).length)) === 10);

  // Çakışma: aynı aralık tekrar → hata, hiçbir masa eklenmez
  await salonBulk.click().catch(async () => (await page.$$('xpath/.//section[@data-area="Salon"]//button[contains(., "Toplu")]'))[0].click());
  await page.waitForSelector("dialog[open] #bulk-count");
  await setValue(page, "#bulk-count", "3");
  await setValue(page, "#bulk-start", "9");
  await clickByText(page, "3 masa oluştur", "//dialog[@open]");
  await waitText(page, "Bu şubede zaten var");
  check("Toplu çakışma: açık hata, hiçbir masa eklenmez", (await db.diningTable.count({ where: { branchId: branch2.id } })) === 10);
  await page.keyboard.press("Escape");
  await sleep(300);

  // 5. Teras
  await clickByText(page, "Bölge");
  await page.waitForSelector("dialog[open] #area-name");
  await page.type("#area-name", "Teras");
  await clickByText(page, "Bölgeyi oluştur", "//dialog[@open]");
  await waitText(page, "Bölge oluşturuldu.");
  await page.waitForSelector('section[data-area="Teras"]');
  check("5. 'Teras' bölgesi oluşturuldu", true);

  // 6–7. Masa 3'ü Teras'a taşı (masa sayfasından)
  const masa3 = await db.diningTable.findFirstOrThrow({ where: { branchId: branch2.id, name: "Masa 3" }, select: { id: true } });
  await page.goto(`${B}/panel/masalar/${masa3.id}`, { waitUntil: "networkidle0" });
  check("7. Masa sayfası açılır", (await text(page)).includes("Masa bilgileri"));
  const terasId = await page.$eval("#table-area", (sel) => [...sel.options].find((o) => o.textContent === "Teras").value);
  await page.select("#table-area", terasId);
  await setValue(page, "#table-capacity", "6");
  await clickByText(page, "Kaydet");
  await waitText(page, "Masa kaydedildi.");
  await page.goto(`${B}/panel/masalar?sube=${branch2.id}`, { waitUntil: "networkidle0" });
  const terasNames = await page.$$eval('section[data-area="Teras"] li', (els) => els.map((e) => e.innerText));
  check("6. Bir masa Teras'a taşındı", terasNames.length === 1 && terasNames[0].includes("Masa 3"), terasNames.join("|"));

  // 8. QR oluştur
  await page.goto(`${B}/panel/masalar/${masa3.id}`, { waitUntil: "networkidle0" });
  check("QR yokken adres gösterilmez", !(await text(page)).includes("Kararlı QR adresi"));
  await clickByText(page, "QR kodu oluştur");
  await waitText(page, "QR kodu oluşturuldu.");
  await page.waitForFunction(() => document.body.innerText.includes("Kararlı QR adresi"), { polling: 300, timeout: 20000 });
  const url1 = await page.$eval("main code", (c) => c.textContent.trim());
  // Sprint 5: etiket adresi kiracı alan adından bağımsız kararlı girişi (/q/) kodlar.
  check("8. QR oluşturuldu; adres /q/<22 karakter token>", /^http:\/\/localhost:3820\/q\/[A-Za-z0-9_-]{22}$/.test(url1), url1);
  const token1 = url1.split("/q/")[1];
  check("Adres masa numarası / kimliği içermez", !url1.includes(masa3.id) && !/\/t\/(3|masa)/i.test(url1));
  const qrImgOk = await page.waitForFunction(() => { const img = document.querySelector('img[alt*="QR kodu"]'); return img && img.complete && img.naturalWidth > 0; }, { polling: 300, timeout: 15000 }).then(() => true).catch(() => false);
  check("QR önizlemesi yüklendi (metin alternatifli)", qrImgOk);

  // 9–10. Public adres
  const pub = await browser.newPage();
  watch(pub);
  await pub.bringToFront();
  const pubRes = await pub.goto(url1, { waitUntil: "networkidle0" });
  const pubText = await pub.evaluate(() => document.body.innerText);
  check("9. Public QR adresi açılır (200)", pubRes.status() === 200, pubRes.status());
  check("10. Doğru restoran / şube / bölge / masa", [demo.name, branch2.name, "Teras", "Masa 3", "Menüde ara"].every((t) => pubText.includes(t)), pubText.slice(0, 200));
  const html = await pub.content();
  check("Public HTML iç kimlik içermez (tenant/şube/masa id)", ![demo.id, branch2.id, masa3.id, terasId].some((id) => html.includes(id)));
  check("Public sayfa noindex + no-referrer", html.includes('name="robots" content="noindex') && html.includes('name="referrer" content="no-referrer"'));
  await sleep(800);
  const scans = await db.tableQrToken.findFirst({ where: { tableId: masa3.id, active: true }, select: { scanCount: true } });
  check("Okutma sayacı arttı", scans && scans.scanCount >= 1, scans && scans.scanCount);
  // Aynı token başka kiracının alan adında
  const foreignHost = await pub.goto(`http://askida.localhost:3820/t/${token1}`, { waitUntil: "networkidle0" });
  check("Token başka kiracının alan adında çalışmaz", foreignHost.status() !== 200 || !(await pub.evaluate(() => document.body.innerText)).includes("Masa 3"), foreignHost.status());
  const platformHost = await pub.goto(`http://localhost:3820/t/${token1}`, { waitUntil: "networkidle0" });
  check("Token platform alan adında çalışmaz (404)", platformHost.status() === 404, platformHost.status());
  const guessed = await pub.goto(`http://demo.localhost:3820/t/AAAAAAAAAAAAAAAAAAAAAA`, { waitUntil: "networkidle0" });
  check("Tahmin edilen token → güvenli 404", guessed.status() === 404 && (await pub.evaluate(() => document.body.innerText)).includes("Bu QR kod artık geçerli değil."));

  // 11–12. SVG / PNG indir
  await page.bringToFront();
  let before = listing();
  await page.click('a[href*="/indir/qr"][href*="bicim=svg"]:not([href*="gorunum"])');
  const svgFile = await waitDownload(before, ".svg");
  const svg = fs.readFileSync(svgFile, "utf8");
  check("11. QR SVG indirildi (vektör, <svg>)", svg.includes("<svg") && svg.includes("<path"), path.basename(svgFile));
  before = listing();
  await page.click('a[href*="/indir/qr"][href*="bicim=png"]');
  const pngFile = await waitDownload(before, ".png");
  const png = fs.readFileSync(pngFile);
  check("12. QR PNG indirildi (gerçek PNG, 1200 px)", png.readUInt32BE(0) === 0x89504e47 && png.readUInt32BE(16) === 1200, path.basename(pngFile));

  // 13. Tek etiket PDF
  await page.goto(`${B}/panel/masalar/etiketler?sube=${branch2.id}&masa=${masa3.id}`, { waitUntil: "networkidle0" });
  await clickByText(page, "LüksKrem zemin, ince çerçeve, serif başlık.").catch(async () => {
    const [b] = await page.$$('xpath/.//button[@role="radio"][contains(., "Lüks")]');
    await b.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll("aside img")].some((i) => i.src.startsWith("blob:") && i.complete && i.naturalWidth > 0), { polling: 300, timeout: 20000 });
  check("Canlı önizleme (sunucuda çizilen SVG) gösterildi", true);
  const ratio = await page.$eval("aside [style*='aspect-ratio']", (el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
  check("Önizleme etiket oranını korur (60×60 → 1:1)", Math.abs(ratio - 1) < 0.02, ratio);
  await page.select("#lb-size", "80x50");
  await sleep(900);
  const ratio2 = await page.$eval("aside [style*='aspect-ratio']", (el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
  check("Önizleme oranı boyutla değişir (80×50 → 1,6)", Math.abs(ratio2 - 1.6) < 0.03, ratio2);
  await page.select("#lb-size", "60x60");
  await page.click("#lb-bleed");
  await sleep(900);
  before = listing();
  await page.click('aside a[href*="bicim=pdf"]');
  const pdfFile = await waitDownload(before, ".pdf");
  const pdf = await PDFDocument.load(fs.readFileSync(pdfFile));
  const pg = pdf.getPage(0);
  check("13. Etiket PDF: 60×60 mm + 3 mm taşma = 66 mm sayfa, TrimBox 60 mm", Math.abs(pg.getWidth() / MM - 66) < 0.01 && Math.abs(pg.getTrimBox().width / MM - 60) < 0.01, `${(pg.getWidth() / MM).toFixed(2)}mm`);

  // Marka rengi QR güvenliği: güvensiz renk → otomatik siyah + uyarı (demo kiracının rengi yoksa uyarı yok ama siyah)
  await page.click('input[name="lb-qr"][value="brand"]');
  await sleep(1000);
  check("QR rengi seçeneği çalışır (önizleme hatasız)", !(await text(page)).includes("Önizleme üretilemedi"));

  // 14. A4 toplu sayfa — Salon bölgesi; eksik QR'ları oluştur
  const [sheetBtn] = await page.$$('xpath/.//button[@role="radio"][normalize-space(.)="Toplu A4 sayfa"]');
  await sheetBtn.click();
  await page.click('input[name="lb-scope"][value="bolge"]');
  const salonId = await page.$eval("#lb-area", (sel) => [...sel.options].find((o) => o.textContent === "Salon").value);
  await page.select("#lb-area", salonId);
  await waitText(page, "9 masanın QR kodu yok");
  check("Toplu: QR'sız masalar açıkça gösterilir", true);
  await clickByText(page, "Eksik QR kodlarını oluştur");
  await waitText(page, "9 masaya QR kodu oluşturuldu.");
  await page.waitForFunction(() => !document.body.innerText.includes("masanın QR kodu yok"), { polling: 300, timeout: 20000 });
  check("Eksik QR'lar oluşturuldu", (await db.tableQrToken.count({ where: { branchId: branch2.id, active: true } })) === 10);
  const sheetInfo = await page.$eval('aside[aria-label="Önizleme"]', (a) => a.innerText);
  check("A4 yerleşim özeti (12 / sayfa, 3 × 4)", sheetInfo.includes("12 (3 × 4)"), sheetInfo.slice(0, 200));
  before = listing();
  await clickByText(page, "A4 PDF indir");
  const sheetFile = await waitDownload(before, ".pdf");
  const sheet = await PDFDocument.load(fs.readFileSync(sheetFile));
  check(
    "14. A4 toplu etiket PDF (210×297 mm, 9 etiket → 1 sayfa)",
    sheet.getPageCount() === 1 && Math.abs(sheet.getPage(0).getWidth() / MM - 210) < 0.01 && Math.abs(sheet.getPage(0).getHeight() / MM - 297) < 0.01,
    `${sheet.getPageCount()} sayfa`,
  );
  await waitText(page, "A4 PDF hazır: 9 etiket");
  // Sığmayan özel boyut → açık uyarı, indirme devre dışı
  await page.select("#lb-size", "custom");
  await setValue(page, "#lb-w", "200");
  await setValue(page, "#lb-h", "290");
  await waitText(page, "A4 sayfaya sığmıyor");
  const disabled = await page.$$eval('xpath/.//button[normalize-space(.)="A4 PDF indir"]', (b) => b[0].disabled);
  check("Sığmayan boyut: açık uyarı, sessiz ölçekleme yok (indirme kapalı)", disabled);
  await page.select("#lb-size", "a6");
  await waitText(page, "verimsiz");
  check("A6: verimsiz yerleşim uyarısı", true);

  // 15–17. QR yenile
  await page.goto(`${B}/panel/masalar/${masa3.id}`, { waitUntil: "networkidle0" });
  await clickByText(page, "QR'ı yenile");
  await page.waitForSelector("dialog[open]");
  check("Yenileme onay ister (açıklamalı)", (await page.$eval("dialog[open]", (d) => d.innerText)).includes("ANINDA çalışmaz"));
  await clickByText(page, "QR'ı yenile", "//dialog[@open]");
  await waitText(page, "QR kodu yenilendi.");
  await page.waitForFunction((old) => document.querySelector("main code")?.textContent.trim() !== old, { polling: 300, timeout: 20000 }, url1);
  const url2 = await page.$eval("main code", (c) => c.textContent.trim());
  check("15. QR yenilendi (yeni adres)", url2 !== url1 && /\/q\/[A-Za-z0-9_-]{22}$/.test(url2));
  await pub.bringToFront();
  const oldRes = await pub.goto(url1, { waitUntil: "networkidle0" });
  check("16. Eski adres artık çalışmıyor (404, güvenli mesaj)", oldRes.status() === 404 && (await pub.evaluate(() => document.body.innerText)).includes("Bu QR kod artık geçerli değil."), oldRes.status());
  const newRes = await pub.goto(url2, { waitUntil: "networkidle0" });
  check("17. Yeni adres çalışıyor", newRes.status() === 200 && (await pub.evaluate(() => document.body.innerText)).includes("Masa 3"));
  check("QR geçmişi: eski satır 'İptal edildi'", (await text(page)).includes("İptal edildi"));

  // 18–19. İptal (önceki bildirim kapanana kadar bekle — bildirim düğmenin üstünü örtmesin)
  await page.bringToFront();
  await page.waitForFunction(() => !document.body.innerText.includes("QR kodu yenilendi."), { polling: 300, timeout: 15000 }).catch(() => null);
  await clickByText(page, "QR'ı iptal et");
  await page.waitForSelector("dialog[open]");
  await clickByText(page, "QR'ı iptal et", "//dialog[@open]");
  await waitText(page, "QR kodu iptal edildi.");
  check("18. QR iptal edildi", (await db.tableQrToken.count({ where: { tableId: masa3.id, active: true } })) === 0);
  await pub.bringToFront();
  const revRes = await pub.goto(url2, { waitUntil: "networkidle0" });
  const revText = await pub.evaluate(() => document.body.innerText);
  check("19. İptal edilen adres güvenle reddedilir (404, ayrıntı sızdırmaz)", revRes.status() === 404 && revText.includes("Bu QR kod artık geçerli değil.") && !revText.includes("Masa 3"), revRes.status());
  await pub.close();
  await page.bringToFront();

  // Kiracı izolasyonu (tarayıcıdan): başka kiracının masası
  const askida = await db.tenant.findUniqueOrThrow({ where: { slug: "askida-demo" }, select: { id: true } });
  const foreignBranch = await db.branch.create({ data: { tenantId: askida.id, name: `E2E ${run}`, slug: `e2e-${run}` } });
  fixtures.foreignBranchId = foreignBranch.id;
  const foreignArea = await db.diningArea.create({ data: { tenantId: askida.id, branchId: foreignBranch.id, name: `E2E ${run}`, slug: `e2e-${run}` } });
  fixtures.foreignAreaId = foreignArea.id;
  const foreignTable = await db.diningTable.create({ data: { tenantId: askida.id, branchId: foreignBranch.id, diningAreaId: foreignArea.id, name: `E2E ${run}` } });
  fixtures.foreignTableId = foreignTable.id;
  const f1 = await page.goto(`${B}/panel/masalar/${foreignTable.id}`, { waitUntil: "networkidle0" });
  check("Başka kiracının masa sayfası → 404", f1.status() === 404, f1.status());
  const f2 = await page.evaluate(async (id) => (await fetch(`/panel/masalar/indir/qr?masa=${id}&bicim=svg`)).status, foreignTable.id);
  const f3 = await page.evaluate(async (id) => (await fetch(`/panel/masalar/indir/etiket?masa=${id}&bicim=pdf`)).status, foreignTable.id);
  check("Başka kiracının QR / etiket indirmesi → 404", f2 === 404 && f3 === 404, `${f2}/${f3}`);
  const f4 = await page.evaluate(async ({ branch, id }) => {
    const fd = new FormData();
    fd.append("kapsam", "secili");
    fd.append("sube", branch);
    fd.append("masalar", id);
    return (await fetch("/panel/masalar/indir/sayfa", { method: "POST", body: fd })).status;
  }, { branch: foreignBranch.id, id: foreignTable.id });
  check("Başka kiracının masalarını toplu basma → reddedilir", f4 === 404, f4);
  const csrf = await page.evaluate(async (branch) => (await fetch("/panel/masalar/indir/sayfa", { method: "POST", body: new URLSearchParams({ kapsam: "sube", sube: branch }), headers: {} })).status, branch2.id);
  check("A4 uç noktası aynı origin'den çalışır (Origin kontrolü)", csrf === 200 || csrf === 409, csrf);

  // Super Admin: salt okunur sayılar
  const admin = await browser.createBrowserContext();
  const ap = await admin.newPage();
  watch(ap);
  await ap.bringToFront();
  await ap.setViewport({ width: 1440, height: 900 });
  await login(ap, process.env.SEED_SUPER_ADMIN_EMAIL || "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await ap.goto(`${B}/admin/isletmeler/${demo.id}`, { waitUntil: "networkidle0" });
  const adminText = await text(ap);
  const counts = await db.$transaction([db.diningArea.count({ where: { tenantId: demo.id } }), db.diningTable.count({ where: { tenantId: demo.id } })]);
  check("Super Admin: bölge / masa / QR sayıları (salt okunur)", adminText.includes("Bölge / masa") && adminText.includes(`${counts[0]} / ${counts[1]}`) && adminText.includes("QR kodu (etkin / toplam)"), adminText.slice(0, 120));
  await admin.close();
  await page.bringToFront();

  // Garson: salt okunur
  const waiterEmail = `waiter-${run}@e2e.masanovai.test`;
  const waiterPassword = `Waiter-${run}-${Math.random().toString(36).slice(2)}`;
  const waiter = await db.user.create({ data: { tenantId: demo.id, email: waiterEmail, firstName: "E2E", lastName: "Garson", role: "WAITER", passwordHash: await hash(waiterPassword) }, select: { id: true } });
  fixtures.waiterId = waiter.id;
  const wctx = await browser.createBrowserContext();
  const wp = await wctx.newPage();
  watch(wp);
  await wp.bringToFront();
  await wp.setViewport({ width: 1440, height: 900 });
  await login(wp, waiterEmail, waiterPassword);
  await wp.goto(`${B}/panel/masalar?sube=${branch2.id}`, { waitUntil: "networkidle0" });
  const wText = await text(wp);
  check("Garson: masa listesi salt okunur", wText.includes("Salt okunur görünüm") && wText.includes("Masa 1") && !(await wp.$('xpath/.//button[normalize-space(.)="Bölge"]')));
  await wp.goto(`${B}/panel/masalar/${masa3.id}`, { waitUntil: "networkidle0" });
  check("Garson: QR adresi / indirme / yenileme görünmez", !(await text(wp)).includes("Public adres") && !(await wp.$('a[href*="/indir/"]')) && !(await text(wp)).includes("QR'ı yenile"));
  const wl = await wp.goto(`${B}/panel/masalar/etiketler`, { waitUntil: "networkidle0" });
  const wd = await wp.evaluate(async (id) => (await fetch(`/panel/masalar/indir/qr?masa=${id}&bicim=svg`)).status, masa3.id);
  check("Garson: etiket sayfası ve QR indirme → 404", wl.status() === 404 && wd === 404, `${wl.status()}/${wd}`);
  await wctx.close();
  await page.bringToFront();

  // 20. Mobil 375 / 390
  for (const width of [375, 390]) {
    await page.setViewport({ width, height: 812, isMobile: true, hasTouch: true });
    const pages = [`/panel/masalar?sube=${branch2.id}`, `/panel/masalar/${masa3.id}`, `/panel/masalar/etiketler?sube=${branch2.id}`];
    const over = [];
    for (const p of pages) {
      await page.goto(`${B}${p}`, { waitUntil: "networkidle0" });
      await sleep(400);
      const o = await overflow(page);
      if (o > 0) over.push(`${p}:${o}`);
      await page.screenshot({ path: path.join(OUT, `m${width}-${p.split("/")[3]?.split("?")[0] || "masalar"}.png`), fullPage: true });
    }
    // Mobilde toplu masa penceresi kullanılabilir
    await page.goto(`${B}/panel/masalar?sube=${branch2.id}`, { waitUntil: "networkidle0" });
    await clickByText(page, "Toplu");
    await page.waitForSelector("dialog[open] #bulk-count");
    const dialogFits = await page.$eval("dialog[open]", (d) => d.getBoundingClientRect().right <= window.innerWidth + 0.5);
    await page.keyboard.press("Escape");
    check(`20. Mobil ${width}px: yatay taşma yok, pencereler sığar`, over.length === 0 && dialogFits, over.join(", "));
  }
  // Public sayfa mobil
  const pubM = await browser.newPage();
  watch(pubM);
  await pubM.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  const another = await db.diningTable.findFirstOrThrow({ where: { branchId: branch2.id, name: "Masa 1" }, select: { id: true } });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${B}/panel/masalar/${another.id}`, { waitUntil: "networkidle0" });
  const url3 = await page.$eval("main code", (c) => c.textContent.trim());
  await pubM.bringToFront();
  await pubM.goto(url3, { waitUntil: "networkidle0" });
  check("Public sayfa mobil 375: taşma yok", (await overflow(pubM)) === 0);
  await pubM.screenshot({ path: path.join(OUT, "m375-public.png"), fullPage: true });
  await pubM.close();

  // Denetim kayıtları
  const audits = await db.auditLog.findMany({ where: { tenantId: demo.id, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } }, select: { action: true, metadata: true } });
  const actions = new Set(audits.map((a) => a.action));
  const expected = ["DINING_AREA_CREATED", "TABLE_BULK_CREATED", "TABLE_UPDATED", "TABLE_QR_CREATED", "TABLE_QR_REGENERATED", "TABLE_QR_REVOKED", "LABEL_PDF_GENERATED"];
  check("Denetim kayıtları", expected.every((a) => actions.has(a)), expected.filter((a) => !actions.has(a)).join(","));
  const auditJson = JSON.stringify(audits);
  check("Denetim kayıtlarında token yok", ![url1, url2, url3].some((u) => auditJson.includes(u.split("/q/")[1])));

  // 21. Konsol
  check("21. Tarayıcı konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" || "));
  await browser.close();

  await cleanup();
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} geçti`);
})().catch(async (e) => {
  console.error("E2E HATA", e.message);
  if (currentPage) {
    await currentPage.screenshot({ path: path.join(OUT, "FAIL.png"), fullPage: true }).catch(() => null);
    console.log("URL:", currentPage.url(), "TEXT:", (await currentPage.evaluate(() => document.body.innerText).catch(() => "")).slice(0, 900));
  }
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
  await cleanup().catch(() => null);
  process.exit(1);
});

async function cleanup() {
  await cleanupBranch2();
  if (fixtures.foreignTableId) await db.diningTable.delete({ where: { id: fixtures.foreignTableId } }).catch(() => null);
  if (fixtures.foreignAreaId) await db.diningArea.delete({ where: { id: fixtures.foreignAreaId } }).catch(() => null);
  if (fixtures.foreignBranchId) await db.branch.delete({ where: { id: fixtures.foreignBranchId } }).catch(() => null);
  if (fixtures.waiterId) {
    await db.session.deleteMany({ where: { userId: fixtures.waiterId } });
    await db.user.delete({ where: { id: fixtures.waiterId } }).catch(() => null);
  }
  await db.$disconnect();
}

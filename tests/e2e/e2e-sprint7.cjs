// MasaNova AI Sprint 7 (gerçek zamanlı siparişler, KDS, istasyon yönlendirme, canlı müşteri durumu) — production build, headless Chrome.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { hash } = require("@node-rs/argon2");
const { PrismaClient } = require("@prisma/client");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s7");
fs.mkdirSync(OUT, { recursive: true });
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const results = [];
const LOG = path.join(OUT, "results.txt");
fs.writeFileSync(LOG, "");
const check = (name, ok, detail = "") => {
  const r = { ok: !!ok, name, detail: String(detail).slice(0, 300) };
  results.push(r);
  fs.appendFileSync(LOG, `${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}
`);
};
let browser = null;
setTimeout(() => { check("WATCHDOG: 8 dk aşıldı", false); finish(); }, 8 * 60_000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const derive = (nonce) => crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
const run = crypto.randomBytes(3).toString("hex");
const state = { demo: null, users: [], restore: [] };

const bodyText = (p) => p.evaluate(() => document.body.innerText);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function waitFor(p, fn, arg, timeout = 15000) {
  try {
    await p.waitForFunction(fn, { polling: 200, timeout }, arg);
    return true;
  } catch {
    return false;
  }
}
const waitText = (p, t, timeout) => waitFor(p, (t) => document.body.innerText.includes(t), t, timeout);
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
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
}
async function makeUser(role, label) {
  const email = `${label}-${run}@e2e.masanovai.test`;
  const password = `${label}-${run}-${crypto.randomBytes(9).toString("base64url")}`;
  const user = await db.user.create({ data: { tenantId: state.demo.id, email, firstName: "E2E", lastName: label, role, passwordHash: await hash(password) }, select: { id: true } });
  state.users.push(user.id);
  return { email, password };
}
async function cleanOrders() {
  if (!state.demo) return;
  await db.order.deleteMany({ where: { tenantId: state.demo.id } });
  await db.orderSequence.deleteMany({ where: { tenantId: state.demo.id } });
}
/** Müşteri: Cheeseburger (Tek + Orta) + Ayran sepete → gönder → sipariş sayfası. */
async function placeOrder(cust, stable) {
  await cust.goto(stable, { waitUntil: "networkidle2" });
  await openProduct(cust, "cheeseburger");
  await clickXp(cust, sheetBtn("radio", "Orta"));
  await addToCart(cust);
  await openProduct(cust, "ayran");
  await addToCart(cust);
  await cust.click('[data-testid="cart-bar"]');
  await cust.waitForSelector("dialog[open] #pm-cart-title");
  await waitFor(cust, () => !document.body.innerText.match(/kontrol ediliyor/), null, 15000);
  await sleep(300);
  await cust.click('[data-testid="review-order"]');
  await cust.waitForSelector('[data-testid="send-order"]');
  await cust.click('[data-testid="send-order"]');
  await cust.waitForSelector('[data-testid="order-success"]', { timeout: 20000 });
  const number = (await cust.$eval('[data-testid="order-number"]', (e) => e.textContent)).trim();
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2" }), clickXp(cust, `.//a[contains(., "Siparişi Gör")]`)]);
  return number;
}
const custStatus = (p) => p.$eval('[data-testid="public-order-status"]', (e) => e.dataset.status).catch(() => null);
const waitCustStatus = (p, s, timeout = 15000) => waitFor(p, (s) => document.querySelector('[data-testid="public-order-status"]')?.dataset.status === s, s, timeout);
const laneCount = (p, lane) => p.$$eval(`[data-testid="kds-lane-${lane}"] [data-testid="kds-ticket"]`, (els) => els.length);
const waitLane = (p, lane, n, timeout = 15000) => waitFor(p, ([lane, n]) => document.querySelectorAll(`[data-testid="kds-lane-${lane}"] [data-testid="kds-ticket"]`).length === n, [lane, n], timeout);
async function selectStation(p, label) {
  const value = await p.$$eval("#kds-station option", (os, label) => os.find((o) => o.textContent.trim().startsWith(label))?.value, label);
  await p.select("#kds-station", value);
  await sleep(300);
}
async function advanceFirst(p, lane) {
  await p.click(`[data-testid="kds-lane-${lane}"] [data-testid="kds-ticket"] button`);
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  await cleanOrders();
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: state.demo.id, name: "Masa 12" }, select: { id: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const stable = `${B}/q/${derive(row.tokenNonce)}`;
  const kitchenCreds = await makeUser("KITCHEN", "mutfak");
  const waiterCreds = await makeUser("WAITER", "garson");
  const merkez = await db.branch.findFirstOrThrow({ where: { tenantId: state.demo.id, slug: "merkez" }, select: { id: true, defaultStationId: true } });

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const consoleErrors = [];
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && !/status of 40[34]|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
  };
  const newPage = async (viewport) => {
    const p = await (await browser.createBrowserContext()).newPage();
    watch(p);
    await p.setViewport(viewport);
    return p;
  };

  // ── Sahip: istasyonlar ────────────────────────────────────────────────
  const owner = await newPage({ width: 1440, height: 1000 });
  await owner.bringToFront();
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await owner.goto(`${B}/panel/mutfak/istasyonlar`, { waitUntil: "networkidle2" });
  let t = await bodyText(owner);
  check("1. İstasyon ayarları: Merkez → Mutfak (Varsayılan) + Bar", t.includes("Varsayılan istasyon: Mutfak") && (await owner.$$('[data-testid="station-row"]')).length >= 4);
  await owner.screenshot({ path: path.join(OUT, "stations-1440.png"), fullPage: true });
  const ayran = await db.product.findFirstOrThrow({ where: { tenantId: state.demo.id, slug: "ayran" }, select: { id: true } });
  await owner.goto(`${B}/panel/menu/urunler/${ayran.id}?sekme=istasyonlar`, { waitUntil: "networkidle2" });
  const barChecked = await owner.$$eval('[data-testid="product-stations-branch"]', (forms) => forms[0] && [...forms[0].querySelectorAll("label")].find((l) => l.innerText.includes("Bar"))?.querySelector("input").checked);
  check("2. Ürün editörü › İstasyonlar: Ayran → Bar", barChecked === true);

  // ── Mutfak personeli: KDS ────────────────────────────────────────────
  const kds = await newPage({ width: 1440, height: 1000 });
  await kds.bringToFront();
  await login(kds, kitchenCreds.email, kitchenCreds.password);
  await kds.goto(`${B}/panel/mutfak`, { waitUntil: "domcontentloaded" });
  await kds.waitForSelector('[data-testid="kds-board"]');
  check("3. Mutfak rolü KDS'i açar (3 sütun: Yeni / Hazırlanıyor / Hazır)", (await kds.$$('[data-testid^="kds-lane-"]')).length === 3);
  check("4. Canlı bağlantı göstergesi 'Canlı'", await waitFor(kds, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live"));
  let res = await kds.goto(`${B}/panel/masalar`, { waitUntil: "networkidle2" });
  check("5. Mutfak rolü masa yönetimine erişemez (404)", res.status() === 404, res.status());
  await kds.goto(`${B}/panel/mutfak/istasyonlar`, { waitUntil: "networkidle2" });
  check("6. Mutfak rolü istasyon ayarlarını salt okunur görür", (await bodyText(kds)).includes("Salt okunur görünüm") && !(await bodyText(kds)).includes("İstasyon ekle"));
  await kds.goto(`${B}/panel/mutfak`, { waitUntil: "domcontentloaded" });
  await kds.waitForSelector('[data-testid="kds-board"]');
  await waitFor(kds, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live");

  // ── Sahip: sipariş listesi canlı ─────────────────────────────────────
  await owner.goto(`${B}/panel/siparisler`, { waitUntil: "domcontentloaded" });
  check("7. Sipariş listesi canlı akışa bağlı", await waitFor(owner, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live"));

  // ── Müşteri sipariş verir ────────────────────────────────────────────
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await cust.bringToFront();
  const number = await placeOrder(cust, stable);
  check("8. Müşteri siparişi gönderdi (#1001) → 'Restoran onayı bekleniyor'", number === "#1001" && (await custStatus(cust)) === "SUBMITTED", number);
  check("9. Panel listesi yenilemeden güncellendi (#1001 göründü)", await waitFor(owner, () => !!document.querySelector('tr[data-order-number="1001"]')));

  // ── Sahip kabul eder → fişler ────────────────────────────────────────
  await owner.bringToFront();
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click('tr[data-order-number="1001"] a')]);
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  await waitText(owner, "2 istasyon fişi oluşturuldu");
  await waitFor(owner, () => document.querySelectorAll('[data-testid="panel-order-ticket"]').length === 2);
  const ticketCards = await owner.$$eval('[data-testid="panel-order-ticket"]', (els) => els.map((e) => e.innerText));
  check("10. Kabul → 2 istasyon fişi (Mutfak: Cheeseburger, Bar: Ayran)", ticketCards.some((c) => c.includes("Mutfak") && c.includes("Cheeseburger")) && ticketCards.some((c) => c.includes("Bar") && c.includes("Ayran")), ticketCards.join(" | "));
  check("11. Müşteri sayfası yenilemeden 'kabul etti' oldu", await waitCustStatus(cust, "ACCEPTED"));
  check("12. KDS yenilemeden 2 yeni fiş aldı", await waitLane(kds, "PENDING", 2));

  // ── KDS: istasyon seçimi, kart içeriği ───────────────────────────────
  await kds.bringToFront();
  await selectStation(kds, "Mutfak");
  check("13. İstasyon seçimi: Mutfak → yalnızca 1 fiş", (await laneCount(kds, "PENDING")) === 1);
  await kds.reload({ waitUntil: "domcontentloaded" });
  await kds.waitForSelector('[data-testid="kds-board"]');
  await sleep(500);
  check("14. Seçili istasyon bu cihazda hatırlandı (yenileme sonrası Mutfak)", (await kds.$eval("#kds-station option:checked", (o) => o.textContent)).startsWith("Mutfak") && (await laneCount(kds, "PENDING")) === 1);
  const card = await kds.$eval('[data-testid="kds-lane-PENDING"] [data-testid="kds-ticket"]', (e) => e.innerText);
  check("15. Fiş kartı: #1001, Masa 12, 1× Cheeseburger — Tek, + Orta, süre", card.includes("#1001") && card.includes("Masa 12") && card.includes("Cheeseburger") && card.includes("Tek") && card.includes("+ Orta") && /\d\d:\d\d/.test(card), card);
  check("16. KDS'te fiyat gösterilmez", !card.includes("₺"));
  await kds.screenshot({ path: path.join(OUT, "kds-1440.png"), fullPage: true });

  // ── Ses / tam ekran / ekranı açık tut ────────────────────────────────
  await clickXp(kds, `.//button[contains(., "Ses Bildirimlerini Aç")]`);
  check("17. 'Ses Bildirimlerini Aç' açılır (aria-pressed)", await waitFor(kds, () => [...document.querySelectorAll("button[aria-pressed]")].some((b) => b.innerText.includes("Ses açık") && b.getAttribute("aria-pressed") === "true")));
  check("18. 'Tam Ekran' ve 'Ekranı Açık Tut' düğmeleri", (await bodyText(kds)).includes("Tam Ekran") && (await bodyText(kds)).includes("Ekranı Açık Tut"));

  // ── Hazırlık ────────────────────────────────────────────────────────
  await advanceFirst(kds, "PENDING");
  check("19. 'Hazırlamaya Başla' → fiş Hazırlanıyor sütununda", await waitLane(kds, "PREPARING", 1));
  check("20. Müşteri: 'Siparişiniz hazırlanıyor' (yenilemesiz)", (await waitCustStatus(cust, "PREPARING")) && (await bodyText(cust)).includes("Siparişiniz hazırlanıyor"));
  check("21. Sahip detayında durum Hazırlanıyor + 'Sistem (mutfak fişleri)'", await waitFor(owner, () => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("Hazırlanıyor") && document.body.innerText.includes("Sistem (mutfak fişleri)")));
  await advanceFirst(kds, "PREPARING");
  await waitLane(kds, "READY", 1);
  await sleep(1500);
  check("22. Tek istasyon hazır → sipariş hâlâ hazırlanıyor", (await custStatus(cust)) === "PREPARING");
  await selectStation(kds, "Bar");
  await waitLane(kds, "PENDING", 1);
  await advanceFirst(kds, "PENDING");
  await waitLane(kds, "PREPARING", 1);
  await advanceFirst(kds, "PREPARING");
  check("23. Bar fişi de hazır → KDS Hazır sütununda", await waitLane(kds, "READY", 1));
  check("24. Müşteri: 'Siparişiniz hazır' (yenilemesiz)", (await waitCustStatus(cust, "READY")) && (await bodyText(cust)).includes("Siparişiniz hazır"));
  await cust.screenshot({ path: path.join(OUT, "customer-ready-390.png"), fullPage: true });
  const dbOrder = await db.order.findFirstOrThrow({ where: { tenantId: state.demo.id, orderNumber: 1001 }, include: { history: true } });
  check("25. Veritabanı: READY tek kez, sistem aktörüyle", dbOrder.status === "READY" && dbOrder.history.filter((h) => h.toStatus === "READY" && h.actorType === "SYSTEM").length === 1);

  // ── Garson servis eder ───────────────────────────────────────────────
  const waiter = await newPage({ width: 1280, height: 900 });
  await waiter.bringToFront();
  await login(waiter, waiterCreds.email, waiterCreds.password);
  await waiter.goto(`${B}/panel/siparisler/${dbOrder.id}`, { waitUntil: "networkidle2" });
  t = await bodyText(waiter);
  check("26. Garson: 'Servis edildi' var, 'İptal et' yok", t.includes("Servis edildi") && !t.includes("İptal et"));
  await clickXp(waiter, `.//button[normalize-space(.)="Servis edildi"]`);
  await waiter.waitForSelector("dialog[open]");
  await clickXp(waiter, `.//dialog[@open]//button[normalize-space(.)="Servis edildi"]`);
  check("27. Servis edildi (panel)", await waitFor(waiter, () => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("Servis edildi")));
  check("28. Müşteri: 'Servis edildi' (yenilemesiz)", await waitCustStatus(cust, "SERVED"));
  check("29. Servis sonrası fiş KDS'ten kalktı", await waitLane(kds, "READY", 0));
  res = await waiter.goto(`${B}/panel/mutfak`, { waitUntil: "networkidle2" });
  check("30. Garson KDS'e erişemez (404, içerik yok)", res.status() === 404 && !(await waiter.$("[data-testid=kds-board]")), res.status());

  // ── İptal ───────────────────────────────────────────────────────────
  await cust.bringToFront();
  const second = await placeOrder(cust, stable);
  const o2 = await db.order.findFirstOrThrow({ where: { tenantId: state.demo.id, orderNumber: Number(second.slice(1)) }, select: { id: true } });
  await owner.bringToFront();
  await owner.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  await waitText(owner, "istasyon fişi oluşturuldu");
  await owner.waitForSelector(`xpath/.//button[normalize-space(.)="İptal et"]`, { timeout: 15000 });
  await clickXp(owner, `.//button[normalize-space(.)="İptal et"]`);
  await owner.waitForSelector("dialog[open] #cancel-reason");
  await owner.type("dialog[open] #cancel-reason", "Müşteri vazgeçti");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="İptal et"]`);
  check("31. Sahip iptal etti (neden zorunlu) → fişler iptal", await waitFor(owner, () => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("İptal edildi") && [...document.querySelectorAll('[data-testid="panel-order-ticket"]')].every((e) => e.dataset.ticketStatus === "CANCELLED")));
  check("32. Müşteri: 'Sipariş iptal edildi' (yenilemesiz); iç not gösterilmez", (await waitCustStatus(cust, "CANCELLED")) && !(await bodyText(cust)).includes("Müşteri vazgeçti"));

  // ── Yönlendirilemeyen ürün: varsayılan pasif → kabul engellenir ───────
  state.restore.push(() => db.branch.update({ where: { id: merkez.id }, data: { defaultStationId: merkez.defaultStationId, defaultStationBranchId: merkez.id } }));
  state.restore.push(() => db.preparationStation.update({ where: { id: merkez.defaultStationId }, data: { active: true } }));
  await owner.goto(`${B}/panel/mutfak/istasyonlar`, { waitUntil: "networkidle2" });
  await owner.click('button[aria-label="Mutfak: pasifleştir"]');
  await waitFor(owner, () => !!document.querySelector('[data-testid="no-default-station"]'));
  await cust.bringToFront();
  const third = await placeOrder(cust, stable);
  const o3 = await db.order.findFirstOrThrow({ where: { tenantId: state.demo.id, orderNumber: Number(third.slice(1)) }, select: { id: true } });
  await owner.bringToFront();
  await owner.goto(`${B}/panel/siparisler/${o3.id}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  const blocked = await waitText(owner, "ürün için hazırlama istasyonu tanımlanmamış");
  check("33. Varsayılan istasyon yokken atamasız ürün → kabul engellendi, açık uyarı", blocked && (await db.order.findUniqueOrThrow({ where: { id: o3.id } })).status === "SUBMITTED");
  await owner.goto(`${B}/panel/mutfak/istasyonlar`, { waitUntil: "networkidle2" });
  await owner.click('button[aria-label="Mutfak: aktifleştir"]');
  await owner.waitForSelector('button[aria-label="Mutfak: varsayılan yap"]', { timeout: 15000 });
  await owner.click('button[aria-label="Mutfak: varsayılan yap"]');
  check("34. İstasyon yeniden aktif + varsayılan yapıldı", await waitFor(owner, () => document.body.innerText.includes("Varsayılan istasyon: Mutfak")));

  // ── Aciliyet, bağlantı kopması, güvenlik ─────────────────────────────
  await owner.goto(`${B}/panel/siparisler/${o3.id}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  await waitText(owner, "istasyon fişi oluşturuldu");
  await db.orderTicket.updateMany({ where: { orderId: o3.id }, data: { createdAt: new Date(Date.now() - 21 * 60_000) } });
  await kds.bringToFront();
  await selectStation(kds, "Tüm istasyonlar");
  await kds.reload({ waitUntil: "domcontentloaded" });
  await kds.waitForSelector('[data-testid="kds-ticket"]');
  const urg = await kds.$$eval('[data-testid="kds-ticket"]', (els) => els.map((e) => [e.dataset.urgency, e.innerText.toLocaleLowerCase("tr-TR").includes("gecikti")]));
  check("35. 20 dk'yı aşan fiş kritik ('Gecikti', kırmızı çerçeve)", urg.length === 2 && urg.every(([u, g]) => u === "critical" && g), JSON.stringify(urg));
  await kds.screenshot({ path: path.join(OUT, "kds-urgent-1440.png"), fullPage: true });

  // Gerçek kesinti: sunucu süreci durdurulur → istemci yeniden bağlanmayı dener → sunucu yeniden başlar.
  const { execSync, spawn } = require("child_process");
  const pid = execSync("netstat -ano").toString().split(/\r?\n/).find((l) => /:3820\s.*LISTENING/.test(l))?.trim().split(/\s+/).pop();
  execSync(`taskkill /PID ${pid} /T /F`);
  check("36. Bağlantı koptu → 'Bağlantı yeniden kuruluyor'", await waitFor(kds, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "reconnecting" && document.body.innerText.includes("Bağlantı yeniden kuruluyor"), null, 20000));
  await db.orderTicket.updateMany({ where: { orderId: o3.id, stationName: "Bar" }, data: { status: "PREPARING", startedAt: new Date() } }); // kesinti sırasında değişiklik
  const logFd = fs.openSync(path.join(__dirname, "..", "server7.log"), "a");
  spawn("cmd", ["/c", "npx next start -p 3820"], { cwd: path.resolve(__dirname, "../.."), detached: true, stdio: ["ignore", logFd, logFd] }).unref();
  check("37. Yeniden bağlandı → 'Canlı' ve kaçırılan değişiklik yeniden çekildi", (await waitFor(kds, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live", null, 40000)) && (await waitLane(kds, "PREPARING", 1, 15000)));

  const anon = await newPage({ width: 800, height: 600 });
  res = await anon.goto(`${B}/panel/olaylar`);
  check("38. Oturumsuz panel akışı reddedilir (403)", res.status() === 403, res.status());
  const custUrl = cust.url();
  const sse = await cust.evaluate(async (u) => {
    const ctrl = new AbortController();
    const r = await fetch(`${u}/akis`, { signal: ctrl.signal });
    const h = { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), accel: r.headers.get("x-accel-buffering") };
    ctrl.abort();
    const bad = await fetch(u.replace(/siparis\/[^/]+$/, "siparis/AAAAAAAAAAAAAAAAAAAAAA") + "/akis");
    return { ...h, bad: bad.status };
  }, custUrl);
  check("39. Müşteri akışı: 200 text/event-stream, no-cache, X-Accel-Buffering: no; başka sipariş 404", sse.status === 200 && sse.type.includes("text/event-stream") && sse.cache.includes("no-cache") && sse.accel === "no" && sse.bad === 404, JSON.stringify(sse));

  // ── Duyarlılık / dil ────────────────────────────────────────────────
  const kdsMobile = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(kdsMobile, kitchenCreds.email, kitchenCreds.password);
  await kdsMobile.goto(`${B}/panel/mutfak`, { waitUntil: "domcontentloaded" });
  await kdsMobile.waitForSelector('[data-testid="kds-board"]');
  await sleep(600);
  check("40. KDS 390px: yatay taşma yok", (await overflow(kdsMobile)) <= 0, await overflow(kdsMobile));
  await kdsMobile.screenshot({ path: path.join(OUT, "kds-390.png"), fullPage: true });
  await cust.goto(`${custUrl}?dil=ar`, { waitUntil: "networkidle2" });
  t = await bodyText(cust);
  check("41. Arapça sipariş sayfası RTL + çoğul uyumu ('منتجان')", (await cust.$eval("[dir]", (e) => e.getAttribute("dir"))) === "rtl" && (await cust.content()).includes("منتجان"), t.slice(0, 120));
  check("42. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.join(" | "));

})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack || e.message))
  .finally(() => finish());

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  {
    await browser?.close().catch(() => null);
    for (const fn of state.restore.reverse()) await fn().catch((e) => console.error("restore", e.message));
    await cleanOrders().catch(() => null);
    if (state.users.length) {
      await db.session.deleteMany({ where: { userId: { in: state.users } } }).catch(() => null);
      await db.user.deleteMany({ where: { id: { in: state.users } } }).catch(() => null);
    }
    await db.$disconnect();
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} geçti`);
    fs.appendFileSync(LOG, `\n${results.filter((r) => r.ok).length}/${results.length} geçti\n`);
    process.exit(0);
  }
}

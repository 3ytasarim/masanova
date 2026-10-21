// MasaNovaAI Sprint 19 — Online ödeme (TEST sağlayıcısı, gerçek para YOK), kısmi / eşit / ürün bazlı bölme, webhook,
// manuel kasa ödemesi, iade, yetkiler (production build, PAYMENT_PROVIDER=mock). Demo kiracıya geçici sipariş / ödeme
// yazılır; ödeme ayarı test boyunca açılır. Sonunda her şey silinir ve ayar eski haline döner.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s19");
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, "results.txt");
fs.writeFileSync(LOG, "");
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const results = [];
const check = (name, ok, detail = "") => {
  const r = { ok: !!ok, name, detail: String(detail).slice(0, 300) };
  results.push(r);
  fs.appendFileSync(LOG, `${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}\n`);
};
const run = crypto.randomBytes(3).toString("hex").toUpperCase();
const state = { demo: null, users: [], startedAt: new Date(), settingsBefore: undefined };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 14 dk aşıldı", false);
  finish();
}, 14 * 60_000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const derive = (nonce) => crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
const webhookSecret = () => process.env.PAYMENT_WEBHOOK_SECRET || crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.mock-payment-webhook.v1").digest("hex");
const sign = (raw, ts = Date.now()) => `t=${ts},v1=${crypto.createHmac("sha256", webhookSecret()).update(`${ts}.${raw}`, "utf8").digest("hex")}`;
const bodyText = (p) => p.evaluate(() => document.body.innerText);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const minorOf = (p, sel) => p.$eval(sel, (e) => Number(e.dataset.minor)).catch(() => null);
async function waitFor(p, fn, arg, timeout = 15000) {
  try {
    await p.waitForFunction(fn, { polling: 200, timeout }, arg);
    return true;
  } catch {
    return false;
  }
}
async function clickXp(p, xpath) {
  const [el] = await p.$$(`xpath/${xpath}`);
  if (!el) throw new Error(`Öğe yok: ${xpath}`);
  await el.click();
}
const jsClick = (p, sel) => p.$eval(sel, (e) => { e.scrollIntoView({ block: "center" }); e.click(); });
const sheetBtn = (role, label) => `.//dialog[@open]//button[@role="${role}"][.//span[normalize-space(.)="${label}"]]`;
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  if (!(await page.$("#email"))) return;
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
}
async function makeUser(role, label) {
  const email = `${label}-${run.toLowerCase()}@e2e.masanovai.test`;
  const password = `${label}-${run}-${crypto.randomBytes(9).toString("base64url")}`;
  const user = await db.user.create({ data: { tenantId: state.demo.id, email, firstName: "E2E", lastName: label, role, passwordHash: await hash(password) }, select: { id: true } });
  state.users.push(user.id);
  return { email, password };
}
/** Müşteri: Cheeseburger (Orta) + 2× Ayran → gönder → sipariş sayfası adresi. */
async function placeOrder(cust, stable) {
  await cust.goto(stable, { waitUntil: "networkidle2" });
  await cust.click('[data-product="cheeseburger"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  await sleep(300);
  await clickXp(cust, sheetBtn("radio", "Orta"));
  await cust.click("dialog[open] [data-testid='add-to-cart']");
  await cust.waitForFunction(() => !document.querySelector("dialog[open] #pm-sheet-title"), { polling: 200, timeout: 8000 });
  await sleep(250);
  for (let i = 0; i < 2; i++) {
    await cust.click('[data-product="ayran"]');
    await cust.waitForSelector("dialog[open] #pm-sheet-title");
    await sleep(300);
    await cust.click("dialog[open] [data-testid='add-to-cart']");
    await cust.waitForFunction(() => !document.querySelector("dialog[open] #pm-sheet-title"), { polling: 200, timeout: 8000 });
    await sleep(250);
  }
  await cust.click('[data-testid="cart-bar"]');
  await cust.waitForSelector("dialog[open] #pm-cart-title");
  await waitFor(cust, () => !document.body.innerText.match(/kontrol ediliyor/), null, 15000);
  await jsClick(cust, '[data-testid="review-order"]');
  await cust.waitForSelector('[data-testid="send-order"]');
  await jsClick(cust, '[data-testid="send-order"]');
  await cust.waitForSelector('[data-testid="order-success"]', { timeout: 20000 });
  const number = Number((await cust.$eval('[data-testid="order-number"]', (e) => e.textContent)).replace(/\D/g, ""));
  const order = await db.order.findFirstOrThrow({ where: { tenantId: state.demo.id, orderNumber: number }, select: { id: true, publicId: true, totalMinor: true } });
  const origin = new URL(cust.url()).origin;
  const token = new URL(cust.url()).pathname.split("/")[2];
  return { ...order, number, orderUrl: `${origin}/t/${token}/siparis/${order.publicId}`, payUrl: `${origin}/t/${token}/siparis/${order.publicId}/odeme`, origin, token };
}
async function accept(owner, orderId) {
  await owner.goto(`${B}/panel/siparisler/${orderId}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  return waitFor(owner, () => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("Kabul"), null, 15000);
}
/** Ödeme düğmesine bas → test ödeme sayfası. */
async function payAndCheckout(cust) {
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }), jsClick(cust, "[data-testid=pay-submit]")]);
  return cust.waitForSelector("[data-testid=mock-checkout]", { timeout: 10000 }).then(() => true).catch(() => false);
}
async function choose(cust, outcome) {
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }), jsClick(cust, `[data-testid=mock-${outcome}]`)]);
}
const resultStatus = (cust, timeout = 20000) => waitFor(cust, () => { const s = document.querySelector("[data-testid=pay-result]")?.dataset.status; return s && s !== "PENDING"; }, null, timeout).then(() => cust.$eval("[data-testid=pay-result]", (e) => e.dataset.status).catch(() => null));
const postWebhook = (raw, signature, provider = "mock") => fetch(`${B}/api/v1/payments/webhook/${provider}`, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-masanova-signature": signature } : {}) }, body: raw });

async function cleanup() {
  if (!state.demo) return;
  const T = state.demo.id;
  await db.order.deleteMany({ where: { tenantId: T } });
  await db.orderSequence.deleteMany({ where: { tenantId: T } });
  await db.paymentWebhookEvent.deleteMany({ where: { tenantId: T } });
  if (state.settingsBefore) await db.paymentSettings.update({ where: { tenantId: T }, data: state.settingsBefore });
  else if (state.settingsBefore === null) await db.paymentSettings.deleteMany({ where: { tenantId: T } });
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  const T = state.demo.id;
  state.settingsBefore = await db.paymentSettings.findUnique({ where: { tenantId: T }, select: { enabled: true, allowOnline: true, allowCash: true, allowCardTerminal: true, reservationMinutes: true } });
  await db.paymentSettings.deleteMany({ where: { tenantId: T } });
  await db.order.deleteMany({ where: { tenantId: T } });
  await db.orderSequence.deleteMany({ where: { tenantId: T } });
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 12" }, select: { id: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const stable = `${B}/q/${derive(row.tokenNonce)}`;
  const otherTable = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 3" }, select: { id: true } });
  const otherRow = await db.tableQrToken.findFirstOrThrow({ where: { tableId: otherTable.id, active: true } });
  const waiterCreds = await makeUser("WAITER", "garson19");
  const cashierCreds = await makeUser("CASHIER", "kasiyer19");
  const kitchenCreds = await makeUser("KITCHEN", "mutfak19");

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const consoleErrors = [];
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && !/status of 40[134]|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
    p.on("dialog", (d) => d.accept().catch(() => null));
  };
  const newPage = async (viewport) => {
    const p = await (await browser.createBrowserContext()).newPage();
    watch(p);
    await p.setViewport(viewport);
    return p;
  };

  // ── 1–3. Ayarlar ─────────────────────────────────────────────────────
  const owner = await newPage({ width: 1440, height: 1000 });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await owner.goto(`${B}/panel/odemeler/ayarlar`, { waitUntil: "networkidle2" });
  const provider = await owner.$eval("[data-testid=payment-provider-status]", (e) => ({ configured: e.dataset.configured, text: e.innerText })).catch(() => null);
  const html = await owner.content();
  check("1. Ayarlar: sağlayıcı 'Yapılandırıldı' + test rozeti; gizli anahtar sayfada YOK", provider?.configured === "true" && provider.text.includes("Test sağlayıcısı") && !html.includes(webhookSecret()), JSON.stringify(provider));
  const navHasPayments = await owner.$$eval("nav a", (as) => as.some((a) => a.getAttribute("href") === "/panel/odemeler"));
  check("2. Varsayılan KAPALI; menüde 'Ödemeler'", !(await owner.$eval("#pay-enabled", (e) => e.checked)) && navHasPayments);
  await jsClick(owner, "#pay-enabled");
  await jsClick(owner, "[data-testid=payment-settings-form] button[type=submit]");
  await waitFor(owner, () => document.body.innerText.includes("Ödeme ayarları kaydedildi"), null, 10000);
  const saved = await db.paymentSettings.findUnique({ where: { tenantId: T } });
  check("3. Sahip ödemeleri açtı (denetim: PAYMENT_PROVIDER_SETTING_UPDATED)", saved?.enabled === true && (await db.auditLog.count({ where: { tenantId: T, action: "PAYMENT_PROVIDER_SETTING_UPDATED", createdAt: { gte: state.startedAt } } })) === 1);

  // ── 4–6. Sipariş → kabul → ödeme düğmesi ─────────────────────────────
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const o1 = await placeOrder(cust, stable);
  await cust.goto(o1.orderUrl, { waitUntil: "networkidle2" });
  check("4. Gönderilen (henüz kabul edilmemiş) siparişte 'Ödeme Yap' YOK", !(await cust.$("[data-testid=order-pay-cta]")));
  check("5. Personel siparişi kabul etti", await accept(owner, o1.id));
  await cust.reload({ waitUntil: "networkidle2" });
  const remaining0 = await cust.$eval("[data-testid=order-pay-remaining]", (e) => e.textContent).catch(() => "");
  check("6. Kabul sonrası sipariş sayfasında 'Ödeme Yap' + kalan tutar", !!(await cust.$("[data-testid=order-pay-cta]")) && remaining0.includes("₺"), remaining0);
  await cust.screenshot({ path: path.join(OUT, "order-pay-card-390.png"), fullPage: true });

  // ── 7–11. Tutar ile kısmi ödeme (barındırılan akış + webhook) ────────
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2" }), jsClick(cust, "[data-testid=order-pay-cta]")]);
  const total = o1.totalMinor;
  check("7. Ödeme sayfası: kalan = sipariş toplamı (sunucu), 4 yöntem", (await minorOf(cust, "[data-testid=pay-remaining]")) === total && (await cust.$$("[role=radio][data-testid^=pay-mode-]")).length === 4, await minorOf(cust, "[data-testid=pay-remaining]"));
  await jsClick(cust, "[data-testid=pay-mode-amount]");
  await cust.type("[data-testid=pay-amount]", String(total / 100 + 1));
  check("8. Kalanı aşan tutar: düğme pasif", await cust.$eval("[data-testid=pay-submit]", (e) => e.disabled));
  await cust.$eval("[data-testid=pay-amount]", (e) => { e.value = ""; });
  await cust.click("[data-testid=pay-amount]", { clickCount: 3 });
  await cust.keyboard.press("Backspace");
  await cust.type("[data-testid=pay-amount]", "100");
  await cust.screenshot({ path: path.join(OUT, "pay-amount-390.png"), fullPage: true });
  const atCheckout = await payAndCheckout(cust);
  const checkoutText = atCheckout ? await bodyText(cust) : "";
  check("9. Barındırılan TEST ödeme sayfası (tutar 100 ₺, 'gerçek para çekilmez', kart alanı YOK)", atCheckout && checkoutText.includes("TEST") && checkoutText.includes("100,00") && !(await cust.$("input:not([type=hidden])")), checkoutText.slice(0, 120));
  await cust.screenshot({ path: path.join(OUT, "mock-checkout-390.png"), fullPage: true });
  const p1Before = await db.payment.findFirst({ where: { tenantId: T, orderId: o1.id }, orderBy: { createdAt: "desc" } });
  check("10. Sayfa açıkken ödeme 'işleniyor' (tarayıcı yönlendirmesi kanıt değil) ve tutar rezerve", p1Before?.status === "PROCESSING" && p1Before.amountMinor === 10_000 && !!p1Before.reservedUntil);
  await choose(cust, "succeed");
  const verifyingSeen = (await bodyText(cust)).includes("Ödeme doğrulanıyor") || (await cust.$eval("[data-testid=pay-result]", (e) => e.dataset.status).catch(() => null)) !== null;
  const s1 = await resultStatus(cust);
  const p1 = await db.payment.findUnique({ where: { id: p1Before.id } });
  check("11. Dönüş: 'Ödeme doğrulanıyor…' → 'Ödemeniz alındı'; DB SUCCEEDED, kart yalnızca son 4", verifyingSeen && s1 === "SUCCEEDED" && p1.status === "SUCCEEDED" && p1.cardLast4 === "4242" && (await db.paymentWebhookEvent.count({ where: { tenantId: T, providerReference: { not: null } } })) >= 1, `${s1} ${p1?.status}`);
  await cust.screenshot({ path: path.join(OUT, "pay-success-390.png"), fullPage: true });

  // ── 12–13. Eşit bölme → ret → tekrar dene ────────────────────────────
  await cust.goto(o1.payUrl, { waitUntil: "networkidle2" });
  const rem1 = await minorOf(cust, "[data-testid=pay-remaining]");
  check("12. Kalan güncellendi (toplam − 100 ₺)", rem1 === total - 10_000, rem1);
  await jsClick(cust, "[data-testid=pay-mode-equal]");
  const share = Math.ceil(rem1 / 2);
  const preview = await cust.$eval("[data-testid=pay-amount-preview]", (e) => Number(e.textContent.replace(/[^\d]/g, "")));
  await payAndCheckout(cust);
  await choose(cust, "fail");
  const s2 = await resultStatus(cust);
  const failed = await db.payment.findFirst({ where: { tenantId: T, orderId: o1.id, status: "FAILED" } });
  check("13. Hesabı Böl (2 kişi) payı kuruşu kuruşuna; sağlayıcı reddi → 'tamamlanamadı', bakiye değişmedi", preview === share && s2 === "FAILED" && failed?.amountMinor === share && !!(await cust.$("[data-testid=pay-retry]")), `${preview} ${share} ${s2}`);

  // ── 14–17. Beklemede bırak → HTTP webhook (imza, tekrar, geçersiz) ───
  await jsClick(cust, "[data-testid=pay-retry]");
  await cust.waitForSelector("[data-testid=pay-panel]");
  await jsClick(cust, "[data-testid=pay-mode-equal]");
  await payAndCheckout(cust);
  await choose(cust, "pending");
  const pendingShown = await waitFor(cust, () => document.body.innerText.includes("Ödeme doğrulanıyor"), null, 8000);
  const pend = await db.payment.findFirst({ where: { tenantId: T, orderId: o1.id, status: "PROCESSING" }, include: { attempts: true } });
  check("14. 'Beklemede bırak' → müşteri 'Ödeme doğrulanıyor…' görür; ödeme İŞLENİYOR", pendingShown && !!pend, pend?.status);
  const ref = pend?.attempts[0]?.providerReference;
  const raw = JSON.stringify({ id: `evt_e2e_${run}`, type: "payment.succeeded", reference: ref });
  const bad = await postWebhook(raw, `t=${Date.now()},v1=${"0".repeat(64)}`);
  const none = await postWebhook(raw, null);
  const stale = await postWebhook(raw, sign(raw, Date.now() - 10 * 60_000));
  check("15. Webhook: sahte / eksik / eski imza 401, ödeme değişmedi", bad.status === 401 && none.status === 401 && stale.status === 401 && (await db.payment.findUnique({ where: { id: pend.id } })).status === "PROCESSING", `${bad.status} ${none.status} ${stale.status}`);
  const good = await postWebhook(raw, sign(raw));
  const dup = await postWebhook(raw, sign(raw));
  const goodJson = await good.json();
  const dupJson = await dup.json();
  check("16. Geçerli imzalı webhook → SUCCEEDED; aynı olay tekrar → 'duplicate' (bir kez işlendi)", good.status === 200 && goodJson.outcome === "processed" && dupJson.outcome === "duplicate" && (await db.payment.findUnique({ where: { id: pend.id } })).status === "SUCCEEDED", `${JSON.stringify(goodJson)} ${JSON.stringify(dupJson)}`);
  const s3 = await resultStatus(cust, 20000);
  const big = await fetch(`${B}/api/v1/payments/webhook/mock`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(70_000) });
  const unknown = await postWebhook(raw, sign(raw), "stripe");
  check("17. Müşteri sayfası yoklamayla 'alındı' gördü; büyük gövde 413; yapılandırılmamış sağlayıcı 400", s3 === "SUCCEEDED" && big.status === 413 && unknown.status === 400, `${s3} ${big.status} ${unknown.status}`);

  // ── 18–20. Ürün seçerek öde + tamamını öde (çift tıklama) ───────────
  await cust.goto(o1.payUrl, { waitUntil: "networkidle2" });
  await jsClick(cust, "[data-testid=pay-mode-items]");
  const itemCount = (await cust.$$("[data-testid=pay-item]")).length;
  await jsClick(cust, "[data-testid=pay-item] [data-testid=pay-item-inc]");
  const itemAmount = await cust.$eval("[data-testid=pay-amount-preview]", (e) => Number(e.textContent.replace(/[^\d]/g, "")));
  const remBeforeItems = await minorOf(cust, "[data-testid=pay-remaining]");
  if (itemAmount <= remBeforeItems) {
    await payAndCheckout(cust);
    await choose(cust, "succeed");
    await resultStatus(cust);
  }
  const itemPay = await db.payment.findFirst({ where: { tenantId: T, orderId: o1.id, splitMode: "ITEMS" }, include: { allocations: true } });
  check("18. Ürünlerini Seç: kalem bazında dağılım (adet + tutar)", itemCount >= 2 && (itemAmount > remBeforeItems || (itemPay?.status === "SUCCEEDED" && itemPay.allocations[0]?.quantity === 1 && itemPay.allocations[0]?.orderItemId)), `${itemCount} ${itemAmount} ${remBeforeItems} ${itemPay?.status}`);
  await cust.goto(o1.payUrl, { waitUntil: "networkidle2" });
  const remBeforeFull = await minorOf(cust, "[data-testid=pay-remaining]");
  const countBefore = await db.payment.count({ where: { tenantId: T, orderId: o1.id } });
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }), cust.$eval("[data-testid=pay-submit]", (e) => { e.click(); e.click(); })]);
  await cust.waitForSelector("[data-testid=mock-checkout]");
  const countAfter = await db.payment.count({ where: { tenantId: T, orderId: o1.id } });
  check("19. Tamamını Öde: çift tıklama TEK ödeme isteği", countAfter === countBefore + 1, `${countBefore} → ${countAfter}`);
  await choose(cust, "succeed");
  await resultStatus(cust);
  const paidSum = (await db.payment.aggregate({ where: { tenantId: T, orderId: o1.id, status: "SUCCEEDED" }, _sum: { amountMinor: true } }))._sum.amountMinor;
  await cust.goto(o1.orderUrl, { waitUntil: "networkidle2" });
  const cardState = await cust.$eval("[data-testid=order-pay-card]", (e) => e.dataset.state).catch(() => null);
  check("20. Sipariş ÖDENDİ: ödemeler toplamı = toplam (fazla ödeme yok); 'Ödeme Yap' gizlendi", paidSum === total && remBeforeFull > 0 && cardState === "PAID" && !(await cust.$("[data-testid=order-pay-cta]")), `${paidSum}/${total} ${cardState}`);
  await cust.goto(o1.payUrl, { waitUntil: "networkidle2" });
  check("21. Ödenmiş siparişin ödeme sayfası: 'ödemesi tamamlandı'", !!(await cust.$("[data-testid=pay-fully-paid]")));

  // ── 22–26. Panel: sipariş kartı, liste, ayrıntı, iade ─────────────────
  await owner.goto(`${B}/panel/siparisler/${o1.id}`, { waitUntil: "networkidle2" });
  const panelState = await owner.$eval("[data-testid=order-payment-state]", (e) => e.dataset.state).catch(() => null);
  const panelRows = (await owner.$$("[data-testid=order-payment-row]")).length;
  check("22. Panel sipariş ayrıntısı: ödeme durumu ÖDENDİ, kalan 0, ödeme satırları", panelState === "PAID" && (await minorOf(owner, "[data-testid=order-remaining]")) === 0 && panelRows >= 4, `${panelState} ${panelRows}`);
  await owner.goto(`${B}/panel/odemeler?durum=FAILED`, { waitUntil: "networkidle2" });
  const failedRows = await owner.$$eval("[data-testid=payment-row]", (rs) => rs.map((r) => r.dataset.status));
  check("23. Ödemeler listesi durum filtresi (yalnız başarısız)", failedRows.length >= 1 && failedRows.every((s) => s === "FAILED"), failedRows.join(","));
  await owner.goto(`${B}/panel/odemeler/${p1.id}`, { waitUntil: "networkidle2" });
  const detail = await bodyText(owner);
  check("24. Ödeme ayrıntısı: kart •••• 4242, deneme + dağılım; tam sağlayıcı referansı / ödeme bağlantısı YOK", detail.includes("•••• 4242") && (await owner.$$("[data-testid=payment-attempt]")).length === 1 && (await owner.$$("[data-testid=payment-allocation]")).length === 1 && !detail.includes(ref ?? "∅") && !(await owner.content()).includes("/odeme/mock/"));
  await clickXp(owner, `.//button[normalize-space(.)="İade et"]`);
  await owner.waitForSelector("dialog[open] #refund-amount");
  await owner.$eval("#refund-amount", (e) => (e.value = ""));
  await owner.type("#refund-amount", "40");
  await owner.type("#refund-reason", "e2e kısmi iade");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="İade et"]`);
  await waitFor(owner, () => document.querySelector("[data-testid=payment-status]")?.dataset.status === "PARTIALLY_REFUNDED", null, 15000);
  const refunded = await db.payment.findUnique({ where: { id: p1.id } });
  check("25. Kısmi iade (40 ₺): KISMİ İADE, iade kaydı + denetim (istendi + iade edildi)", refunded.status === "PARTIALLY_REFUNDED" && refunded.refundedMinor === 4000 && (await db.paymentRefund.count({ where: { paymentId: p1.id, status: "SUCCEEDED" } })) === 1 && (await db.auditLog.count({ where: { entityId: p1.id, action: { in: ["PAYMENT_REFUND_REQUESTED", "PAYMENT_REFUNDED"] } } })) === 2);
  await clickXp(owner, `.//button[normalize-space(.)="İade et"]`);
  await owner.waitForSelector("dialog[open] #refund-amount");
  await owner.$eval("#refund-amount", (e) => (e.value = ""));
  await owner.type("#refund-amount", "61");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="İade et"]`);
  const overErr = await waitFor(owner, () => document.querySelector("dialog[open] [role=alert]")?.textContent.includes("aşıyor"), null, 10000);
  check("26. İade edilebilir tutarı aşan iade reddedildi; iade bakiyeyi yeniden AÇMADI", overErr && (await db.payment.findUnique({ where: { id: p1.id } })).refundedMinor === 4000 && (await db.order.findUnique({ where: { id: o1.id } })).status !== "CANCELLED");
  await owner.keyboard.press("Escape");

  // ── 27–28. Kasada ödeme (2. sipariş) ─────────────────────────────────
  const o2 = await placeOrder(cust, stable);
  await accept(owner, o2.id);
  await owner.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kasada ödeme kaydet"]`);
  await owner.waitForSelector("dialog[open] #manual-amount");
  await owner.type("#manual-amount", "50");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Ödemeyi kaydet"]`);
  await waitFor(owner, () => document.querySelector("[data-testid=order-payment-state]")?.dataset.state === "PARTIALLY_PAID", null, 15000);
  const cash = await db.payment.findFirst({ where: { tenantId: T, orderId: o2.id, method: "CASH" } });
  check("27. Kasada nakit 50 ₺: KISMEN ÖDENDİ, denetim PAYMENT_MANUAL_RECORDED", cash?.status === "SUCCEEDED" && cash.amountMinor === 5000 && cash.provider === "manual" && (await db.auditLog.count({ where: { entityId: cash.id, action: "PAYMENT_MANUAL_RECORDED" } })) === 1);
  await cust.goto(o2.payUrl, { waitUntil: "networkidle2" });
  check("28. Müşteri ödeme sayfası kasadaki ödemeyi yansıtır (kalan = toplam − 50 ₺)", (await minorOf(cust, "[data-testid=pay-remaining]")) === o2.totalMinor - 5000);

  // ── 29–32. Yetkiler ve izolasyon ────────────────────────────────────
  const waiter = await newPage({ width: 1280, height: 900 });
  await login(waiter, waiterCreds.email, waiterCreds.password);
  const w1 = await waiter.goto(`${B}/panel/odemeler`, { waitUntil: "networkidle2" });
  const w2 = await waiter.goto(`${B}/panel/odemeler/${p1.id}`, { waitUntil: "networkidle2" });
  await waiter.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  const waiterBadge = await waiter.$eval("[data-testid=order-payment-state]", (e) => e.dataset.state).catch(() => null);
  check("29. Garson: ödemeler 404; siparişte YALNIZCA durum rozeti (tutar / kasa düğmesi yok)", w1.status() === 404 && w2.status() === 404 && waiterBadge === "PARTIALLY_PAID" && !(await waiter.$("[data-testid=order-paid]")) && !(await bodyText(waiter)).includes("Kasada ödeme kaydet"), `${w1.status()} ${w2.status()} ${waiterBadge}`);
  const kitchen = await newPage({ width: 1280, height: 900 });
  await login(kitchen, kitchenCreds.email, kitchenCreds.password);
  const k1 = await kitchen.goto(`${B}/panel/odemeler`, { waitUntil: "networkidle2" });
  await kitchen.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  const kitchenCard = !!(await kitchen.$("[data-testid=order-payment-card]"));
  await kitchen.goto(`${B}/panel/mutfak`, { waitUntil: "networkidle2" });
  const kds = await bodyText(kitchen);
  check("30. Mutfak: ödemeler 404, siparişte ödeme kartı yok, KDS'de ödeme bilgisi yok", k1.status() === 404 && !kitchenCard && !/Ödendi|Kısmen ödendi|ödeme/i.test(kds), `${k1.status()} ${kitchenCard}`);
  const cashier = await newPage({ width: 1280, height: 900 });
  await login(cashier, cashierCreds.email, cashierCreds.password);
  const c1 = await cashier.goto(`${B}/panel/odemeler`, { waitUntil: "networkidle2" });
  await cashier.goto(`${B}/panel/odemeler/ayarlar`, { waitUntil: "networkidle2" });
  const cashierSettingsDisabled = await cashier.$eval("[data-testid=payment-settings-form] fieldset", (e) => e.disabled).catch(() => null);
  await cashier.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  check("31. Kasiyer: ödemeleri görür, kasada ödeme kaydedebilir; ayarlar salt okunur", c1.status() === 200 && cashierSettingsDisabled === true && (await bodyText(cashier)).includes("Kasada ödeme kaydet"), `${c1.status()} ${cashierSettingsDisabled}`);
  const otherStable = `${B}/q/${derive(otherRow.tokenNonce)}`;
  const other = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await other.goto(otherStable, { waitUntil: "networkidle2" });
  const otherToken = new URL(other.url()).pathname.split("/")[2];
  const cross = await other.goto(`${new URL(other.url()).origin}/t/${otherToken}/siparis/${o2.publicId}/odeme`, { waitUntil: "networkidle2" });
  const guess = await cust.goto(`${o2.origin}/t/${o2.token}/siparis/${crypto.randomBytes(16).toString("base64url")}/odeme`, { waitUntil: "networkidle2" });
  const badRef = await cust.goto(`${o2.origin}/odeme/mock/mock_${"0".repeat(24)}`, { waitUntil: "networkidle2" });
  check("32. Başka masanın QR'ı / tahmin edilen sipariş / bilinmeyen test referansı → 404", cross.status() === 404 && guess.status() === 404 && badRef.status() === 404, `${cross.status()} ${guess.status()} ${badRef.status()}`);

  // ── 33. Online ödeme kapalı → sipariş verme etkilenmez ───────────────
  await db.paymentSettings.update({ where: { tenantId: T }, data: { allowOnline: false } });
  await cust.goto(o2.orderUrl, { waitUntil: "networkidle2" });
  const noCta = !(await cust.$("[data-testid=order-pay-cta]"));
  await cust.goto(o2.payUrl, { waitUntil: "networkidle2" });
  const unavailable = await cust.$eval("[data-testid=pay-unavailable]", (e) => e.textContent).catch(() => "");
  await cust.goto(stable, { waitUntil: "networkidle2" });
  check("33. Online ödeme kapalı: düğme gizli, 'Online ödeme şu anda kullanılamıyor', menü / sipariş çalışıyor", noCta && unavailable.includes("Online ödeme şu anda kullanılamıyor") && !!(await cust.$('[data-product="cheeseburger"]')), unavailable);
  await db.paymentSettings.update({ where: { tenantId: T }, data: { allowOnline: true } });

  // ── 34. Destek modu salt okunur ──────────────────────────────────────
  const ap = await newPage({ width: 1440, height: 900 });
  await login(ap, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" });
  await clickXp(ap, `.//header//button[normalize-space(.)="Destek Modu"]`);
  await ap.waitForSelector("dialog[open]");
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle2" }), clickXp(ap, `.//dialog[@open]//button[normalize-space(.)="Destek modunu başlat"]`)]);
  await ap.goto(`${B}/panel/odemeler/${p1.id}`, { waitUntil: "networkidle2" });
  const supRefund = (await bodyText(ap)).includes("İade et");
  await ap.goto(`${B}/panel/odemeler/ayarlar`, { waitUntil: "networkidle2" });
  const supDisabled = await ap.$eval("[data-testid=payment-settings-form] fieldset", (e) => e.disabled).catch(() => null);
  await ap.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  check("34. Destek modu: iade / kasa düğmesi yok, ayarlar salt okunur", !supRefund && supDisabled === true && !(await bodyText(ap)).includes("Kasada ödeme kaydet"), `${supRefund} ${supDisabled}`);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" }).catch(() => null);
  await clickXp(ap, `.//button[normalize-space(.)="Destek modundan çık"]`).catch(() => null);

  // ── 35–37. Duyarlı görünüm, analitik, konsol ─────────────────────────
  let worst = 0;
  for (const url of [o2.orderUrl, o2.payUrl]) {
    await cust.goto(url, { waitUntil: "networkidle2" });
    worst = Math.max(worst, await overflow(cust));
  }
  await cust.goto(o2.payUrl, { waitUntil: "networkidle2" });
  await jsClick(cust, "[data-testid=pay-mode-items]");
  worst = Math.max(worst, await overflow(cust));
  await cust.screenshot({ path: path.join(OUT, "pay-items-390.png"), fullPage: true });
  const ownerM = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(ownerM, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  for (const url of ["/panel/odemeler", `/panel/odemeler/${p1.id}`, "/panel/odemeler/ayarlar", `/panel/siparisler/${o2.id}`]) {
    await ownerM.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    worst = Math.max(worst, await overflow(ownerM));
  }
  await ownerM.screenshot({ path: path.join(OUT, "panel-payment-390.png"), fullPage: true });
  check("35. 390px: sipariş / ödeme / ürün seçimi / panel ödeme sayfaları taşmıyor", worst <= 0, worst);
  let wide = 0;
  for (const url of ["/panel/odemeler", `/panel/odemeler/${p1.id}`, `/panel/siparisler/${o1.id}`, "/panel/analitik"]) {
    await owner.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    wide = Math.max(wide, await overflow(owner));
  }
  const analytics = await owner.$eval("[data-testid=analytics-payments]", (e) => e.innerText).catch(() => "");
  await owner.screenshot({ path: path.join(OUT, "analytics-1440.png"), fullPage: true });
  check("36. 1440px: analitikte ödeme özeti (online / kasada / iade; 'kesinleşmiş ciro' değildir)", analytics.includes("Online ödenen") && analytics.includes("Kasada") && analytics.includes("İade") && wide <= 0, wide);
  check("37. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack ?? e.message))
  .finally(() => finish());

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  await browser?.close().catch(() => null);
  try {
    await cleanup();
    if (state.users.length) {
      await db.session.deleteMany({ where: { userId: { in: state.users } } });
      await db.user.deleteMany({ where: { id: { in: state.users } } });
    }
    const T = state.demo?.id;
    const left = T ? (await db.order.count({ where: { tenantId: T } })) + (await db.payment.count({ where: { tenantId: T } })) + (await db.paymentWebhookEvent.count({ where: { tenantId: T } })) : 0;
    const after = T ? await db.paymentSettings.findUnique({ where: { tenantId: T }, select: { enabled: true, allowOnline: true, allowCash: true, allowCardTerminal: true, reservationMinutes: true } }) : null;
    const back = JSON.stringify(after) === JSON.stringify(state.settingsBefore ?? null);
    check("38. Geçici veri temizlendi (sipariş, ödeme, webhook olayı, kullanıcı); ödeme ayarı geri alındı", left === 0 && back, `${left} ${back}`);
  } catch (e) {
    check("38. Geçici veri temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

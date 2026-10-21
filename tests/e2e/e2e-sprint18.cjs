// MasaNovaAI Sprint 18 — Kupon, sadakat ödülü, puan kullanımı / iadesi, izin odaklı kampanya (production build).
// Demo kiracıya geçici kupon / ödül / kampanya / müşteri / sipariş yazılır; sadakat ayarı test boyunca açılır.
// Sonunda her şey silinir ve ayar eski haline döner. Gönderim (SMS / e-posta / WhatsApp) YOK.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s18");
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
const state = { demo: null, users: [], startedAt: new Date(), loyaltyBefore: null, customers: [] };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 12 dk aşıldı", false);
  finish();
}, 12 * 60_000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const derive = (nonce) => crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
const bodyText = (p) => p.evaluate(() => document.body.innerText);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const digits = (s) => Number(String(s ?? "").replace(/[^\d]/g, "")); // "−₺20,00" → 2000
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

/** Müşteri: Cheeseburger (Orta) + Ayran sepete → sepeti aç. */
async function fillCart(cust, stable) {
  await cust.goto(stable, { waitUntil: "networkidle2" });
  await cust.click('[data-product="cheeseburger"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  await sleep(300);
  await clickXp(cust, sheetBtn("radio", "Orta"));
  await cust.click("dialog[open] [data-testid='add-to-cart']");
  await cust.waitForFunction(() => !document.querySelector("dialog[open] #pm-sheet-title"), { polling: 200, timeout: 8000 });
  await sleep(250);
  await cust.click('[data-product="ayran"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  await sleep(300);
  await cust.click("dialog[open] [data-testid='add-to-cart']");
  await cust.waitForFunction(() => !document.querySelector("dialog[open] #pm-sheet-title"), { polling: 200, timeout: 8000 });
  await sleep(250);
  await cust.click('[data-testid="cart-bar"]');
  await cust.waitForSelector("dialog[open] #pm-cart-title");
  await waitFor(cust, () => !document.body.innerText.match(/kontrol ediliyor/), null, 15000);
}
async function applyCoupon(cust, code) {
  await cust.$eval("[data-testid=coupon-input]", (e) => (e.value = ""));
  await cust.type("[data-testid=coupon-input]", code);
  await jsClick(cust, "[data-testid=coupon-apply]");
  await waitFor(cust, () => !!document.querySelector("[data-testid=promotion-applied], [data-testid=promotion-error]"), null, 15000);
}
async function send(cust) {
  await jsClick(cust, '[data-testid="review-order"]');
  await cust.waitForSelector('[data-testid="send-order"]');
  await jsClick(cust, '[data-testid="send-order"]');
  await cust.waitForSelector('[data-testid="order-success"]', { timeout: 20000 });
  return Number((await cust.$eval('[data-testid="order-number"]', (e) => e.textContent)).replace(/\D/g, ""));
}
async function createCoupon(owner, { code, name, type = "FIXED_AMOUNT", value, percent, maxDiscount, minimumOrder, active = false }) {
  await owner.goto(`${B}/panel/kampanyalar/kuponlar/yeni`, { waitUntil: "networkidle2" });
  await owner.type("#cp-code", code);
  await owner.type("#cp-name", name);
  if (type !== "FIXED_AMOUNT") {
    await owner.select("#cp-type", type);
    await sleep(200);
  }
  if (value) await owner.type("#pv-value", value);
  if (percent) await owner.type("#pv-percent", percent);
  if (maxDiscount) await owner.type("#pv-max", maxDiscount);
  if (minimumOrder) await owner.type("#pv-min", minimumOrder);
  if (active) await owner.click("#cp-active");
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click("[data-testid=coupon-submit]")]);
}
const balance = async (customerId) => {
  const acc = await db.loyaltyAccount.findFirst({ where: { customerId } });
  return acc ? ((await db.loyaltyLedger.aggregate({ where: { accountId: acc.id }, _sum: { points: true } }))._sum.points ?? 0) : null;
};

async function cleanup() {
  if (!state.demo) return;
  const T = state.demo.id;
  await db.order.deleteMany({ where: { tenantId: T } });
  await db.orderSequence.deleteMany({ where: { tenantId: T } });
  await db.campaign.deleteMany({ where: { tenantId: T, createdAt: { gte: state.startedAt } } });
  if (state.customers.length) await db.customer.deleteMany({ where: { id: { in: state.customers } } });
  await db.loyaltyReward.deleteMany({ where: { tenantId: T, createdAt: { gte: state.startedAt } } });
  await db.coupon.deleteMany({ where: { tenantId: T, createdAt: { gte: state.startedAt } } });
  if (state.loyaltyBefore) await db.loyaltySettings.update({ where: { tenantId: T }, data: state.loyaltyBefore });
  else await db.loyaltySettings.deleteMany({ where: { tenantId: T } });
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  const T = state.demo.id;
  state.loyaltyBefore = await db.loyaltySettings.findUnique({ where: { tenantId: T }, select: { enabled: true, minorPerPoint: true, earnOn: true } });
  await db.order.deleteMany({ where: { tenantId: T } });
  await db.orderSequence.deleteMany({ where: { tenantId: T } });
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 12" }, select: { id: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const stable = `${B}/q/${derive(row.tokenNonce)}`;
  const waiterCreds = await makeUser("WAITER", "garson18");
  const FIX = `SABIT${run}`;
  const PCT = `YUZDE${run}`;
  const MIN = `MIN${run}`;

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const consoleErrors = [];
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && !/status of 40[34]|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
    p.on("dialog", (d) => d.accept().catch(() => null));
  };
  const newPage = async (viewport) => {
    const p = await (await browser.createBrowserContext()).newPage();
    watch(p);
    await p.setViewport(viewport);
    return p;
  };

  // ── 1–2. Sabit kupon (pasif oluştur → etkinleştir) ─────────────────────
  const owner = await newPage({ width: 1440, height: 1000 });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await createCoupon(owner, { code: FIX.toLowerCase(), name: "50 ₺ indirim", value: "50" });
  const c1 = await db.coupon.findFirst({ where: { tenantId: T, codeNormalized: FIX } });
  check("1. Sahip sabit kupon oluşturdu (kod normalize, kuruş, pasif, denetim)", c1?.valueMinor === 5000 && c1.status === "INACTIVE" && (await db.auditLog.count({ where: { entityId: c1.id, action: "COUPON_CREATED" } })) === 1, JSON.stringify({ v: c1?.valueMinor, s: c1?.status }));
  await jsClick(owner, `tr[data-coupon="${FIX}"] [data-testid=coupon-activate]`);
  check("2. Kupon etkinleştirildi", await waitFor(owner, (c) => document.querySelector(`tr[data-coupon="${c}"] [data-status]`)?.dataset.status === "ACTIVE", FIX));
  await owner.screenshot({ path: path.join(OUT, "coupons-1440.png"), fullPage: true });

  // ── 3–9. Anonim müşteri kupon kullanır ────────────────────────────────
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await fillCart(cust, stable);
  check("3–4. Anonim müşteri QR'ı açtı, ürün ekledi (kimlik yok, ödül listesi yok)", !!(await cust.$("[data-testid=coupon-input]")) && !(await cust.$("[data-testid=reward-options]")));
  await applyCoupon(cust, `  ${FIX.toLowerCase()} `);
  const applied = !!(await cust.$("[data-testid=promotion-applied]"));
  const discount = digits(await cust.$eval("[data-testid=cart-discount]", (e) => e.textContent).catch(() => ""));
  const subtotal = digits(await cust.$eval("[data-testid=cart-subtotal]", (e) => e.textContent).catch(() => ""));
  const total = digits(await cust.$eval("[data-testid=cart-total]", (e) => e.textContent).catch(() => ""));
  check("5. Kupon uygulandı (büyük / küçük harf ve boşluk fark etmez)", applied);
  check("6. İndirim gösterildi: ara toplam − 50 ₺ = toplam (sunucu önizlemesi)", discount === 5000 && total === subtotal - 5000, `${subtotal} ${discount} ${total}`);
  await cust.screenshot({ path: path.join(OUT, "cart-coupon-390.png"), fullPage: true });
  await jsClick(cust, '[data-testid="review-order"]');
  await cust.waitForSelector('[data-testid="send-order"]');
  // Çift dokunuş / tekrar: iki tıklama tek sipariş
  await cust.$eval('[data-testid="send-order"]', (e) => { e.click(); e.click(); });
  await cust.waitForSelector('[data-testid="order-success"]', { timeout: 20000 });
  const n1 = Number((await cust.$eval('[data-testid="order-number"]', (e) => e.textContent)).replace(/\D/g, ""));
  const successDiscount = digits(await cust.$eval("[data-testid=success-discount]", (e) => e.textContent).catch(() => ""));
  check("7. Sipariş verildi; başarı ekranında indirim", n1 > 0 && successDiscount === 5000, successDiscount);
  const o1 = await db.order.findFirst({ where: { tenantId: T, orderNumber: n1 }, include: { promotion: true, couponRedemption: true } });
  check("8. Sipariş promosyon kopyası: kod, ad, indirim; toplam = ara toplam − indirim", o1?.promotion?.codeSnapshot === FIX && o1.promotion.label === "50 ₺ indirim" && o1.discountMinor === 5000 && o1.totalMinor === o1.subtotalMinor - 5000 && o1.couponRedemption?.discountMinor === 5000);
  check("9. Tekrar gönderim yeni sipariş / ikinci kullanım üretmedi", (await db.order.count({ where: { tenantId: T } })) === 1 && (await db.couponRedemption.count({ where: { couponId: c1.id } })) === 1);

  // ── 10–12. Yüzde + tavan, en az sepet ─────────────────────────────────
  await createCoupon(owner, { code: PCT, name: "%50 (en fazla 20 ₺)", type: "PERCENTAGE", percent: "50", maxDiscount: "20", active: true });
  const c2 = await db.coupon.findFirst({ where: { tenantId: T, codeNormalized: PCT } });
  check("10. Sahip yüzde kupon oluşturdu (baz puan 5000, tavan 2000 kuruş, etkin)", c2?.percentageBps === 5000 && c2.maxDiscountMinor === 2000 && c2.status === "ACTIVE");
  await fillCart(cust, stable);
  await applyCoupon(cust, PCT);
  const d2 = digits(await cust.$eval("[data-testid=cart-discount]", (e) => e.textContent).catch(() => ""));
  const s2 = digits(await cust.$eval("[data-testid=cart-subtotal]", (e) => e.textContent).catch(() => ""));
  check("11. Tavan uygulandı: %50 yerine en fazla 20 ₺", d2 === Math.min(Math.floor(s2 / 2), 2000) && d2 === 2000, `${s2} ${d2}`);
  await createCoupon(owner, { code: MIN, name: "En az 10.000 ₺", value: "10", minimumOrder: "10000", active: true });
  await jsClick(cust, "[data-testid=promotion-remove]");
  await applyCoupon(cust, MIN);
  const minErr = await cust.$eval("[data-testid=promotion-error]", (e) => e.textContent).catch(() => "");
  check("12. En az sepet karşılanmadı → anlaşılır hata, kupon uygulanmadı", minErr.includes("Sepet tutarı bu kupon için yeterli değil") && !(await cust.$("[data-testid=promotion-applied]")), minErr);
  await applyCoupon(cust, "YOKBOYLEKOD");
  const unknownErr = await cust.$eval("[data-testid=promotion-error]", (e) => e.textContent).catch(() => "");
  check("12b. Bilinmeyen kod nötr yanıt: “Kupon geçerli değil.”", unknownErr === "Kupon geçerli değil.", unknownErr);

  // ── 13–18. Sadakat ödülü ──────────────────────────────────────────────
  await db.loyaltySettings.upsert({ where: { tenantId: T }, create: { tenantId: T, enabled: true, minorPerPoint: 100000, earnOn: "SERVED" }, update: { enabled: true, minorPerPoint: 100000, earnOn: "SERVED" } });
  await owner.goto(`${B}/panel/kampanyalar/oduller/yeni`, { waitUntil: "networkidle2" });
  await owner.type("#rw-name", `Ödül ${run}`);
  await owner.type("#rw-cost", "500");
  await owner.type("#pv-value", "25");
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click("[data-testid=reward-submit]")]);
  const reward = await db.loyaltyReward.findFirst({ where: { tenantId: T, name: `Ödül ${run}` } });
  const member = await db.customer.create({ data: { tenantId: T, publicId: crypto.randomBytes(16).toString("base64url"), firstName: "Sadık", source: "QR_OPT_IN" }, select: { id: true } });
  state.customers.push(member.id);
  const account = await db.loyaltyAccount.create({ data: { tenantId: T, customerId: member.id, active: true } });
  await db.loyaltyLedger.create({ data: { tenantId: T, accountId: account.id, type: "ADJUSTMENT", points: 600, reason: "e2e" } });
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  await db.customerSession.create({ data: { tenantId: T, customerId: member.id, tokenHash: crypto.createHash("sha256").update(`masanova:customer-session:v1:${sessionToken}`).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) } });
  const loyal = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await loyal.setCookie({ name: "mn_customer", value: sessionToken, domain: "demo.localhost", path: "/", httpOnly: true });
  await fillCart(loyal, stable);
  const hasRewards = await waitFor(loyal, () => !!document.querySelector("[data-testid=reward-options]"), null, 10000);
  check("13. Tanınan sadakat üyesi sepeti açtı", reward?.pointsCost === 500 && reward.isActive && hasRewards);
  const shownBalance = await loyal.$eval("[data-testid=reward-balance]", (e) => Number(e.dataset.points)).catch(() => null);
  check("14. Uygun ödül ve bakiye (600 puan) görünür", shownBalance === 600 && !!(await loyal.$(`[data-reward="Ödül ${run}"] [data-testid=reward-use]:not([disabled])`)));
  await jsClick(loyal, `[data-reward="Ödül ${run}"] [data-testid=reward-use]`);
  await waitFor(loyal, () => !!document.querySelector("[data-testid=promotion-applied]"), null, 10000);
  const couponHidden = !(await loyal.$("[data-testid=coupon-input]"));
  const n2 = await send(loyal);
  const o2 = await db.order.findFirst({ where: { tenantId: T, orderNumber: n2 }, include: { promotion: true } });
  check("15. Ödül kullanıldı (tek promosyon: kupon alanı kapandı); indirim 25 ₺", couponHidden && o2?.promotion?.kind === "LOYALTY_REWARD" && o2.discountMinor === 2500 && o2.customerId === member.id);
  check("16. Puan tek kez düştü (600 → 100)", (await balance(member.id)) === 100 && (await db.loyaltyLedger.count({ where: { orderId: o2.id, type: "REDEEM" } })) === 1);
  await owner.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  const discountRow = await owner.$eval("[data-testid=panel-order-discount]", (e) => e.textContent).catch(() => "");
  await clickXp(owner, `.//button[normalize-space(.)="Reddet"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Reddet"]`);
  const rejected = await waitFor(owner, () => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("Reddedildi"), null, 15000);
  check("17. Personel ödüllü siparişi reddetti (panel indirim satırı gösteriyordu)", rejected && discountRow.includes("Sadakat ödülü"), discountRow);
  await sleep(500);
  check("18. Puan tam olarak bir kez iade edildi (100 → 600; tek geri alma satırı)", (await balance(member.id)) === 600 && (await db.loyaltyLedger.count({ where: { accountId: account.id, type: "REVERSAL" } })) === 1);

  // ── 19–22. Kampanya ───────────────────────────────────────────────────
  const mkC = async (email, consent) => {
    const c = await db.customer.create({ data: { tenantId: T, publicId: crypto.randomBytes(16).toString("base64url"), firstName: "Kampanya", email, emailNormalized: email, source: "QR_OPT_IN" }, select: { id: true } });
    state.customers.push(c.id);
    if (consent) await db.customerConsent.create({ data: { tenantId: T, customerId: c.id, type: "MARKETING_EMAIL", status: "GRANTED", source: "QR_OPT_IN", version: "e2e", grantedAt: new Date() } });
    return c.id;
  };
  const optedIn = await mkC(`izinli-${run.toLowerCase()}@e2e.masanovai.test`, true);
  await mkC(`izinsiz-${run.toLowerCase()}@e2e.masanovai.test`, false);
  await owner.goto(`${B}/panel/kampanyalar/yeni`, { waitUntil: "networkidle2" });
  await owner.type("#cm-name", `Kampanya ${run}`);
  await owner.select("#cm-channel", "EMAIL");
  await owner.select("#cm-coupon", c1.id);
  const consentsBefore = await db.customerConsent.count({ where: { tenantId: T } });
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click("[data-testid=campaign-submit]")]);
  const camp = await db.campaign.findFirst({ where: { tenantId: T, name: `Kampanya ${run}` } });
  check("19. Kampanya taslağı oluşturuldu (DRAFT, kupon bağlı, gönderim yok)", camp?.status === "DRAFT" && camp.couponId === c1.id && (await bodyText(owner)).includes(FIX));
  const read = () => owner.$eval("[data-testid=audience-preview]", (e) => ({ eligible: Number(e.dataset.eligible), noConsent: Number(e.dataset.noConsent), missing: Number(e.dataset.missingContact) }));
  const a1 = await read();
  check("20. E-posta kanalı seçildi; önizleme yalnız sayı (iletişim listesi yok)", camp?.channel === "EMAIL" && a1.eligible >= 1 && !(await bodyText(owner)).includes(`izinli-${run.toLowerCase()}`), JSON.stringify(a1));
  check("21. İzinsiz müşteri hariç (izin yok sayacında); kampanya izin üretmedi", a1.noConsent >= 2 && (await db.customerConsent.count({ where: { tenantId: T } })) === consentsBefore, JSON.stringify(a1));
  await db.customerConsent.create({ data: { tenantId: T, customerId: optedIn, type: "MARKETING_EMAIL", status: "REVOKED", source: "CUSTOMER_PROFILE", version: "e2e", revokedAt: new Date() } });
  await owner.reload({ waitUntil: "networkidle2" });
  const a2 = await read();
  check("22. Geri alınan izin anında düştü", a2.eligible === a1.eligible - 1 && a2.noConsent === a1.noConsent + 1, `${JSON.stringify(a1)} → ${JSON.stringify(a2)}`);
  await jsClick(owner, "[data-testid=campaign-ready]");
  await waitFor(owner, () => !!document.querySelector('[data-status="READY"]'), null, 10000);
  const ready = await db.campaign.findUnique({ where: { id: camp.id } });
  check("22b. “Hazır” işareti yalnızca SAYI anlık görüntüsü (gönderildi denmez)", ready.status === "READY" && ready.audienceSnapshot?.eligible === a2.eligible && (await bodyText(owner)).includes("gönderilmedi"));
  await owner.screenshot({ path: path.join(OUT, "campaign-1440.png"), fullPage: true });

  // ── 23–24. Yetkiler ──────────────────────────────────────────────────
  const waiter = await newPage({ width: 1280, height: 900 });
  await login(waiter, waiterCreds.email, waiterCreds.password);
  const w1 = await waiter.goto(`${B}/panel/kampanyalar`, { waitUntil: "networkidle2" });
  const w2 = await waiter.goto(`${B}/panel/kampanyalar/kuponlar`, { waitUntil: "networkidle2" });
  const w3 = await waiter.goto(`${B}/panel/kampanyalar/oduller/yeni`, { waitUntil: "networkidle2" });
  check("23. Garson: kampanya / kupon / ödül sayfaları 404", w1.status() === 404 && w2.status() === 404 && w3.status() === 404, `${w1.status()} ${w2.status()} ${w3.status()}`);
  const ap = await newPage({ width: 1440, height: 900 });
  await login(ap, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" });
  await clickXp(ap, `.//header//button[normalize-space(.)="Destek Modu"]`);
  await ap.waitForSelector("dialog[open]");
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle2" }), clickXp(ap, `.//dialog[@open]//button[normalize-space(.)="Destek modunu başlat"]`)]);
  await ap.goto(`${B}/panel/kampanyalar/kuponlar`, { waitUntil: "networkidle2" });
  const supButtons = await ap.$$("[data-testid=coupon-activate], [data-testid=coupon-deactivate], [data-testid=coupon-new]");
  const supNew = await ap.goto(`${B}/panel/kampanyalar/kuponlar/yeni`, { waitUntil: "networkidle2" });
  await ap.goto(`${B}/panel/kampanyalar/${camp.id}`, { waitUntil: "networkidle2" });
  check("24. Destek modu salt okunur: kupon düğmeleri yok, yeni kupon 404, kampanya formu yok", supButtons.length === 0 && supNew.status() === 404 && !(await ap.$("[data-testid=campaign-form]")) && !(await ap.$("[data-testid=campaign-ready]")), `${supButtons.length} ${supNew.status()}`);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" }).catch(() => null);
  await clickXp(ap, `.//button[normalize-space(.)="Destek modundan çık"]`).catch(() => null);

  // ── 25–28. Duyarlı görünüm ───────────────────────────────────────────
  check("25. 390px müşteri sepeti (kupon + ödül) taşmıyor", (await overflow(cust)) <= 0 && (await overflow(loyal)) <= 0);
  const ownerM = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(ownerM, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  let worst = 0;
  for (const url of ["/panel/kampanyalar", "/panel/kampanyalar/kuponlar", "/panel/kampanyalar/kuponlar/yeni", "/panel/kampanyalar/oduller", `/panel/kampanyalar/${camp.id}`]) {
    await ownerM.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    worst = Math.max(worst, await overflow(ownerM));
  }
  await ownerM.screenshot({ path: path.join(OUT, "panel-390.png"), fullPage: true });
  check("26. 390px panel: kampanyalar / kuponlar / ödüller / form / kampanya taşmıyor", worst <= 0, worst);
  let wide = 0;
  for (const url of ["/panel/kampanyalar/kuponlar", "/panel/kampanyalar/oduller", `/panel/kampanyalar/${camp.id}`, "/panel/analitik", `/panel/siparisler/${o2.id}`, `/panel/musteriler/${member.id}`]) {
    await owner.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    wide = Math.max(wide, await overflow(owner));
  }
  await owner.goto(`${B}/panel/analitik`, { waitUntil: "networkidle2" });
  const promoAnalytics = await owner.$eval("[data-testid=analytics-promotions]", (e) => e.innerText).catch(() => "");
  check("27. 1440px: analitikte brüt / indirim / net ve kullanım; müşteri ayrıntısında promosyon", promoAnalytics.includes("Toplam indirim") && promoAnalytics.includes("Net") && wide <= 0, wide);
  check("28. Yatay taşma yok", wide <= 0 && worst <= 0);
  check("29. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
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
    const left = T ? (await db.order.count({ where: { tenantId: T } })) + (await db.coupon.count({ where: { tenantId: T, createdAt: { gte: state.startedAt } } })) + (await db.loyaltyReward.count({ where: { tenantId: T, createdAt: { gte: state.startedAt } } })) + (await db.campaign.count({ where: { tenantId: T, createdAt: { gte: state.startedAt } } })) : 0;
    const back = T ? JSON.stringify(await db.loyaltySettings.findUnique({ where: { tenantId: T }, select: { enabled: true, minorPerPoint: true, earnOn: true } })) === JSON.stringify(state.loyaltyBefore) : true;
    check("30. Geçici veri temizlendi (sipariş, kupon, ödül, kampanya, müşteri, kullanıcı); sadakat ayarı geri alındı", left === 0 && back, `${left} ${back}`);
  } catch (e) {
    check("30. Geçici veri temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

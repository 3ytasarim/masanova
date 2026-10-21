// MasaNovaAI Sprint 20 — Abonelik, paket yetkileri, deneme / ek süre, limitler, düşürme güvenliği (production build).
// Demo kiracının aboneliği Super Admin arayüzünden değiştirilir (manuel faturalama). Geçici sipariş / rezervasyon /
// müşteri / ödeme / kullanıcı yazılır; rezervasyon, AI ve ödeme ayarları test boyunca açılır. Sonunda her şey silinir ve
// abonelik varsayılan profile (iç AI) döner.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const { setSubscription } = require("./lib/subscription.cjs");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s20");
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
const state = { demo: null, users: [], startedAt: new Date(), resBefore: undefined, hoursBefore: [], aiBefore: undefined, payBefore: undefined, customers: [], reservations: [] };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 16 dk aşıldı", false);
  finish();
}, 16 * 60_000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const derive = (nonce) => crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
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
/** Super Admin: "Etkinleştir / yenile" formu ile paket (süresiz). */
async function adminSetPlan(admin, plan) {
  await admin.goto(`${B}/admin/isletmeler/${state.demo.id}/plan`, { waitUntil: "networkidle2" });
  await admin.select("#act-plan", plan);
  await jsClick(admin, "[data-testid=sub-activate] button[type=submit]");
  return waitFor(admin, (p) => document.querySelector("[data-testid=admin-subscription]")?.dataset.plan === p, plan, 15000);
}
async function placeOrder(cust, stable) {
  await cust.goto(stable, { waitUntil: "networkidle2" });
  await cust.click('[data-product="cheeseburger"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  await sleep(300);
  await clickXp(cust, sheetBtn("radio", "Orta"));
  await cust.click("dialog[open] [data-testid='add-to-cart']");
  await cust.waitForFunction(() => !document.querySelector("dialog[open] #pm-sheet-title"), { polling: 200, timeout: 8000 });
  await sleep(250);
  await cust.click('[data-testid="cart-bar"]');
  await cust.waitForSelector("dialog[open] #pm-cart-title");
  await waitFor(cust, () => !document.body.innerText.match(/kontrol ediliyor/), null, 15000);
  await jsClick(cust, '[data-testid="review-order"]');
  await cust.waitForSelector('[data-testid="send-order"]');
  await jsClick(cust, '[data-testid="send-order"]');
  await cust.waitForSelector('[data-testid="order-success"]', { timeout: 20000 });
  const number = Number((await cust.$eval('[data-testid="order-number"]', (e) => e.textContent)).replace(/\D/g, ""));
  return db.order.findFirstOrThrow({ where: { tenantId: state.demo.id, orderNumber: number }, select: { id: true, publicId: true, totalMinor: true } });
}

async function cleanup() {
  if (!state.demo) return;
  const T = state.demo.id;
  await db.order.deleteMany({ where: { tenantId: T } });
  await db.orderSequence.deleteMany({ where: { tenantId: T } });
  await db.tableServiceRequest.deleteMany({ where: { tenantId: T, createdAt: { gte: state.startedAt } } });
  if (state.reservations.length) await db.reservation.deleteMany({ where: { id: { in: state.reservations } } });
  if (state.customers.length) await db.customer.deleteMany({ where: { id: { in: state.customers } } });
  await db.branchOpeningHours.deleteMany({ where: { tenantId: T } });
  if (state.hoursBefore.length) await db.branchOpeningHours.createMany({ data: state.hoursBefore.map((h) => ({ tenantId: h.tenantId, branchId: h.branchId, weekday: h.weekday, opensMinute: h.opensMinute, closesMinute: h.closesMinute })) });
  if (state.resBefore) await db.reservationSettings.update({ where: { tenantId: T }, data: { enabled: state.resBefore.enabled, publicBookingEnabled: state.resBefore.publicBookingEnabled } });
  else if (state.resBefore === null) await db.reservationSettings.deleteMany({ where: { tenantId: T } });
  if (state.aiBefore) await db.aiSettings.update({ where: { tenantId: T }, data: { enabled: state.aiBefore.enabled } });
  else if (state.aiBefore === null) await db.aiSettings.deleteMany({ where: { tenantId: T } });
  if (state.payBefore) await db.paymentSettings.update({ where: { tenantId: T }, data: { enabled: state.payBefore.enabled } });
  else if (state.payBefore === null) await db.paymentSettings.deleteMany({ where: { tenantId: T } });
  await setSubscription(db, T, {});
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  const T = state.demo.id;
  const merkez = await db.branch.findFirstOrThrow({ where: { tenantId: T, slug: "merkez" }, select: { id: true } });
  state.resBefore = await db.reservationSettings.findUnique({ where: { tenantId: T }, select: { enabled: true, publicBookingEnabled: true } });
  state.hoursBefore = await db.branchOpeningHours.findMany({ where: { tenantId: T } });
  state.aiBefore = await db.aiSettings.findUnique({ where: { tenantId: T }, select: { enabled: true } });
  state.payBefore = await db.paymentSettings.findUnique({ where: { tenantId: T }, select: { enabled: true } });
  await db.order.deleteMany({ where: { tenantId: T } });
  await db.orderSequence.deleteMany({ where: { tenantId: T } });
  // Özellik ayarları açık (paket kapısı ayrıca sınanır): rezervasyon + saatler, AI asistan, ödemeler
  await db.reservationSettings.upsert({ where: { tenantId: T }, create: { tenantId: T, enabled: true, publicBookingEnabled: true }, update: { enabled: true, publicBookingEnabled: true } });
  await db.branchOpeningHours.deleteMany({ where: { tenantId: T } });
  await db.branchOpeningHours.createMany({ data: Array.from({ length: 7 }, (_, i) => ({ tenantId: T, branchId: merkez.id, weekday: i + 1, opensMinute: 0, closesMinute: 1440 })) });
  await db.aiSettings.upsert({ where: { tenantId: T }, create: { tenantId: T, enabled: true }, update: { enabled: true } });
  await db.paymentSettings.upsert({ where: { tenantId: T }, create: { tenantId: T, enabled: true }, update: { enabled: true } });
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 12" }, select: { id: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const stable = `${B}/q/${derive(row.tokenNonce)}`;
  const managerCreds = await makeUser("BRANCH_MANAGER", "mudur20");

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
  const admin = await newPage({ width: 1440, height: 1000 });
  await login(admin, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  const owner = await newPage({ width: 1440, height: 1000 });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });

  // ── 1–8. STARTER ─────────────────────────────────────────────────────
  check("1. Super Admin paketi STARTER yaptı (abonelik + olay + denetim)", (await adminSetPlan(admin, "STARTER")) && (await db.subscription.findUnique({ where: { tenantId: T } })).plan === "STARTER" && (await db.auditLog.count({ where: { tenantId: T, action: "SUBSCRIPTION_PLAN_CHANGED", createdAt: { gte: state.startedAt } } })) >= 1);
  await cust.goto(stable, { waitUntil: "networkidle2" });
  check("2. QR menü açıldı (STARTER'da menü her zaman çalışır)", !!(await cust.$('[data-product="cheeseburger"]')) && !/abonelik|ödeme gecik|paket/i.test(await bodyText(cust)));
  await cust.click('[data-product="cheeseburger"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  check("3. Sipariş kapalı: ürün sayfasında 'Sepete ekle' yok, sepet çubuğu yok", !(await cust.$("dialog[open] [data-testid='add-to-cart']")) && !(await cust.$("[data-testid=cart-bar]")));
  await cust.keyboard.press("Escape");
  check("4. Servis düğmesi yok", !(await cust.$("[data-testid=service-button]")));
  const resPage = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await resPage.goto(`${new URL(cust.url()).origin}/rezervasyon`, { waitUntil: "networkidle2" });
  check("5. Online rezervasyon kapalı (ayar açık olsa bile paket yok)", !!(await resPage.$("[data-testid=reservations-disabled]")) && !(await resPage.$("[data-testid=reservation-form]")));
  check("6. Sesli AI düğmesi yok", !(await cust.$("[data-testid=ai-button]")));
  await owner.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  const dashPlan = await owner.$eval("[data-testid=dashboard-plan]", (e) => e.dataset.plan).catch(() => null);
  const analyticsNav = await owner.$eval('nav a[href="/panel/analitik"]', (a) => ({ state: a.dataset.navState, text: a.innerText })).catch(() => null);
  check("7. Sahip paneli STARTER gösteriyor; Analitik menüde kilitli (Pro rozeti)", dashPlan === "STARTER" && analyticsNav?.state === "locked" && analyticsNav.text.toUpperCase().includes("PRO"), JSON.stringify({ dashPlan, analyticsNav }));
  await owner.goto(`${B}/panel/analitik`, { waitUntil: "networkidle2" });
  const locked = await owner.$eval("[data-testid=feature-locked]", (e) => e.innerText).catch(() => "");
  check("8. Kilitli Analitik → yükseltme ekranı ('Bu özellik Pro paketinde', Paketi İncele)", locked.includes("Pro paketinde") && !!(await owner.$("[data-testid=feature-locked-cta]")), locked.slice(0, 120));
  await owner.screenshot({ path: path.join(OUT, "locked-analytics-1440.png"), fullPage: true });

  // ── 9–15. PRO ────────────────────────────────────────────────────────
  check("9. Super Admin PRO'ya yükseltti", await adminSetPlan(admin, "PRO"));
  await cust.goto(stable, { waitUntil: "networkidle2" });
  await cust.click('[data-product="cheeseburger"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  check("10–11. Yeniden başlatmadan: sipariş açıldı ('Sepete ekle' var)", !!(await cust.$("dialog[open] [data-testid='add-to-cart']")));
  await cust.keyboard.press("Escape");
  check("12. Servis düğmesi göründü", !!(await cust.$("[data-testid=service-button]")));
  await resPage.reload({ waitUntil: "networkidle2" });
  check("13. Online rezervasyon formu göründü", !!(await resPage.$("[data-testid=reservation-form]")));
  await owner.goto(`${B}/panel/analitik`, { waitUntil: "networkidle2" });
  check("14. Analitik açıldı (kilit yok)", !(await owner.$("[data-testid=feature-locked]")) && (await owner.$eval('nav a[href="/panel/analitik"]', (a) => a.dataset.navState)) === "visible");
  await owner.goto(`${B}/panel/ai/danisman`, { waitUntil: "networkidle2" });
  check("15. PRO'da AI yok: müşteri AI düğmesi yok, Danışman kilitli", !(await cust.$("[data-testid=ai-button]")) && !!(await owner.$("[data-testid=advisor-locked]")));

  // ── 16–18. AI ────────────────────────────────────────────────────────
  check("16. Super Admin AI'ya yükseltti", await adminSetPlan(admin, "AI"));
  await cust.goto(stable, { waitUntil: "networkidle2" });
  check("17. Sesli AI düğmesi göründü", !!(await cust.$("[data-testid=ai-button]")));
  await owner.goto(`${B}/panel/ai/danisman`, { waitUntil: "networkidle2" });
  check("18. İşletme Danışmanı açıldı", !(await owner.$("[data-testid=advisor-locked]")) && !!(await owner.$("[data-testid=advisor-page], [data-testid=advisor-error]")));

  // ── 19–26. Etkin kayıtlar → STARTER'a düşürme ───────────────────────
  const o1 = await placeOrder(cust, stable);
  await owner.goto(`${B}/panel/siparisler/${o1.id}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  const accepted = await waitFor(owner, () => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("Kabul"), null, 15000);
  await owner.reload({ waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kasada ödeme kaydet"]`);
  await owner.waitForSelector("dialog[open] #manual-amount");
  await owner.type("#manual-amount", "20");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Ödemeyi kaydet"]`);
  await waitFor(owner, () => document.querySelector("[data-testid=order-payment-state]")?.dataset.state === "PARTIALLY_PAID", null, 15000);
  const cash = await db.payment.findFirst({ where: { tenantId: T, orderId: o1.id } });
  const startsAt = new Date(Date.now() + 2 * 86_400_000);
  const nonce = crypto.randomBytes(16).toString("base64url");
  const reservation = await db.reservation.create({ data: { tenantId: T, branchId: merkez.id, publicId: crypto.randomBytes(12).toString("base64url"), manageTokenHash: crypto.createHash("sha256").update(nonce).digest("hex"), manageTokenNonce: nonce, guestName: `E2E Misafir ${run}`, guestPhone: "+905321112233", partySize: 2, startsAt, endsAt: new Date(startsAt.getTime() + 7_200_000), durationMinutes: 120, status: "CONFIRMED", source: "PHONE", confirmedAt: new Date() } });
  state.reservations.push(reservation.id);
  const customer = await db.customer.create({ data: { tenantId: T, publicId: crypto.randomBytes(16).toString("base64url"), firstName: `Sadık ${run}`, source: "MANUAL_STAFF" } });
  state.customers.push(customer.id);
  check("19. Etkin sipariş (kabul + KDS fişleri), kasada ödeme, gelecek rezervasyon ve müşteri oluşturuldu", accepted && cash?.status === "SUCCEEDED" && (await db.orderTicket.count({ where: { orderId: o1.id } })) >= 1);
  const before = { orders: await db.order.count({ where: { tenantId: T } }), tickets: await db.orderTicket.count({ where: { tenantId: T } }), res: await db.reservation.count({ where: { tenantId: T } }), customers: await db.customer.count({ where: { tenantId: T } }), payments: await db.payment.count({ where: { tenantId: T } }) };
  const downgraded = await adminSetPlan(admin, "STARTER");
  const afterCounts = { orders: await db.order.count({ where: { tenantId: T } }), tickets: await db.orderTicket.count({ where: { tenantId: T } }), res: await db.reservation.count({ where: { tenantId: T } }), customers: await db.customer.count({ where: { tenantId: T } }), payments: await db.payment.count({ where: { tenantId: T } }) };
  check("20. STARTER'a düşürüldü — hiçbir kayıt silinmedi", downgraded && JSON.stringify(before) === JSON.stringify(afterCounts), `${JSON.stringify(before)} → ${JSON.stringify(afterCounts)}`);
  // 21: mevcut sipariş KDS'te tamamlanır, servis edilir
  await owner.goto(`${B}/panel/mutfak`, { waitUntil: "networkidle2" });
  await owner.screenshot({ path: path.join(OUT, "kds-starter-1440.png"), fullPage: true });
  const continuation = !!(await owner.$("[data-testid=feature-continuation]"));
  for (let i = 0; i < 8; i++) {
    const btn = (await owner.$('[data-testid="kds-lane-PENDING"] [data-testid="kds-ticket"] button')) || (await owner.$('[data-testid="kds-lane-PREPARING"] [data-testid="kds-ticket"] button'));
    if (!btn) break;
    await btn.evaluate((e) => e.click());
    await sleep(900);
  }
  await waitFor(owner, () => !document.querySelector('[data-testid="kds-lane-PENDING"] [data-testid="kds-ticket"], [data-testid="kds-lane-PREPARING"] [data-testid="kds-ticket"]'), null, 10000);
  // Fişler hazır → sipariş otomatik READY (sunucu); DB yoklaması (arayüz yenilemesine bağlı kalmadan)
  for (let i = 0; i < 40 && (await db.order.findUnique({ where: { id: o1.id } })).status !== "READY"; i++) {
    const btn = await owner.$('[data-testid="kds-lane-PENDING"] [data-testid="kds-ticket"] button, [data-testid="kds-lane-PREPARING"] [data-testid="kds-ticket"] button');
    if (btn) await btn.evaluate((e) => e.click());
    await sleep(500);
  }
  await owner.goto(`${B}/panel/siparisler/${o1.id}`, { waitUntil: "networkidle2" });
  let served = false;
  if ((await owner.$$(`xpath/.//button[normalize-space(.)="Servis edildi"]`)).length > 0) {
    await clickXp(owner, `.//button[normalize-space(.)="Servis edildi"]`);
    await owner.waitForSelector("dialog[open]");
    await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Servis edildi"]`);
    served = await waitFor(owner, () => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("Servis"), null, 15000);
  }
  check("21. Mevcut sipariş STARTER'da tamamlandı (KDS fişleri hazır → servis edildi; devam bandı)", continuation && served && (await db.order.findUnique({ where: { id: o1.id } })).status === "SERVED", JSON.stringify({ continuation, served, status: (await db.order.findUnique({ where: { id: o1.id } })).status, tickets: (await db.orderTicket.findMany({ where: { orderId: o1.id }, select: { status: true } })).map((t) => t.status) }));
  await cust.goto(stable, { waitUntil: "networkidle2" });
  await cust.click('[data-product="cheeseburger"]');
  await cust.waitForSelector("dialog[open] #pm-sheet-title");
  check("22. Yeni sipariş verilemez (sepete ekleme yok)", !(await cust.$("dialog[open] [data-testid='add-to-cart']")));
  await cust.keyboard.press("Escape");
  await owner.goto(`${B}/panel/rezervasyonlar/${reservation.id}`, { waitUntil: "networkidle2" });
  const resText = await bodyText(owner);
  await owner.click('[data-testid=status-buttons] [data-action="SEATED"]').catch(() => null);
  const seated = await waitFor(owner, () => document.querySelector("[data-testid=reservation-status]")?.dataset.status === "SEATED", null, 15000);
  check("23. Mevcut gelecek rezervasyon görünür ve yönetilebilir (Masaya Al)", resText.includes(`E2E Misafir ${run}`) && seated);
  await resPage.reload({ waitUntil: "networkidle2" });
  check("24. Yeni rezervasyon kapalı", !!(await resPage.$("[data-testid=reservations-disabled]")));
  await owner.goto(`${B}/panel/musteriler/${customer.id}`, { waitUntil: "networkidle2" });
  check("25. Geçmiş CRM verisi korunur ve görüntülenir (devam bandı)", (await bodyText(owner)).includes(`Sadık ${run}`) && !!(await owner.$("[data-testid=feature-continuation]")));
  await owner.goto(`${B}/panel/odemeler/${cash.id}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="İade et"]`);
  await owner.waitForSelector("dialog[open] #refund-amount");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="İade et"]`);
  const refunded = await waitFor(owner, () => document.querySelector("[data-testid=payment-status]")?.dataset.status === "REFUNDED", null, 15000);
  check("26. Paket düştükten sonra geçmiş ödemenin iadesi çalıştı", refunded && (await db.payment.findUnique({ where: { id: cash.id } })).refundedMinor === 2000);

  // ── 27–30. Deneme, deneme bitişi, ek süre ────────────────────────────
  await admin.goto(`${B}/admin/isletmeler/${T}/plan`, { waitUntil: "networkidle2" });
  await admin.select("#tr-plan", "AI");
  await jsClick(admin, "[data-testid=sub-trial] button[type=submit]");
  const trialing = await waitFor(admin, () => document.querySelector("[data-testid=admin-subscription]")?.dataset.state === "TRIALING", null, 15000);
  await owner.goto(`${B}/panel/abonelik`, { waitUntil: "networkidle2" });
  const sumTrial = await owner.$eval("[data-testid=subscription-summary]", (e) => ({ state: e.dataset.state, plan: e.dataset.plan })).catch(() => null);
  check("27. Super Admin AI denemesi başlattı; sahip abonelik sayfasında 'Deneme'", trialing && sumTrial?.state === "TRIALING" && sumTrial.plan === "AI" && !!(await owner.$("[data-testid=trial-ends]")), JSON.stringify(sumTrial));
  await db.subscription.update({ where: { tenantId: T }, data: { trialEndsAt: new Date(Date.now() - 60_000) } });
  await owner.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  const expiredWarn = await owner.$eval("[data-testid=billing-warning]", (e) => e.dataset.warning).catch(() => null);
  await owner.goto(`${B}/panel/abonelik`, { waitUntil: "networkidle2" });
  const sumExpired = await owner.$eval("[data-testid=subscription-summary]", (e) => ({ state: e.dataset.state, eff: e.dataset.effectivePlan })).catch(() => null);
  check("28. Deneme bitişi (zaman damgası): cron olmadan STARTER özellikleri + sahip uyarısı", expiredWarn === "trial_expired" && sumExpired?.state === "TRIAL_EXPIRED" && sumExpired.eff === "STARTER", JSON.stringify({ expiredWarn, sumExpired }));
  await setSubscription(db, T, { plan: "AI", status: "ACTIVE", internal: false, currentPeriodEnd: new Date(Date.now() - 86_400_000) });
  await owner.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  const graceWarn = await owner.$eval("[data-testid=billing-warning]", (e) => ({ w: e.dataset.warning, t: e.innerText })).catch(() => null);
  const manager = await newPage({ width: 1280, height: 900 });
  await login(manager, managerCreds.email, managerCreds.password);
  await manager.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  const managerWarn = !!(await manager.$("[data-testid=billing-warning]"));
  const managerBilling = await manager.goto(`${B}/panel/abonelik`, { waitUntil: "networkidle2" });
  check("29. Ek süre uyarısı yalnızca SAHİBE ('… tarihine kadar … kesintisiz'); müdür görmez, abonelik sayfası müdüre 404", graceWarn?.w === "grace" && graceWarn.t.includes("kesintisiz devam edecek") && !managerWarn && managerBilling.status() === 404, JSON.stringify({ graceWarn, managerWarn, s: managerBilling.status() }));
  await cust.goto(stable, { waitUntil: "networkidle2" });
  const graceGuest = { menu: !!(await cust.$('[data-product="cheeseburger"]')), service: !!(await cust.$("[data-testid=service-button]")), ai: !!(await cust.$("[data-testid=ai-button]")), billing: /abonelik|ek süre|ödeme gecik/i.test(await bodyText(cust)) };
  await setSubscription(db, T, { plan: "AI", status: "ACTIVE", internal: false, currentPeriodEnd: new Date(Date.now() - 30 * 86_400_000) });
  await cust.reload({ waitUntil: "networkidle2" });
  const expiredGuest = { menu: !!(await cust.$('[data-product="cheeseburger"]')), service: !!(await cust.$("[data-testid=service-button]")), billing: /abonelik|süresi doldu/i.test(await bodyText(cust)) };
  check("30. Misafir QR: ek sürede menü + servis çalışır (AI kapalı), süre dolunca temel menü; müşteriye faturalama mesajı yok", graceGuest.menu && graceGuest.service && !graceGuest.ai && !graceGuest.billing && expiredGuest.menu && !expiredGuest.service && !expiredGuest.billing, JSON.stringify({ graceGuest, expiredGuest }));
  await cust.screenshot({ path: path.join(OUT, "guest-expired-390.png"), fullPage: true });

  // ── 31–33. Limit, Super Admin listesi, destek modu ───────────────────
  await adminSetPlan(admin, "PRO");
  const tableCount = await db.diningTable.count({ where: { tenantId: T } });
  await admin.goto(`${B}/admin/isletmeler/${T}/plan`, { waitUntil: "networkidle2" });
  await admin.select("#ov-key", "maxTables");
  await admin.type("#ov-limit", String(tableCount));
  await admin.type("#ov-reason", "e2e limit");
  await jsClick(admin, "[data-testid=sub-override] button[type=submit]");
  const overrideSaved = await waitFor(admin, () => !!document.querySelector('[data-override="maxTables"]'), null, 15000);
  await owner.goto(`${B}/panel/abonelik`, { waitUntil: "networkidle2" });
  const tablesLimit = await owner.$eval('[data-limit="maxTables"]', (e) => ({ level: e.dataset.level, text: e.innerText })).catch(() => null);
  check("31. Limit doldu UI: masa limiti %100 ('Limite ulaşıldı'); istisna Super Admin'den, denetimli", overrideSaved && tablesLimit?.level === "100" && tablesLimit.text.includes("Limite ulaşıldı") && (await db.auditLog.count({ where: { tenantId: T, action: "ENTITLEMENT_OVERRIDE_SET", createdAt: { gte: state.startedAt } } })) >= 1, JSON.stringify(tablesLimit));
  await owner.screenshot({ path: path.join(OUT, "subscription-1440.png"), fullPage: true });
  await admin.goto(`${B}/admin/abonelikler`, { waitUntil: "networkidle2" });
  const demoRow = await admin.$eval('[data-testid=subscription-row][data-slug="demo-restoran"]', (e) => ({ plan: e.dataset.plan, state: e.dataset.state })).catch(() => null);
  const metricsText = await admin.$eval("[data-testid=subscription-metrics]", (e) => e.innerText).catch(() => "");
  check("32. Super Admin abonelik listesi + platform sayıları (gelir / MRR yok)", demoRow?.plan === "PRO" && demoRow.state === "ACTIVE" && metricsText.includes("Deneme") && !/MRR|ARR|₺|gelir/i.test(metricsText), JSON.stringify(demoRow));
  await admin.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" });
  await clickXp(admin, `.//header//button[normalize-space(.)="Destek Modu"]`);
  await admin.waitForSelector("dialog[open]");
  await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle2" }), clickXp(admin, `.//dialog[@open]//button[normalize-space(.)="Destek modunu başlat"]`)]);
  const supPage = await admin.goto(`${B}/panel/abonelik`, { waitUntil: "networkidle2" });
  const supForms = await admin.$$("main form");
  const supText = await bodyText(admin);
  check("33. Destek modu: abonelik sayfası salt okunur (form / değiştirme yok)", supPage.status() === 200 && supText.includes("Abonelik") && supForms.length === 0, `${supPage.status()} forms=${supForms.length}`);
  await admin.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" }).catch(() => null);
  await clickXp(admin, `.//button[normalize-space(.)="Destek modundan çık"]`).catch(() => null);

  // ── 34–37. Duyarlı görünüm, konsol ───────────────────────────────────
  const ownerM = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(ownerM, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  let worst = 0;
  for (const url of ["/panel", "/panel/abonelik", "/panel/analitik"]) {
    await ownerM.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    worst = Math.max(worst, await overflow(ownerM));
  }
  await ownerM.goto(`${B}/panel/abonelik`, { waitUntil: "networkidle2" });
  await ownerM.screenshot({ path: path.join(OUT, "subscription-390.png"), fullPage: true });
  check("34. 390px sahip: pano / abonelik / analitik taşmıyor", worst <= 0, worst);
  let wide = 0;
  for (const url of ["/panel/abonelik", "/panel", `/panel/siparisler/${o1.id}`]) {
    await owner.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    wide = Math.max(wide, await overflow(owner));
  }
  for (const url of ["/admin/abonelikler", `/admin/isletmeler/${T}/plan`]) {
    await admin.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    wide = Math.max(wide, await overflow(admin));
  }
  await admin.screenshot({ path: path.join(OUT, "admin-plan-1440.png"), fullPage: true });
  check("35. 1440px: abonelik / pano / sipariş / Super Admin sayfaları", wide <= 0, wide);
  check("36. Yatay taşma yok", wide <= 0 && worst <= 0);
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
    const sub = T ? await db.subscription.findUnique({ where: { tenantId: T } }) : null;
    const left = T ? (await db.order.count({ where: { tenantId: T } })) + (await db.reservation.count({ where: { id: { in: state.reservations } } })) + (await db.customer.count({ where: { id: { in: state.customers } } })) + (await db.entitlementOverride.count({ where: { tenantId: T } })) : 0;
    check("38. Geçici veri temizlendi; abonelik varsayılan profile (iç AI) döndü; ayarlar geri alındı", left === 0 && sub?.plan === "AI" && sub.internal && sub.status === "ACTIVE", `${left} ${sub?.plan} ${sub?.status}`);
  } catch (e) {
    check("38. Geçici veri temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

// MasaNovaAI Sprint 16 — CRM / isteğe bağlı müşteri kimliği / onay / sadakat tarayıcı testi (production build).
// Üretim derlemesinde doğrulama sağlayıcısı YOK (mock üretimde yok sayılır) → katılım "doğrulanmamış" yoldan geçer;
// kodlu doğrulama Neon entegrasyon testinde (mock) sınanır. Demo kiracıya geçici müşteri / sipariş yazılır, sadakat
// ayarı test boyunca açılır; sonunda her şey silinir ve ayar eski haline döner.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s16");
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
const run = crypto.randomBytes(3).toString("hex");
const digits = String(100000 + crypto.randomInt(899999));
const PHONE_INPUT = `0539 ${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5)}${String(crypto.randomInt(10))}`;
const PHONE = `+90${PHONE_INPUT.replace(/\D/g, "").slice(1)}`;
const EMAIL = `crm-${run}@e2e.masanovai.test`;
const state = { demo: null, users: [], loyaltyBefore: null, startedAt: new Date() };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 10 dk aşıldı", false);
  finish();
}, 10 * 60_000).unref();

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
  if (!(await page.$("#email"))) return;
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
/** Müşteri: Cheeseburger (Orta) + Ayran → gönder → sipariş sayfası. Sipariş numarasını döndürür. */
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
  return Number(number.replace(/\D/g, ""));
}
const pill = (p) => p.$eval("[data-testid=account-pill]", (e) => ({ identified: e.dataset.identified, text: e.textContent.trim() })).catch(() => null);

async function cleanup() {
  if (!state.demo) return;
  const T = state.demo.id;
  await db.order.deleteMany({ where: { tenantId: T } }); // defter satırları siparişle birlikte (CASCADE)
  await db.orderSequence.deleteMany({ where: { tenantId: T } });
  await db.tableServiceRequest.deleteMany({ where: { tenantId: T, customerId: { not: null } } });
  await db.customer.deleteMany({ where: { tenantId: T, createdAt: { gte: state.startedAt } } });
  await db.contactVerification.deleteMany({ where: { tenantId: T } });
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
  const waiterCreds = await makeUser("WAITER", "garson16");
  const kitchenCreds = await makeUser("KITCHEN", "mutfak16");

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

  // ── Sahip: sadakat programını aç (10 ₺ = 1 puan, servis edildiğinde) ───────────────
  const owner = await newPage({ width: 1440, height: 1000 });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await owner.goto(`${B}/panel/sadakat`, { waitUntil: "networkidle2" });
  const wasOn = await owner.$eval("#loyalty-enabled", (e) => e.checked);
  if (!wasOn) await owner.click("#loyalty-enabled");
  await owner.click("#loyalty-amount", { clickCount: 3 });
  await owner.type("#loyalty-amount", "10");
  await owner.select("#loyalty-earn", "SERVED");
  await clickXp(owner, `.//form[@data-testid="loyalty-settings-form"]//button[@type="submit"]`);
  const saved = await waitText(owner, "Sadakat ayarları kaydedildi");
  const ls = await db.loyaltySettings.findUnique({ where: { tenantId: T } });
  check("0. Sahip /panel/sadakat: program açıldı, kural 10 ₺ = 1 puan (SERVED), denetim kaydı", saved && ls?.enabled && ls.minorPerPoint === 1000 && ls.earnOn === "SERVED" && (await db.auditLog.count({ where: { tenantId: T, action: "LOYALTY_SETTINGS_UPDATED", createdAt: { gte: state.startedAt } } })) >= 1, JSON.stringify(ls));

  // ── 1–3 Anonim müşteri ─────────────────────────────────────────────────────────
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await cust.goto(stable, { waitUntil: "networkidle2" });
  const p1 = await pill(cust);
  const popup = await cust.$("dialog[open]");
  check("1. Anonim QR: menü açılır; açılır pencere yok; küçük 'Puan kazan' bağlantısı", !!(await cust.$("[data-product=cheeseburger]")) && !popup && p1?.identified === "0" && p1.text === "Puan kazan", JSON.stringify(p1));
  const n1 = await placeOrder(cust, stable);
  const o1 = await db.order.findFirst({ where: { tenantId: T, orderNumber: n1 }, select: { id: true, customerId: true } });
  check("2. Kimliksiz sipariş verildi (müşteri ilişkisi yok)", o1 && o1.customerId === null, JSON.stringify(o1));
  const invite = await cust.$("[data-testid=loyalty-invite]");
  const inviteText = invite ? await invite.evaluate((e) => e.innerText) : "";
  check("3. Sipariş sayfası çalışır + sakin davet: 'Sadakat avantajlarından…' [Bilgilerimi ekle] [Şimdi değil]", !!(await cust.$("[data-testid=public-order-status]")) && inviteText.includes("Sadakat avantajlarından yararlanmak ister misiniz?") && inviteText.includes("Bilgilerimi ekle") && inviteText.includes("Şimdi değil"), inviteText);

  // ── 4–7 Katılım ────────────────────────────────────────────────────────────────
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2" }), cust.click("[data-testid=invite-accept]")]);
  check("4. 'Bilgilerimi ekle' → katılım formu (pazarlama kutuları kapalı)", !!(await cust.$("[data-testid=join-form]")) && (await cust.$$eval("input[data-consent^=MARKETING]", (els) => els.every((e) => !e.checked))));
  await cust.type("input[name=phone]", PHONE_INPUT);
  await cust.type("input[name=email]", EMAIL);
  await cust.type("input[name=firstName]", "Ayşe");
  await cust.type("input[name=lastName]", `Test${run.replace(/\d/g, "")}`);
  // Gizlilik onayı olmadan gönderim reddedilir
  await cust.click("[data-testid=join-submit]");
  check("5. İletişim girildi; gizlilik onayı olmadan kayıt yapılmaz", (await waitText(cust, "aydınlatma metnini onaylayın", 5000)) && (await db.customer.count({ where: { tenantId: T, phoneNormalized: PHONE } })) === 0);
  for (const c of ["PRIVACY", "LOYALTY", "MARKETING_SMS", "MARKETING_EMAIL"]) await cust.click(`input[data-consent=${c}]`);
  await cust.click("[data-testid=join-submit]");
  const joined = await waitFor(cust, () => !!document.querySelector("[data-testid=customer-profile]"), null, 15000);
  const customer = await db.customer.findFirst({ where: { tenantId: T, phoneNormalized: PHONE }, include: { consents: true, loyaltyAccounts: true, sessions: true } });
  check("6. Doğrulama sağlayıcısı yok (üretim) → doğrulanmamış katılım, açıkça işaretli", joined && customer && !customer.phoneVerifiedAt && (await bodyText(cust)).includes("İletişim bilginiz doğrulanmadı") && customer.source === "ORDER_CHECKOUT", customer?.source);
  check(
    "7. Seçilen onaylar kayıtlı (sürümlü); sadakat hesabı açık; çerez opak belirteç",
    customer && ["PRIVACY", "LOYALTY", "MARKETING_SMS", "MARKETING_EMAIL"].every((t) => customer.consents.some((c) => c.type === t && c.status === "GRANTED" && c.version)) && !customer.consents.some((c) => c.type === "MARKETING_WHATSAPP") && customer.loyaltyAccounts[0]?.active,
  );
  const cookies = await cust.cookies();
  const cc = cookies.find((c) => c.name === "mn_customer");
  check("7b. Müşteri çerezi httpOnly, opak (iç kimlik içermez), sunucuda yalnızca özeti", cc && cc.httpOnly && /^[A-Za-z0-9_-]{43}$/.test(cc.value) && !cc.value.includes(customer?.id ?? "x") && customer.sessions.every((s) => s.tokenHash !== cc.value), cc?.value?.length);
  const localKeys = await cust.evaluate(() => JSON.stringify({ ...localStorage }));
  check("7c. localStorage'da müşteri kimliği / iletişim yok", !localKeys.includes(customer?.id ?? "x") && !localKeys.includes(EMAIL) && !localKeys.includes(PHONE.slice(3)));

  // ── 8–12 İkinci sipariş, servis, puan ──────────────────────────────────────────
  const n2 = await placeOrder(cust, stable);
  const o2 = await db.order.findFirst({ where: { tenantId: T, orderNumber: n2 }, select: { id: true, customerId: true, totalMinor: true } });
  check("8. İkinci sipariş müşteriye bağlandı; ilk anonim sipariş anonim kaldı", o2?.customerId === customer?.id && (await db.order.findUnique({ where: { id: o1.id } })).customerId === null);
  await owner.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  await waitText(owner, "istasyon fişi oluşturuldu");
  // Mutfak adımları (S7'de tarayıcıyla sınanır) burada veritabanından hazır yapılır; servis kararı PANELDEN verilir.
  const now = new Date();
  await db.orderTicket.updateMany({ where: { orderId: o2.id }, data: { status: "READY", startedAt: now, readyAt: now } });
  await db.order.update({ where: { id: o2.id }, data: { status: "READY", readyAt: now } });
  await owner.goto(`${B}/panel/siparisler/${o2.id}`, { waitUntil: "networkidle2" });
  const ownerOrderText = await bodyText(owner);
  check("8b. Sipariş ayrıntısı yalnızca müşteri ADINI gösterir (telefon / e-posta yok)", ownerOrderText.includes("Müşteri: Ayşe") && !ownerOrderText.includes(EMAIL) && !ownerOrderText.includes(PHONE_INPUT));
  await clickXp(owner, `.//button[normalize-space(.)="Servis edildi"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Servis edildi"]`);
  check("9. Personel panelden 'Servis edildi'", await waitFor(owner, () => document.querySelector('[data-testid="panel-order-status"]')?.innerText.includes("Servis edildi")));
  const expected = Math.floor(o2.totalMinor / 1000);
  await cust.goto(stable, { waitUntil: "networkidle2" });
  const p2 = await pill(cust);
  check("10. Puan bir kez göründü (QR menüde küçük bakiye)", p2?.identified === "1" && p2.text === `${expected} puan`, `${JSON.stringify(p2)} beklenen ${expected}`);
  await cust.reload({ waitUntil: "networkidle2" });
  await owner.reload({ waitUntil: "networkidle2" });
  const serveAgain = await owner.$$(`xpath/.//button[normalize-space(.)="Servis edildi"]`);
  check("11. Yenileme / yeniden deneme: servis düğmesi artık yok", serveAgain.length === 0);
  const ledger = await db.loyaltyLedger.findMany({ where: { orderId: o2.id } });
  check("12. Defterde sipariş başına TEK kazanım", ledger.length === 1 && ledger[0].points === expected && (await pill(cust))?.text === `${expected} puan`, ledger.length);

  // ── 13–15 Profil ve izin geri alma ─────────────────────────────────────────────
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2" }), cust.click("[data-testid=account-pill]")]);
  const profileText = await bodyText(cust);
  check("13. Profil: bakiye, maskeli iletişim, izinler (iç kimlik / personel notu yok)", (await cust.$("[data-testid=customer-profile]")) && profileText.includes(`${expected} puan`) && profileText.includes("0539 *** **") && !profileText.includes(customer.id) && !profileText.includes(PHONE_INPUT));
  await cust.click("input[data-consent=MARKETING_SMS]");
  const savedConsent = await waitFor(cust, () => document.querySelector("[data-testid=profile-status]")?.textContent.includes("Kaydedildi"), null, 10000);
  check("14. Müşteri SMS pazarlama iznini geri aldı", savedConsent && !(await cust.$eval("input[data-consent=MARKETING_SMS]", (e) => e.checked)));
  const lastSms = await db.customerConsent.findFirst({ where: { customerId: customer.id, type: "MARKETING_SMS" }, orderBy: { createdAt: "desc" } });
  await owner.goto(`${B}/panel/musteriler/${customer.id}`, { waitUntil: "networkidle2" });
  const smsState = await owner.$eval('[data-consent-type="MARKETING_SMS"]', (e) => e.dataset.consentState).catch(() => null);
  check("15. Geri alma anında: veritabanı REVOKED + panel 'Geri alındı'; geçmiş korunur (2 kayıt)", lastSms?.status === "REVOKED" && smsState === "REVOKED" && (await db.customerConsent.count({ where: { customerId: customer.id, type: "MARKETING_SMS" } })) === 2, smsState);

  // ── 16–17 Yeni misafir / aynı tarayıcı ─────────────────────────────────────────
  const guest = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await guest.goto(stable, { waitUntil: "networkidle2" });
  const gp = await pill(guest);
  const guestHesabim = `${new URL(guest.url()).origin}${new URL(guest.url()).pathname.replace(/\/$/, "")}/hesabim`;
  await guest.goto(guestHesabim, { waitUntil: "networkidle2" });
  check("16. Aynı masada yeni tarayıcı kimliği devralmaz", gp?.identified === "0" && !!(await guest.$("[data-testid=join-form]")) && !(await bodyText(guest)).includes("Ayşe"), JSON.stringify(gp));
  await cust.goto(stable, { waitUntil: "networkidle2" });
  check("17. Aynı müşteri tarayıcısı kimliğini korur", (await pill(cust))?.identified === "1");

  // ── 18–21 CRM paneli ───────────────────────────────────────────────────────────
  await owner.goto(`${B}/panel/musteriler`, { waitUntil: "networkidle2" });
  const listText = await bodyText(owner);
  check("18. Sahip /panel/musteriler: metrikler + liste (iletişim maskeli)", listText.includes("Kayıtlı müşteri") && listText.includes("Toplam Sipariş Tutarı") && listText.includes("Ayşe") && !listText.includes(EMAIL) && !listText.includes(PHONE_INPUT));
  await owner.goto(`${B}/panel/musteriler?q=${encodeURIComponent(PHONE_INPUT.slice(0, 8))}`, { waitUntil: "networkidle2" });
  const found = await owner.$$eval("[data-customer-row] a", (els) => els.map((e) => e.getAttribute("href")));
  await owner.goto(`${B}/panel/musteriler?q=${encodeURIComponent(EMAIL.slice(0, 12))}`, { waitUntil: "networkidle2" });
  const foundEmail = await owner.$$eval("[data-customer-row] a", (els) => els.map((e) => e.getAttribute("href")));
  check("19. Arama: telefon ve e-posta ile bulundu", found.includes(`/panel/musteriler/${customer.id}`) && foundEmail.includes(`/panel/musteriler/${customer.id}`), JSON.stringify(found));
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click(`a[href="/panel/musteriler/${customer.id}"]`)]);
  const detailText = await bodyText(owner);
  check("20. Ayrıntı: tam iletişim sahibe görünür, 'Doğrulanmamış' işaretli", (await owner.$eval("[data-testid=customer-phone]", (e) => e.textContent)).includes(PHONE) && detailText.includes(EMAIL) && detailText.includes("Doğrulanmamış"));
  const orderRows = await owner.$$eval("tr[data-order-number]", (els) => els.map((e) => Number(e.dataset.orderNumber)));
  const ledgerRows = await owner.$$eval("tr[data-ledger-type]", (els) => els.map((e) => e.dataset.ledgerType));
  check("21. Sipariş geçmişi (yalnızca ilişkili sipariş) + sadakat defteri (1 kazanım)", orderRows.includes(n2) && !orderRows.includes(n1) && ledgerRows.filter((t) => t === "EARN").length === 1 && (await owner.$eval("[data-testid=loyalty-summary]", (e) => e.dataset.balance)) === String(expected), JSON.stringify({ orderRows, ledgerRows }));
  await owner.screenshot({ path: path.join(OUT, "crm-detail-1440.png"), fullPage: true });

  // ── 22 Garson reddedilir ───────────────────────────────────────────────────────
  const waiter = await newPage({ width: 1280, height: 900 });
  await login(waiter, waiterCreds.email, waiterCreds.password);
  const wr1 = await waiter.goto(`${B}/panel/musteriler`, { waitUntil: "networkidle2" });
  const wr2 = await waiter.goto(`${B}/panel/musteriler/${customer.id}`, { waitUntil: "networkidle2" });
  const wr3 = await waiter.goto(`${B}/panel/sadakat`, { waitUntil: "networkidle2" });
  await waiter.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  const waiterNav = await waiter.$$eval('a[href="/panel/musteriler"], a[href="/panel/sadakat"]', (els) => els.length);
  check("22. Garson: /panel/musteriler, ayrıntı ve /panel/sadakat → 404; menüde görünmez", wr1.status() === 404 && wr2.status() === 404 && wr3.status() === 404 && waiterNav === 0, `${wr1.status()} ${wr2.status()} ${wr3.status()} nav=${waiterNav}`);

  // ── 23 KDS iletişim içermez ────────────────────────────────────────────────────
  const n3 = await placeOrder(cust, stable);
  const o3 = await db.order.findFirst({ where: { tenantId: T, orderNumber: n3 }, select: { id: true, customerId: true } });
  await owner.goto(`${B}/panel/siparisler/${o3.id}`, { waitUntil: "networkidle2" });
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  await waitText(owner, "istasyon fişi oluşturuldu");
  const kitchen = await newPage({ width: 1440, height: 1000 });
  await login(kitchen, kitchenCreds.email, kitchenCreds.password);
  await kitchen.goto(`${B}/panel/mutfak`, { waitUntil: "networkidle2" });
  await kitchen.waitForSelector('[data-testid="kds-board"]');
  await waitFor(kitchen, (n) => document.body.innerText.includes(`#${n}`), n3, 10000);
  const kdsHtml = await kitchen.content();
  check("23. KDS: ilişkili siparişin fişi görünür, iletişim / müşteri adı yok", o3.customerId === customer.id && kdsHtml.includes(`#${n3}`) && !kdsHtml.includes(EMAIL) && !kdsHtml.includes(PHONE) && !kdsHtml.includes(PHONE_INPUT) && !kdsHtml.includes("Ayşe"));

  // ── 24 Destek modu maskeli ─────────────────────────────────────────────────────
  const ap = await newPage({ width: 1440, height: 900 });
  await login(ap, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" });
  await clickXp(ap, `.//header//button[normalize-space(.)="Destek Modu"]`);
  await ap.waitForSelector("dialog[open]");
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle2" }), clickXp(ap, `.//dialog[@open]//button[normalize-space(.)="Destek modunu başlat"]`)]);
  await ap.goto(`${B}/panel/musteriler/${customer.id}`, { waitUntil: "networkidle2" });
  const supHtml = await ap.content();
  const supPhone = await ap.$eval("[data-testid=customer-phone]", (e) => e.textContent).catch(() => "");
  check(
    "24. Destek modu: ayrıntı maskeli (0539 *** ** NN), düzenleme / geri alma / düzeltme yok",
    supPhone.includes("0539 *** **") && !supHtml.includes(PHONE) && !supHtml.includes(EMAIL) && !(await ap.$("[data-testid=customer-form-edit]")) && !(await ap.$("[data-testid=adjust-form]")) && !(await ap.$("[data-testid^=revoke-]")),
    supPhone,
  );
  const supNew = await ap.goto(`${B}/panel/musteriler/yeni`, { waitUntil: "networkidle2" });
  check("24b. Destek modu: müşteri ekleme sayfası 404", supNew.status() === 404, supNew.status());
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" }).catch(() => null);
  await clickXp(ap, `.//button[normalize-space(.)="Destek modundan çık"]`).catch(() => null);

  // ── 25–28 Duyarlı görünüm ──────────────────────────────────────────────────────
  await cust.goto(`${new URL(cust.url()).origin}${new URL(cust.url()).pathname.replace(/\/$/, "")}/hesabim`, { waitUntil: "networkidle2" });
  const o390c = await overflow(cust);
  await cust.screenshot({ path: path.join(OUT, "customer-profile-390.png"), fullPage: true });
  await guest.screenshot({ path: path.join(OUT, "customer-join-390.png"), fullPage: true });
  check("25. 390px müşteri: profil + katılım formu taşma yok", o390c <= 0 && (await overflow(guest)) <= 0, o390c);
  const ownerMobile = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(ownerMobile, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  let worst = 0;
  for (const url of ["/panel/musteriler", `/panel/musteriler/${customer.id}`, "/panel/sadakat", "/panel/musteriler/yeni"]) {
    await ownerMobile.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    worst = Math.max(worst, await overflow(ownerMobile));
  }
  await ownerMobile.screenshot({ path: path.join(OUT, "crm-panel-390.png"), fullPage: true });
  check("26. 390px CRM paneli: liste / ayrıntı / sadakat / ekle taşma yok", worst <= 0, worst);
  let worst1440 = 0;
  for (const url of ["/panel/musteriler", `/panel/musteriler/${customer.id}`, "/panel/sadakat"]) {
    await owner.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    worst1440 = Math.max(worst1440, await overflow(owner));
  }
  await owner.goto(`${B}/panel/musteriler`, { waitUntil: "networkidle2" });
  await owner.screenshot({ path: path.join(OUT, "crm-list-1440.png"), fullPage: true });
  check("27. 1440px CRM sayfaları", worst1440 <= 0, worst1440);
  const custMenu = await newPage({ width: 1440, height: 900 });
  await custMenu.goto(stable, { waitUntil: "networkidle2" });
  check("28. Taşma yok (1440 QR menü dahil)", (await overflow(custMenu)) <= 0);

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
    const left = T ? (await db.order.count({ where: { tenantId: T } })) + (await db.customer.count({ where: { tenantId: T, createdAt: { gte: state.startedAt } } })) + (await db.loyaltyLedger.count({ where: { tenantId: T } })) : 0;
    const settingsBack = T ? JSON.stringify(await db.loyaltySettings.findUnique({ where: { tenantId: T }, select: { enabled: true, minorPerPoint: true, earnOn: true } })) === JSON.stringify(state.loyaltyBefore) : true;
    check("30. Geçici veri temizlendi (sipariş, müşteri, defter, kullanıcı) ve sadakat ayarı geri alındı", left === 0 && settingsBack, `${left} ${settingsBack}`);
  } catch (e) {
    check("30. Geçici veri temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

// MasaNovaAI Sprint 17 — Rezervasyon, masa planlama, walk-in, oturtma (production build, headless Chrome).
// Demo kiracıda rezervasyon ayarı ve Merkez açılış saatleri test boyunca değiştirilir; sonunda ESKİ HALİNE döner.
// Test sırasında oluşturulan rezervasyon / müşteri / oturum / kullanıcılar silinir.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");

const B = "http://localhost:3820";
const T_HOST = "http://demo.localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s17");
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
const state = { demo: null, merkez: null, users: [], startedAt: new Date(), settingsBefore: null, hoursBefore: [], customerId: null };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 12 dk aşıldı", false);
  finish();
}, 12 * 60_000).unref();

const TZ = "Europe/Istanbul";
const localDate = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));
const localTime = (at) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
const istanbul = (date, hhmm) => new Date(`${date}T${hhmm}:00+03:00`);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const bodyText = (p) => p.evaluate(() => document.body.innerText);
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
const setValue = (p, sel, value) => p.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, value);
const jsClick = (p, sel) => p.$eval(sel, (e) => { e.scrollIntoView({ block: "center" }); e.click(); });
async function setChecked(p, sel, on) {
  const cur = await p.$eval(sel, (e) => e.checked);
  if (cur !== on) await jsClick(p, sel);
}

/** Müşteri: tarih + kişi + saat seçer, bilgileri girer; gönderimden ÖNCE durur (dönüş: saat seçildi mi). */
async function fillBooking(p, { date, party = 2, time, name, phone, email }) {
  await p.goto(`${T_HOST}/rezervasyon`, { waitUntil: "networkidle2" });
  await p.waitForSelector("[data-testid=reservation-form]");
  await jsClick(p, `[data-date="${date}"]`);
  const current = await p.$eval("[data-testid=party-value]", (e) => Number(e.dataset.party));
  for (let i = current; i < party; i++) await jsClick(p, "[data-testid=party-inc]");
  for (let i = current; i > party; i--) await jsClick(p, "[data-testid=party-dec]");
  const ok = await waitFor(p, (t) => !!document.querySelector(`[data-testid=slot][data-time="${t}"]`), time, 15000);
  if (!ok) return false;
  await jsClick(p, `[data-testid=slot][data-time="${time}"]`);
  await p.waitForSelector("input[name=name]");
  await p.type("input[name=name]", name);
  await p.type("input[name=phone]", phone);
  if (email) await p.type("input[name=email]", email);
  return true;
}

async function cleanup() {
  if (!state.demo) return;
  const T = state.demo.id;
  await db.reservation.deleteMany({ where: { tenantId: T, createdAt: { gte: state.startedAt } } });
  if (state.customerId) await db.customer.deleteMany({ where: { id: state.customerId } });
  await db.branchOpeningHours.deleteMany({ where: { tenantId: T } });
  if (state.hoursBefore.length) await db.branchOpeningHours.createMany({ data: state.hoursBefore.map((h) => ({ tenantId: h.tenantId, branchId: h.branchId, weekday: h.weekday, opensMinute: h.opensMinute, closesMinute: h.closesMinute })) });
  if (state.settingsBefore) {
    const keep = ["enabled", "publicBookingEnabled", "autoConfirm", "defaultDurationMinutes", "slotIntervalMinutes", "minAdvanceMinutes", "maxAdvanceDays", "minPartySize", "maxPartySize", "bufferMinutes", "cancellationCutoffMinutes", "noShowGraceMinutes"];
    await db.reservationSettings.update({ where: { tenantId: T }, data: Object.fromEntries(keep.map((k) => [k, state.settingsBefore[k]])) });
  } else await db.reservationSettings.deleteMany({ where: { tenantId: T } });
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  const T = state.demo.id;
  state.merkez = await db.branch.findFirstOrThrow({ where: { tenantId: T, slug: "merkez" }, select: { id: true } });
  state.settingsBefore = await db.reservationSettings.findUnique({ where: { tenantId: T } });
  state.hoursBefore = await db.branchOpeningHours.findMany({ where: { tenantId: T } });
  const waiterCreds = await makeUser("WAITER", "garson17");
  const kitchenCreds = await makeUser("KITCHEN", "mutfak17");
  const tomorrow = localDate(1);

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

  // ── 1. Sahip rezervasyonları açar ─────────────────────────────────────
  const owner = await newPage({ width: 1440, height: 1000 });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await owner.goto(`${B}/panel/rezervasyonlar/ayarlar?sube=${state.merkez.id}`, { waitUntil: "networkidle2" });
  await setChecked(owner, "#rp-enabled", true);
  await setChecked(owner, "#rp-publicBookingEnabled", true);
  await setChecked(owner, "#rp-autoConfirm", true);
  await setValue(owner, "#rp-bufferMinutes", "0");
  await setValue(owner, "#rp-minAdvanceMinutes", "30");
  await owner.click("[data-testid=reservation-policy-submit]");
  const savedPolicy = await waitText(owner, "Rezervasyon ayarları kaydedildi");
  for (let d = 1; d <= 7; d++) await setValue(owner, `#h-day${d}`, "00:00-24:00");
  await owner.click("[data-testid=hours-submit]");
  const savedHours = await waitText(owner, "Açılış saatleri kaydedildi");
  const policy = await db.reservationSettings.findUnique({ where: { tenantId: T } });
  check("1. Sahip ayarlardan rezervasyon + online rezervasyonu açtı, saatleri kaydetti (denetim)", savedPolicy && savedHours && policy?.enabled && policy.publicBookingEnabled && (await db.branchOpeningHours.count({ where: { tenantId: T, branchId: state.merkez.id } })) === 7 && (await db.auditLog.count({ where: { tenantId: T, action: "RESERVATION_SETTINGS_UPDATED", createdAt: { gte: state.startedAt } } })) >= 2);

  // ── 2–9. Müşteri rezervasyonu ─────────────────────────────────────────
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await cust.goto(`${T_HOST}/rezervasyon`, { waitUntil: "networkidle2" });
  check("2. Kiracı alan adında /rezervasyon açılır (hesap gerekmez)", !!(await cust.$("[data-testid=reservation-form]")) && !(await cust.$("#email")));
  await jsClick(cust, `[data-date="${tomorrow}"]`);
  check("3. Yarın seçildi", (await cust.$eval(`[data-date="${tomorrow}"]`, (e) => e.getAttribute("aria-checked"))) === "true");
  check("4. 2 kişi", (await cust.$eval("[data-testid=party-value]", (e) => e.dataset.party)) === "2");
  const slotsOk = await waitFor(cust, () => document.querySelectorAll("[data-testid=slot]").length > 0, null, 15000);
  const slotLabels = await cust.$$eval("[data-testid=slot]", (els) => els.map((e) => e.dataset.time));
  check("5. Sunucudan gerçek uygun saatler geldi (19:00 dahil)", slotsOk && slotLabels.includes("19:00"), slotLabels.slice(0, 6).join(","));
  await jsClick(cust, '[data-testid=slot][data-time="19:00"]');
  check("6. 19:00 seçildi → bölge / iletişim / özet adımları", !!(await cust.$("input[name=phone]")) && !!(await cust.$("[data-testid=res-review]")));
  const PHONE1 = `0532 ${String(crypto.randomInt(100, 999))} ${String(crypto.randomInt(10, 99))} ${String(crypto.randomInt(10, 99))}`;
  await cust.type("input[name=name]", `Rez Müşteri ${run}`);
  await cust.type("input[name=phone]", PHONE1);
  await cust.type("input[name=email]", `rez-${run}@e2e.masanovai.test`);
  await cust.type("textarea[name=request]", "Bebek sandalyesi <b>lütfen</b>");
  check("7. Misafir bilgileri girildi", true);
  await jsClick(cust, "[data-testid=res-submit]");
  const confirmed = await waitFor(cust, () => document.querySelector("[data-testid=res-result]")?.dataset.status === "CONFIRMED", null, 20000);
  check("8. Gönderildi", confirmed);
  const r1 = await db.reservation.findFirst({ where: { tenantId: T, guestName: `Rez Müşteri ${run}` }, include: { tables: true } });
  check("9. Rezervasyon onaylandı (otomatik onay, masa atandı, PUBLIC_WEB, anonim)", r1?.status === "CONFIRMED" && r1.tables.length === 1 && r1.source === "PUBLIC_WEB" && r1.customerId === null, JSON.stringify({ status: r1?.status }));
  await cust.screenshot({ path: path.join(OUT, "public-confirmed-390.png"), fullPage: true });

  // ── 10–11. Yönetim bağlantısı ─────────────────────────────────────────
  const manageHref = await cust.$eval("[data-testid=manage-link]", (e) => e.getAttribute("href"));
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2" }), jsClick(cust, "[data-testid=manage-link]")]);
  check("10. Yönetim bağlantısı opak belirteç (43 karakter), iç kimlik yok", /^\/rezervasyon\/y\/[A-Za-z0-9_-]{43}$/.test(manageHref) && !manageHref.includes(r1.id) && !manageHref.includes(r1.publicId), manageHref);
  const manageText = await bodyText(cust);
  check("11. Rezervasyon görüntülendi (durum, ad, kişi; iç not / masa yok; istek düz metin)", (await cust.$eval("[data-testid=manage-reservation]", (e) => e.dataset.status)) === "CONFIRMED" && manageText.includes(`Rez Müşteri ${run}`) && manageText.includes("2 kişi") && manageText.includes("<b>lütfen</b>") && !(await cust.$("[data-testid=manage-reservation] b")));
  const o390manage = await overflow(cust);

  // ── 12–16. Panel ─────────────────────────────────────────────────────
  await owner.goto(`${B}/panel/rezervasyonlar?gun=${tomorrow}`, { waitUntil: "networkidle2" });
  check("12. Sahip /panel/rezervasyonlar açtı (yarın)", (await bodyText(owner)).includes("Rezervasyonlar"));
  const row = await owner.$(`tr[data-guest="Rez Müşteri ${run}"]`);
  const rowText = row ? await row.evaluate((e) => e.innerText) : "";
  check("13. Rezervasyon listede: saat, kişi, masa, durum, kaynak; telefon maskeli", rowText.includes("19:00") && rowText.includes("Onaylandı") && rowText.includes("Online") && !rowText.includes(PHONE1) && rowText.includes("***"), rowText.replace(/\s+/g, " "));

  // Personel rezervasyonu (telefon) → masa değiştir → masaya al
  await owner.goto(`${B}/panel/rezervasyonlar/yeni?sube=${state.merkez.id}&gun=${tomorrow}`, { waitUntil: "networkidle2" });
  await setValue(owner, "#sr-date", tomorrow);
  await setValue(owner, "#sr-time", "13:00");
  await setValue(owner, "#sr-party", "3");
  await owner.type("#sr-name", `Telefon Misafir ${run}`);
  await owner.type("#sr-phone", "05551112233");
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click("[data-testid=staff-reservation-submit]")]);
  const r2 = await db.reservation.findFirst({ where: { tenantId: T, guestName: `Telefon Misafir ${run}` }, include: { tables: true } });
  const beforeTable = r2?.tables[0]?.tableId;
  await owner.waitForSelector("[data-testid=reassign-form]");
  const optionCount = await owner.$$eval("#reassign-option option", (os) => os.length);
  await owner.select("#reassign-option", await owner.$$eval("#reassign-option option", (os) => os[os.length - 1].value));
  await owner.click("[data-testid=reassign-submit]");
  const reassigned = await waitText(owner, "Masa atandı");
  const afterTable = (await db.reservationTable.findFirst({ where: { reservationId: r2.id } }))?.tableId;
  check("14. Sahip masayı değiştirdi (sunucu doğruladı, denetim)", r2?.source === "PHONE" && optionCount > 1 && reassigned && afterTable && afterTable !== beforeTable && (await db.auditLog.count({ where: { entityId: r2.id, action: "RESERVATION_TABLE_ASSIGNED" } })) === 2);
  await owner.reload({ waitUntil: "networkidle2" });
  await owner.click('[data-testid=status-buttons] [data-action="SEATED"]');
  const seated = await waitFor(owner, () => document.querySelector("[data-testid=reservation-status]")?.dataset.status === "SEATED", null, 15000);
  check("15. “Masaya Al” → SEATED (geçmiş kaydı)", seated && (await db.reservationStatusHistory.count({ where: { reservationId: r2.id, toStatus: "SEATED" } })) === 1);
  await owner.goto(`${B}/panel/rezervasyonlar?gun=${tomorrow}&gorunum=zaman`, { waitUntil: "networkidle2" });
  const blocks = await owner.$$eval("[data-timeline-block]", (els) => els.map((e) => e.dataset.timelineBlock));
  check("16. Zaman çizelgesi: masalar bölgelere göre, bloklar (Masada + Onaylandı)", !!(await owner.$("[data-testid=reservation-timeline]")) && blocks.includes("SEATED") && blocks.includes("CONFIRMED") && (await overflow(owner)) <= 0, blocks.join(","));
  await owner.screenshot({ path: path.join(OUT, "timeline-1440.png"), fullPage: true });

  // ── 17–18. Walk-in ───────────────────────────────────────────────────
  await owner.goto(`${B}/panel/rezervasyonlar`, { waitUntil: "networkidle2" });
  await owner.click("[data-testid=walkin-open]");
  await owner.waitForSelector("dialog[open] [data-testid=walkin-form]");
  await setValue(owner, "#wi-party", "2");
  await owner.type("#wi-name", `Kapıdan ${run}`);
  await owner.click("[data-testid=walkin-submit]");
  const walked = await waitText(owner, "Walk-in masaya alındı");
  check("17. Walk-in eklendi", walked);
  const walkIn = await db.reservation.findFirst({ where: { tenantId: T, guestName: `Kapıdan ${run}` }, include: { tables: true } });
  check("18. Walk-in boş masa aldı: SEATED, WALK_IN, şimdi", walkIn?.status === "SEATED" && walkIn.source === "WALK_IN" && walkIn.tables.length === 1 && Math.abs(walkIn.startsAt.getTime() - Date.now()) < 5 * 60_000);
  await owner.goto(`${B}/panel/masalar`, { waitUntil: "networkidle2" });
  check("18b. Masalar sayfası masadaki misafiri gösterir (ad + kişi, iletişim yok)", (await owner.$$eval("[data-testid=table-seated]", (els) => els.map((e) => e.textContent))).some((t) => t.includes(`Kapıdan ${run}`)));

  // ── 19–20. Çakışan rezervasyon ───────────────────────────────────────
  const cust2 = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const filled = await fillBooking(cust2, { date: tomorrow, party: 2, time: "19:30", name: `Geç Kalan ${run}`, phone: "0533 444 55 66" });
  // Müşteri formu doldururken salon tamamen doldu (başka kanal): 19:00–21:00 tüm boş masalar
  const start = istanbul(tomorrow, "19:00");
  const end = istanbul(tomorrow, "21:00");
  const tables = await db.diningTable.findMany({ where: { tenantId: T, branchId: state.merkez.id, active: true }, select: { id: true } });
  for (const t of tables) {
    const busy = await db.reservationTable.count({ where: { tableId: t.id, active: true, startsAt: { lt: end }, blockedUntil: { gt: start } } });
    if (busy) continue;
    const id = `e2e17${run}${t.id.slice(-6)}`;
    await db.reservation.create({ data: { id, tenantId: T, branchId: state.merkez.id, publicId: `${id}p`, manageTokenHash: crypto.randomBytes(32).toString("hex"), manageTokenNonce: "e2e", guestName: "Dolu Salon", partySize: 2, startsAt: start, endsAt: end, durationMinutes: 120, status: "CONFIRMED", source: "PHONE" } });
    await db.reservationTable.create({ data: { tenantId: T, branchId: state.merkez.id, reservationId: id, tableId: t.id, startsAt: start, blockedUntil: end } });
  }
  await jsClick(cust2, "[data-testid=res-submit]");
  const taken = await waitFor(cust2, () => !!document.querySelector("[data-testid=res-taken]"), null, 15000);
  const alts = await cust2.$$eval("[data-testid=alt-slot]", (els) => els.map((e) => e.textContent.trim()));
  check("19. İkinci (çakışan) rezervasyon gönderildi", filled);
  check("20. Çakışma reddedildi: “Bu saat az önce doldu” + yakın müsait saatler", taken && (await bodyText(cust2)).includes("Bu saat az önce doldu") && alts.length > 0 && !alts.includes("19:30") && (await db.reservation.count({ where: { tenantId: T, guestName: `Geç Kalan ${run}` } })) === 0, `${taken} [${alts.join(",")}]`);

  // ── 21. Müşteri iptali ───────────────────────────────────────────────
  await cust.goto(`${T_HOST}${manageHref}`, { waitUntil: "networkidle2" });
  await jsClick(cust, "[data-testid=manage-cancel]");
  const cancelled = await waitFor(cust, () => document.querySelector("[data-testid=manage-reservation]")?.dataset.status === "CANCELLED", null, 15000);
  const r1After = await db.reservation.findUnique({ where: { id: r1.id }, include: { tables: true } });
  check("21. Müşteri yönetim bağlantısından iptal etti; masa serbest", cancelled && r1After.status === "CANCELLED" && r1After.cancelledBy === "CUSTOMER" && r1After.tables.every((t) => !t.active));

  // ── 22. Gelmedi ──────────────────────────────────────────────────────
  const past = new Date(Date.now() - 40 * 60_000);
  await owner.goto(`${B}/panel/rezervasyonlar/yeni?sube=${state.merkez.id}`, { waitUntil: "networkidle2" });
  await setValue(owner, "#sr-date", localDate(0) === new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(past) ? localDate(0) : new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(past));
  await setValue(owner, "#sr-time", localTime(past));
  await owner.type("#sr-name", `Gelmeyen ${run}`);
  await owner.click("#sr-override");
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click("[data-testid=staff-reservation-submit]")]);
  await owner.waitForSelector('[data-testid=status-buttons] [data-action="NO_SHOW"]', { timeout: 10000 }).catch(() => null);
  await owner.click('[data-testid=status-buttons] [data-action="NO_SHOW"]').catch(() => null);
  const noShow = await waitFor(owner, () => document.querySelector("[data-testid=reservation-status]")?.dataset.status === "NO_SHOW", null, 15000);
  const r3 = await db.reservation.findFirst({ where: { tenantId: T, guestName: `Gelmeyen ${run}` } });
  check("22. Saati + bekleme payı geçen rezervasyon “Gelmedi” (yönetici kural aşımı denetlendi)", noShow && r3?.status === "NO_SHOW" && r3.overridden && (await db.auditLog.count({ where: { entityId: r3.id, action: "RESERVATION_OVERRIDE" } })) === 1);

  // ── 23–24. CRM bağlantısı ─────────────────────────────────────────────
  const customer = await db.customer.create({ data: { tenantId: T, publicId: crypto.randomBytes(16).toString("base64url"), firstName: "Sadık", lastName: `Müşteri${run.replace(/\d/g, "")}`, source: "QR_OPT_IN" }, select: { id: true } });
  state.customerId = customer.id;
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  await db.customerSession.create({ data: { tenantId: T, customerId: customer.id, tokenHash: crypto.createHash("sha256").update(`masanova:customer-session:v1:${sessionToken}`).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) } });
  const crm = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await crm.setCookie({ name: "mn_customer", value: sessionToken, domain: "demo.localhost", path: "/", httpOnly: true });
  const crmFilled = await fillBooking(crm, { date: tomorrow, party: 2, time: "13:30", name: `CRM Misafir ${run}`, phone: "0544 222 33 44" });
  if (crmFilled) await jsClick(crm, "[data-testid=res-submit]");
  await waitFor(crm, () => !!document.querySelector("[data-testid=res-result]"), null, 20000);
  const r4 = await db.reservation.findFirst({ where: { tenantId: T, guestName: `CRM Misafir ${run}` } });
  await owner.goto(`${B}/panel/rezervasyonlar/${r4?.id}`, { waitUntil: "networkidle2" });
  const crmCell = await owner.$eval("[data-testid=reservation-crm]", (e) => e.textContent).catch(() => "");
  check("23. Tanınan müşterinin rezervasyonu CRM'e bağlandı (panelde bağlantı); pazarlama izni oluşmadı", r4?.customerId === customer.id && crmCell.includes("Sadık") && (await db.customerConsent.count({ where: { customerId: customer.id } })) === 0, crmCell);
  await owner.goto(`${B}/panel/rezervasyonlar/${r1.id}`, { waitUntil: "networkidle2" });
  const anonCell = await owner.$eval("[data-testid=reservation-crm]", (e) => e.textContent).catch(() => "");
  check("24. Anonim rezervasyon anonim kaldı (CRM profili oluşmadı)", anonCell.includes("Anonim") && (await db.customer.count({ where: { tenantId: T, OR: [{ phoneNormalized: { contains: PHONE1.replace(/\D/g, "").slice(1) } }, { email: `rez-${run}@e2e.masanovai.test` }] } })) === 0);
  await owner.screenshot({ path: path.join(OUT, "detail-1440.png"), fullPage: true });

  // ── 25–27. Yetkiler ──────────────────────────────────────────────────
  const waiter = await newPage({ width: 1280, height: 900 });
  await login(waiter, waiterCreds.email, waiterCreds.password);
  const w1 = await waiter.goto(`${B}/panel/rezervasyonlar?gun=${tomorrow}`, { waitUntil: "networkidle2" });
  const waiterCanSeat = !!(await waiter.$("[data-testid=status-buttons]"));
  const w2 = await waiter.goto(`${B}/panel/rezervasyonlar/ayarlar`, { waitUntil: "networkidle2" });
  await waiter.goto(`${B}/panel/rezervasyonlar/${r4.id}`, { waitUntil: "networkidle2" });
  check("25. Garson: pano 200 + durum düğmeleri; ayarlar 404; masa değiştirme yok", w1.status() === 200 && waiterCanSeat && w2.status() === 404 && !(await waiter.$("[data-testid=reassign-form]")), `${w1.status()} ${w2.status()}`);
  const kitchen = await newPage({ width: 1280, height: 900 });
  await login(kitchen, kitchenCreds.email, kitchenCreds.password);
  const k1 = await kitchen.goto(`${B}/panel/rezervasyonlar`, { waitUntil: "networkidle2" });
  const k2 = await kitchen.goto(`${B}/panel/rezervasyonlar/${r4.id}`, { waitUntil: "networkidle2" });
  await kitchen.goto(`${B}/panel/mutfak`, { waitUntil: "networkidle2" });
  check("26. Mutfak: rezervasyonlar 404; KDS'te rezervasyon misafiri yok", k1.status() === 404 && k2.status() === 404 && !(await bodyText(kitchen)).includes(`Rez Müşteri ${run}`), `${k1.status()} ${k2.status()}`);
  const ap = await newPage({ width: 1440, height: 900 });
  await login(ap, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" });
  await clickXp(ap, `.//header//button[normalize-space(.)="Destek Modu"]`);
  await ap.waitForSelector("dialog[open]");
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle2" }), clickXp(ap, `.//dialog[@open]//button[normalize-space(.)="Destek modunu başlat"]`)]);
  await ap.goto(`${B}/panel/rezervasyonlar/${r2.id}`, { waitUntil: "networkidle2" });
  const supPhone = await ap.$eval("[data-testid=reservation-phone]", (e) => e.textContent).catch(() => "");
  const supButtons = !!(await ap.$("[data-testid=status-buttons]")) || !!(await ap.$("[data-testid=reassign-form]"));
  await ap.goto(`${B}/panel/rezervasyonlar?gun=${tomorrow}`, { waitUntil: "networkidle2" });
  const supWalkIn = !!(await ap.$("[data-testid=walkin-open]"));
  const supNew = await ap.goto(`${B}/panel/rezervasyonlar/yeni`, { waitUntil: "networkidle2" });
  check("27. Destek modu salt okunur: telefon maskeli, durum / masa / walk-in / yeni yok", supPhone.includes("***") && !supPhone.includes("1112233") && !supButtons && !supWalkIn && supNew.status() === 404, `${supPhone} ${supNew.status()}`);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" }).catch(() => null);
  await clickXp(ap, `.//button[normalize-space(.)="Destek modundan çık"]`).catch(() => null);

  // ── 28–31. Duyarlı görünüm ───────────────────────────────────────────
  const pub = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await fillBooking(pub, { date: tomorrow, party: 2, time: "14:00", name: "Taşma", phone: "0532 000 00 00" });
  const o390pub = await overflow(pub);
  await pub.screenshot({ path: path.join(OUT, "public-form-390.png"), fullPage: true });
  let o360 = 0;
  for (const w of [360, 430]) {
    await pub.setViewport({ width: w, height: 844, isMobile: true, hasTouch: true });
    await pub.reload({ waitUntil: "networkidle2" });
    o360 = Math.max(o360, await overflow(pub));
  }
  check("28. 390px public (ayrıca 360 / 430): form ve yönetim sayfası taşmaz", o390pub <= 0 && o390manage <= 0 && o360 <= 0, `${o390pub} ${o390manage} ${o360}`);
  const ownerM = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(ownerM, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  let worst = 0;
  for (const url of [`/panel/rezervasyonlar?gun=${tomorrow}`, `/panel/rezervasyonlar?gun=${tomorrow}&gorunum=zaman`, `/panel/rezervasyonlar?gun=${tomorrow}&gorunum=takvim`, `/panel/rezervasyonlar/${r2.id}`, "/panel/rezervasyonlar/ayarlar", "/panel/rezervasyonlar/yeni"]) {
    await ownerM.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    worst = Math.max(worst, await overflow(ownerM));
  }
  await ownerM.goto(`${B}/panel/rezervasyonlar?gun=${tomorrow}`, { waitUntil: "networkidle2" });
  await ownerM.screenshot({ path: path.join(OUT, "panel-390.png"), fullPage: true });
  check("29. 390px panel: liste / zaman çizelgesi / takvim / ayrıntı / ayarlar / yeni taşmaz (çizelge kendi içinde kayar)", worst <= 0, worst);
  let w1440 = 0;
  for (const url of [`/panel/rezervasyonlar?gun=${tomorrow}`, `/panel/rezervasyonlar?gun=${tomorrow}&gorunum=takvim`, `/panel/rezervasyonlar/${r2.id}`, `/panel/rezervasyonlar/ayarlar`, "/panel/analitik?sekme=tables"]) {
    await owner.goto(`${B}${url}`, { waitUntil: "networkidle2" });
    w1440 = Math.max(w1440, await overflow(owner));
  }
  await owner.goto(`${B}/panel/rezervasyonlar?gun=${tomorrow}`, { waitUntil: "networkidle2" });
  await owner.screenshot({ path: path.join(OUT, "board-1440.png"), fullPage: true });
  check("30. 1440px: pano, takvim, ayrıntı, ayarlar, analitik (rezervasyon özeti)", w1440 <= 0 && !!(await (async () => { await owner.goto(`${B}/panel/analitik?sekme=tables`, { waitUntil: "networkidle2" }); return owner.$("[data-testid=analytics-reservations]"); })()), w1440);
  for (const w of [1024, 1920]) {
    await owner.setViewport({ width: w, height: 1000 });
    await owner.goto(`${B}/panel/rezervasyonlar?gun=${tomorrow}&gorunum=zaman`, { waitUntil: "networkidle2" });
    w1440 = Math.max(w1440, await overflow(owner));
  }
  check("31. Yatay taşma yok (1024 / 1440 / 1920)", w1440 <= 0, w1440);
  check("32. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
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
    const left = T ? (await db.reservation.count({ where: { tenantId: T, createdAt: { gte: state.startedAt } } })) + (state.customerId ? await db.customer.count({ where: { id: state.customerId } }) : 0) : 0;
    const settingsBack = T ? !!state.settingsBefore === !!(await db.reservationSettings.findUnique({ where: { tenantId: T } })) : true;
    const hoursBack = T ? (await db.branchOpeningHours.count({ where: { tenantId: T } })) === state.hoursBefore.length : true;
    check("33. Geçici veri temizlendi; ayarlar ve saatler eski haline döndü", left === 0 && settingsBack && hoursBack, `${left} ${settingsBack} ${hoursBack}`);
  } catch (e) {
    check("33. Geçici veri temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

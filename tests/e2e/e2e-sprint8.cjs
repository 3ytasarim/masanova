// MasaNova AI Sprint 8 (servis talepleri: garson / su / peçete / hesap / özel; ön salon panosu) — production build, headless Chrome.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execSync, spawn } = require("child_process");
const { hash } = require("@node-rs/argon2");
const { PrismaClient } = require("@prisma/client");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s8");
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const derive = (nonce) => crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
const run = crypto.randomBytes(3).toString("hex");
const state = { demo: null, users: [], restore: [] };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 9 dk aşıldı", false);
  finish();
}, 9 * 60_000).unref();

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
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
}
async function makeUser(role, first, last) {
  const email = `${role.toLowerCase()}-${first.normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}-${run}@e2e.masanovai.test`;
  const password = `${first}-${run}-${crypto.randomBytes(9).toString("base64url")}`;
  const user = await db.user.create({ data: { tenantId: state.demo.id, email, firstName: first, lastName: last, role, passwordHash: await hash(password) }, select: { id: true } });
  state.users.push(user.id);
  return { email, password, id: user.id };
}
async function cleanRequests() {
  if (state.demo) await db.tableServiceRequest.deleteMany({ where: { tenantId: state.demo.id } });
}
// ── Müşteri adımları ──
async function openSheet(c) {
  if (!(await c.$("dialog[open] [data-service-type]"))) {
    await c.click('[data-testid="service-button"]');
    await c.waitForSelector("dialog[open] [data-service-type]");
    await sleep(350);
  }
}
async function request(c, type, note) {
  await openSheet(c);
  await c.click(`dialog[open] [data-service-type="${type}"]`);
  await c.waitForSelector('[data-testid="service-confirm"]');
  const confirmText = await c.$eval('[data-testid="service-confirm"]', (e) => e.innerText);
  if (note) await c.type('[data-testid="service-confirm"] textarea', note);
  await c.click('[data-testid="service-send"]');
  await waitFor(c, () => !!document.querySelector('[data-testid="service-result"]') || !!document.querySelector('[data-testid="service-error"]'));
  const resultText = await c.evaluate(() => (document.querySelector('[data-testid="service-result"]') ?? document.querySelector('[data-testid="service-error"]'))?.innerText ?? "");
  const duplicate = await c.evaluate(() => document.querySelector('[data-testid="service-result"]')?.dataset.duplicate === "true");
  // Sayfayı menü adımına döndür (bir sonraki talep için)
  const [again] = await c.$$('xpath/.//dialog[@open]//button[normalize-space(.)="Servis İste"]');
  if (again) await again.click();
  await sleep(250);
  return { confirmText, resultText, duplicate };
}
async function closeSheet(c) {
  await c.keyboard.press("Escape");
  await sleep(400);
}
const chip = (c) => c.evaluate(() => {
  const e = document.querySelector('[data-testid="service-status"]');
  return e ? { status: e.dataset.status, type: e.dataset.type, text: e.innerText } : null;
});
// ── Personel adımları ──
const card = (p, type, status) => `[data-testid="service-card"][data-type="${type}"]${status ? `[data-status="${status}"]` : ""}`;
async function tab(p, lane) {
  const t = await p.$(`[data-testid="service-tab-${lane}"]`);
  if (t && (await t.isVisible())) await t.click();
  await sleep(150);
}
function restartServer() {
  const pid = execSync("netstat -ano").toString().split(/\r?\n/).find((l) => /:3820\s.*LISTENING/.test(l))?.trim().split(/\s+/).pop();
  if (pid) execSync(`taskkill /PID ${pid} /T /F`);
}
function startServer() {
  const logFd = fs.openSync(path.join(__dirname, "../../tmp/e2e", "server8-restart.log"), "a");
  spawn("cmd", ["/c", "npx next start -p 3820"], { cwd: path.resolve(__dirname, "../.."), detached: true, stdio: ["ignore", logFd, logFd] }).unref();
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  await cleanRequests();
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: state.demo.id, name: "Masa 12" }, select: { id: true, name: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const stable = `${B}/q/${derive(row.tokenNonce)}`;
  const t11 = await db.diningTable.findFirstOrThrow({ where: { tenantId: state.demo.id, name: "Masa 11" }, select: { id: true } });
  const row11 = await db.tableQrToken.findFirstOrThrow({ where: { tableId: t11.id, active: true } });
  const w1 = await makeUser("WAITER", "Merve", "Kaya");
  const w2 = await makeUser("WAITER", "Can", "Demir");
  const mgr = await makeUser("BRANCH_MANAGER", "Ayşe", "Yılmaz");

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
  const overflows = {};

  // ── Garson 1 panosu (telefon) açık: talepler yenilemesiz gelmeli ──
  const wp1 = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(wp1, w1.email, w1.password);
  await wp1.goto(`${B}/panel/servis`, { waitUntil: "networkidle2" });
  await waitFor(wp1, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live");

  // ── Müşteri ──
  const cust = await newPage({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await cust.bringToFront();
  await cust.goto(stable, { waitUntil: "networkidle2" });
  check("1. Masa QR'ı açılır; 'Servis' düğmesi görünür", (await cust.$eval('[data-testid="table-badge"]', (e) => e.innerText)).includes("Masa 12") && !!(await cust.$('[data-testid="service-button"]')));
  await openSheet(cust);
  const types = await cust.$$eval("dialog[open] [data-service-type]", (els) => els.map((e) => e.innerText.trim()));
  check("2. Servis menüsü: Garson Çağır / Su İste / Peçete İste / Hesap İste / Diğer", JSON.stringify(types) === JSON.stringify(["Garson Çağır", "Su İste", "Peçete İste", "Hesap İste", "Diğer"]), types.join(","));
  const tapHeights = await cust.$$eval("dialog[open] [data-service-type]", (els) => els.map((e) => e.getBoundingClientRect().height));
  await cust.screenshot({ path: path.join(OUT, "customer-sheet-375.png") });
  const r1 = await request(cust, "WAITER");
  check("3. Garson çağrısı onaylı gönderildi ('emin misiniz' → 'iletildi')", r1.confirmText.includes("Garson çağırmak istediğinize emin misiniz?") && r1.resultText.includes("Garson çağrınız iletildi."), `${r1.confirmText} / ${r1.resultText}`);
  await closeSheet(cust);
  const c1 = await chip(cust);
  check("4. Müşteri: 'Talebiniz personele iletildi.'", c1?.status === "OPEN" && c1.text.includes("Talebiniz personele iletildi."), JSON.stringify(c1));

  // ── Garson: yenilemesiz görür, üstlenir, tamamlar ──
  await wp1.bringToFront();
  check("5–6. Garson panosu (ikinci tarayıcı) talebi yenilemeden aldı", await waitFor(wp1, (sel) => !!document.querySelector(sel), card(wp1, "WAITER", "OPEN")));
  const claimBtn = await wp1.$(`${card(wp1, "WAITER", "OPEN")} [data-testid="service-claim"]`);
  const claimBox = await claimBtn.boundingBox();
  await claimBtn.click();
  await waitFor(wp1, (sel) => !!document.querySelector(sel), card(wp1, "WAITER", "ACKNOWLEDGED"));
  await tab(wp1, "ACKNOWLEDGED");
  const ackText = await wp1.$eval(card(wp1, "WAITER", "ACKNOWLEDGED"), (e) => e.innerText);
  check("7. 'Ben ilgileniyorum' → İlgileniliyor: 'Merve K. (siz) ilgileniyor'", ackText.includes("Merve K. (siz) ilgileniyor"), ackText);
  check("8. Müşteri yenilemeden 'Merve K. talebinizle ilgileniyor.'", await waitFor(cust, () => document.querySelector('[data-testid="service-status"]')?.innerText.includes("Merve K. talebinizle ilgileniyor.")));
  await wp1.screenshot({ path: path.join(OUT, "waiter-ack-390.png"), fullPage: true });
  await wp1.click(`${card(wp1, "WAITER", "ACKNOWLEDGED")} [data-testid="service-complete"]`);
  check("9. Personel tamamladı", await waitFor(wp1, () => [...document.querySelectorAll('[data-testid="service-card"][data-type="WAITER"]')].every((e) => e.dataset.status === "COMPLETED")));
  check("10. Müşteri: 'Talebiniz tamamlandı.' (yenilemesiz)", await waitFor(cust, () => document.querySelector('[data-testid="service-status"]')?.dataset.status === "COMPLETED" && document.querySelector('[data-testid="service-status"]').innerText.includes("Talebiniz tamamlandı.")));

  // ── Su / mükerrer / peçete / hesap / özel ──
  await cust.bringToFront();
  const water = await request(cust, "WATER");
  check("11. Su talebi gönderildi", water.resultText.includes("Su talebiniz iletildi.") && !water.duplicate, water.resultText);
  const waterDup = await request(cust, "WATER");
  check("12. Tekrar su → 'Su talebiniz zaten iletildi.'", waterDup.duplicate && waterDup.resultText.includes("Su talebiniz zaten iletildi."), waterDup.resultText);
  check("13. Yalnızca bir aktif su talebi", (await db.tableServiceRequest.count({ where: { tableId: table.id, type: "WATER", activeSlot: "ACTIVE" } })) === 1);
  const napkin = await request(cust, "NAPKIN");
  check("14. Peçete talebi", napkin.resultText.includes("Peçete talebiniz iletildi."), napkin.resultText);
  const bill = await request(cust, "BILL");
  check("15. Hesap: 'Hesabı İste' onayı → 'Hesap talebiniz iletildi.' (ödeme ima edilmez)", bill.confirmText.includes("Hesap istemek istediğinize emin misiniz?") && bill.resultText.includes("Hesap talebiniz iletildi."), bill.resultText);
  const custom = await request(cust, "CUSTOM", "Çocuk sandalyesi rica edebilir miyiz?");
  check("16. Özel istek + not", custom.resultText.includes("İsteğiniz iletildi."), custom.resultText);
  await closeSheet(cust);

  // ── Sahip (masaüstü) hepsini görür ──
  const owner = await newPage({ width: 1440, height: 1000 });
  await owner.bringToFront();
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await owner.goto(`${B}/panel/servis`, { waitUntil: "networkidle2" });
  const openTypes = await owner.$$eval('[data-testid="service-lane-OPEN"] [data-testid="service-card"]', (els) => els.map((e) => e.dataset.type).sort());
  const ownerText = await bodyText(owner);
  check("17. Sahip panosu: su, peçete, hesap, özel (not dahil) bekliyor", JSON.stringify(openTypes) === JSON.stringify(["BILL", "CUSTOM", "NAPKIN", "WATER"]) && ownerText.includes("Çocuk sandalyesi rica edebilir miyiz?"), openTypes.join(","));
  const lanesVisible = await owner.$$eval('[data-testid^="service-lane-"]', (els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
  check("32. 1440: üç sütun aynı anda (Bekliyor / İlgileniliyor / Tamamlandı)", lanesVisible === 3);
  await owner.screenshot({ path: path.join(OUT, "board-1440.png"), fullPage: true });
  overflows["1440"] = await overflow(owner);

  // ── Hesabı garson 1 üstlenir; eşzamanlı üstlenme; garson 2 tamamlayamaz; müdür tamamlar ──
  await wp1.bringToFront();
  await tab(wp1, "OPEN");
  await waitFor(wp1, (sel) => !!document.querySelector(sel), card(wp1, "BILL", "OPEN"));
  await wp1.click(`${card(wp1, "BILL", "OPEN")} [data-testid="service-claim"]`);
  check("18. Garson 1 hesabı üstlendi", await waitFor(wp1, (sel) => !!document.querySelector(sel), card(wp1, "BILL", "ACKNOWLEDGED")));

  const wp2 = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await login(wp2, w2.email, w2.password);
  await wp2.goto(`${B}/panel/servis`, { waitUntil: "networkidle2" });
  await tab(wp2, "ACKNOWLEDGED");
  const billForW2 = await wp2.$eval(card(wp2, "BILL", "ACKNOWLEDGED"), (e) => ({ text: e.innerText, complete: !!e.querySelector('[data-testid="service-complete"]') }));
  // Eşzamanlı üstlenme (su): iki garson aynı anda
  await tab(wp1, "OPEN");
  await tab(wp2, "OPEN");
  await waitFor(wp2, (sel) => !!document.querySelector(sel), card(wp2, "WATER", "OPEN"));
  await Promise.all([wp1.click(`${card(wp1, "WATER", "OPEN")} [data-testid="service-claim"]`), wp2.click(`${card(wp2, "WATER", "OPEN")} [data-testid="service-claim"]`)]);
  await sleep(2500);
  const waterRow = await db.tableServiceRequest.findFirstOrThrow({ where: { tableId: table.id, type: "WATER", activeSlot: "ACTIVE" }, include: { history: true } });
  const loserToast = (await bodyText(wp1)).includes("başka bir personel tarafından alındı") || (await bodyText(wp2)).includes("başka bir personel tarafından alındı");
  check(
    "19. Farklı garson üstlenmeyi ezemez: hesap kartında 'Tamamlandı' yok; eşzamanlı üstlenmede tek kazanan + net mesaj",
    billForW2.text.includes("Merve K. ilgileniyor") && !billForW2.complete && waterRow.status === "ACKNOWLEDGED" && waterRow.history.filter((h) => h.toStatus === "ACKNOWLEDGED").length === 1 && loserToast,
    JSON.stringify({ billForW2, status: waterRow.status, loserToast }),
  );
  const mp = await newPage({ width: 1024, height: 900 });
  await login(mp, mgr.email, mgr.password);
  await mp.goto(`${B}/panel/servis`, { waitUntil: "networkidle2" });
  await mp.click(`${card(mp, "BILL", "ACKNOWLEDGED")} [data-testid="service-complete"]`);
  check("20. Müdür, garsonun üstlendiği hesabı tamamlayabilir (yönetici yetkisi)", await waitFor(mp, (sel) => !!document.querySelector(sel), card(mp, "BILL", "COMPLETED")));
  overflows["1024"] = await overflow(mp);

  // ── Geçmiş / yanıt süresi ──
  await owner.bringToFront();
  await owner.goto(`${B}/panel/servis/gecmis`, { waitUntil: "networkidle2" });
  const hist = await owner.$$eval('[data-testid="service-history-row"]', (rows) => rows.map((r) => ({ table: r.dataset.table, type: r.dataset.type, text: r.innerText, response: r.querySelector('[data-testid="service-history-response"]')?.innerText.trim() })));
  check("21. Geçmiş: tamamlanan garson + hesap talepleri, ilgilenen kişiyle", hist.some((h) => h.type === "WAITER" && h.text.includes("Merve K.")) && hist.some((h) => h.type === "BILL"), JSON.stringify(hist).slice(0, 200));
  check("22. Yanıt süresi gösteriliyor (gerçek veriden)", hist.length >= 2 && hist.every((h) => h.response && h.response !== "—" && /sn|dk/.test(h.response)), hist.map((h) => h.response).join(","));
  await owner.goto(`${B}/panel/servis`, { waitUntil: "networkidle2" });
  const avg = await owner.$eval('[data-metric="avg"] dd', (e) => e.innerText);
  check("Ortalama yanıt süresi metriği dolu", avg !== "—", avg);

  // ── Masa yeniden adlandırma → geçmiş kopyası ──
  await db.diningTable.update({ where: { id: table.id }, data: { name: "Teras 12" } });
  state.restore.push(() => db.diningTable.update({ where: { id: table.id }, data: { name: table.name } }));
  check("23. Masa yeniden adlandırıldı (Teras 12)", (await db.diningTable.findUniqueOrThrow({ where: { id: table.id } })).name === "Teras 12");
  await owner.goto(`${B}/panel/servis/gecmis`, { waitUntil: "networkidle2" });
  const histNames = await owner.$$eval('[data-testid="service-history-row"]', (rows) => rows.map((r) => r.dataset.table));
  check("24. Geçmiş talepler özgün masa adını korur ('Masa 12')", histNames.length > 0 && histNames.every((n) => n === "Masa 12"), histNames.join(","));

  // ── QR iptali ──
  await db.tableQrToken.update({ where: { id: row.id }, data: { active: false, revokedAt: new Date() } });
  state.restore.push(() => db.tableQrToken.update({ where: { id: row.id }, data: { active: true, revokedAt: null } }));
  check("25. QR iptal edildi", true);
  await cust.bringToFront();
  await openSheet(cust);
  // Garson çağrısı tamamlanmıştı → yeni talep denemesi
  await cust.click('dialog[open] [data-service-type="WAITER"]');
  await cust.waitForSelector('[data-testid="service-send"]');
  await cust.click('[data-testid="service-send"]');
  await waitFor(cust, () => !!document.querySelector('[data-testid="service-error"]'));
  check("26. İptal edilen QR ile yeni talep açılamaz (nötr hata)", (await cust.$eval('[data-testid="service-error"]', (e) => e.innerText).catch(() => "")).includes("QR kodu artık geçerli değil"));
  await closeSheet(cust);
  await owner.bringToFront();
  await owner.goto(`${B}/panel/servis`, { waitUntil: "networkidle2" });
  const stillOpen = await owner.$$eval('[data-testid="service-lane-OPEN"] [data-testid="service-card"]', (els) => els.map((e) => e.dataset.type).sort());
  await owner.click(`${card(owner, "NAPKIN", "OPEN")} [data-testid="service-claim"]`);
  await waitFor(owner, (sel) => !!document.querySelector(sel), card(owner, "NAPKIN", "ACKNOWLEDGED"));
  await owner.click(`${card(owner, "NAPKIN", "ACKNOWLEDGED")} [data-testid="service-complete"]`);
  check("27. Mevcut talepler personelde kalır ve tamamlanabilir (QR iptaline rağmen)", stillOpen.includes("NAPKIN") && stillOpen.includes("CUSTOM") && (await waitFor(owner, (sel) => !!document.querySelector(sel), card(owner, "NAPKIN", "COMPLETED"))), stillOpen.join(","));

  // ── Yeniden bağlanma (gerçek kesinti) ──
  await wp1.bringToFront();
  await tab(wp1, "OPEN");
  restartServer();
  const down = await waitFor(wp1, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "reconnecting", null, 20000);
  const customRow = await db.tableServiceRequest.findFirstOrThrow({ where: { tableId: table.id, type: "CUSTOM", activeSlot: "ACTIVE" } });
  await db.tableServiceRequest.update({ where: { id: customRow.id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedByUserId: mgr.id, acknowledgedByName: "Ayşe Y." } });
  startServer();
  const up = await waitFor(wp1, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live", null, 45000);
  check("28. Bağlantı koptu → yeniden bağlandı; kesintideki değişiklik yeniden çekildi", down && up && (await waitFor(wp1, (sel) => !document.querySelector(sel), card(wp1, "CUSTOM", "OPEN"), 15000)), JSON.stringify({ down, up }));

  // ── Duyarlılık ──
  await db.tableQrToken.update({ where: { id: row.id }, data: { active: true, revokedAt: null } }); // müşteri sayfası için geri aç
  await cust.goto(stable, { waitUntil: "networkidle2" });
  await openSheet(cust);
  overflows["375-sheet"] = await overflow(cust);
  check("29. 375 müşteri: taşma yok, dokunma hedefleri ≥ 48px", overflows["375-sheet"] <= 0 && tapHeights.every((h) => h >= 48), JSON.stringify({ o: overflows["375-sheet"], tapHeights }));
  await closeSheet(cust);
  await wp1.reload({ waitUntil: "networkidle2" });
  overflows["390"] = await overflow(wp1);
  check("30. 390 garson panosu: taşma yok, 'Ben ilgileniyorum' ≥ 48px, sekmeli tek sütun", overflows["390"] <= 0 && claimBox.height >= 48 && (await wp1.$eval('[data-testid="service-tab-OPEN"]', (e) => e.getBoundingClientRect().height >= 48)), JSON.stringify({ o: overflows["390"], h: claimBox.height }));
  const tablet = await newPage({ width: 768, height: 1024, isMobile: true, hasTouch: true });
  await login(tablet, w2.email, w2.password);
  await tablet.goto(`${B}/panel/servis`, { waitUntil: "networkidle2" });
  overflows["768"] = await overflow(tablet);
  check("31. 768 tablet: taşma yok, sekmeli yerleşim", overflows["768"] <= 0 && (await tablet.$eval('[data-testid="service-tab-OPEN"]', (e) => e.getBoundingClientRect().width > 0)), overflows["768"]);
  await tablet.screenshot({ path: path.join(OUT, "board-768.png"), fullPage: true });

  // ── Arapça ──
  const arabic = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await arabic.goto(`${B}/q/${derive(row11.tokenNonce)}`, { waitUntil: "networkidle2" });
  await arabic.goto(`${arabic.url()}?dil=ar`, { waitUntil: "networkidle2" });
  await arabic.click('[data-testid="service-button"]');
  await arabic.waitForSelector("dialog[open] [data-service-type]");
  await sleep(350);
  const ar = await arabic.evaluate(() => ({ dir: document.querySelector("[dir]")?.getAttribute("dir"), title: document.querySelector("#pm-service-title")?.innerText, waiter: document.querySelector('[data-service-type="WAITER"]')?.innerText }));
  overflows["ar"] = await overflow(arabic);
  check("33. Arapça servis arayüzü: RTL, 'طلب خدمة' / 'استدعاء النادل'", ar.dir === "rtl" && ar.title === "طلب خدمة" && ar.waiter?.includes("استدعاء النادل"), JSON.stringify(ar));
  await arabic.screenshot({ path: path.join(OUT, "customer-ar-390.png") });
  overflows["1440"] = overflows["1440"] ?? 0;
  check("34. Hiçbir genişlikte yatay taşma yok (375 / 390 / 768 / 1024 / 1440 / AR)", Object.values(overflows).every((v) => v <= 0), JSON.stringify(overflows));
  // Güvenlik: iptal edilen QR'ın masa akışı 404
  await db.tableQrToken.update({ where: { id: row.id }, data: { active: false, revokedAt: new Date() } });
  const streamStatus = await cust.evaluate(async () => (await fetch(`${location.pathname.replace(/\/$/, "")}/akis`)).status);
  check("İptal edilen QR'ın masa akışı reddedilir (404)", streamStatus === 404, streamStatus);
  check("35. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.join(" | "));
})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack || e.message))
  .finally(() => finish());

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  await browser?.close().catch(() => null);
  for (const fn of state.restore.reverse()) await fn().catch((e) => console.error("restore", e.message));
  await cleanRequests().catch(() => null);
  if (state.users.length) {
    await db.session.deleteMany({ where: { userId: { in: state.users } } }).catch(() => null);
    await db.user.deleteMany({ where: { id: { in: state.users } } }).catch(() => null);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

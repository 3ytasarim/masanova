// MasaNovaAI Sprint 15 — İşletme Danışmanı tarayıcı testi (production build). Demo kiracıya GEÇİCİ, deterministik
// geçmiş veri yazılır (son 7 gün ↔ önceki 7 gün), danışman panelden doğrulanır, sunucu AI KAPALI / mock AI ile
// yeniden başlatılır, sonunda tüm geçici veri silinir. Danışman salt okunurdur: menü / fiyat / istasyon değişmez.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient, Prisma } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");
const { killPort, startServer, waitHealthy } = require("./lib/server.cjs");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s15");
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
const state = { demo: null, users: [], productBefore: null };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 12 dk aşıldı", false);
  finish();
}, 12 * 60_000).unref();

const TZ = "Europe/Istanbul";
const localDay = (daysAgo) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - daysAgo * 86_400_000));
const at = (daysAgo, hh, mm) => new Date(`${localDay(daysAgo)}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+03:00`);
const min = (d, m) => new Date(d.getTime() + m * 60_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(p, fn, arg, timeout = 20000) {
  try {
    await p.waitForFunction(fn, { polling: 200, timeout }, arg);
    return true;
  } catch {
    return false;
  }
}
async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  if (!(await page.$("#email"))) return; // oturum hâlâ geçerli (sunucu yeniden başlatıldı; oturum veritabanında)
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
}
async function clickByText(page, label, scope = "") {
  const [el] = await page.$$(`xpath/.${scope}//button[normalize-space(.)="${label}"]`);
  if (!el) throw new Error(`Düğme yok: ${label}`);
  await el.click();
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const cards = (p) => p.$$eval("[data-testid=insight-card]", (els) => els.map((e) => ({ type: e.dataset.type, subject: e.dataset.subject, source: e.dataset.source, title: e.querySelector("[data-testid=insight-title]").textContent, comparison: e.querySelector("[data-testid=insight-comparison]")?.textContent ?? null })));
const open = (p, qs = "aralik=last7") => p.goto(`${B}/panel/ai/danisman?${qs}`, { waitUntil: "networkidle2" });
/** "Analizi Yenile" → bildirim → istemci router.refresh() ile yeniden çizilen görünüm (ayrı bir sayfa yenilemesi YOK:
 *  bu çizim bir görüntülemedir; "Yeni" rozeti burada görünür ve içgörü görüldü sayılır). */
async function refresh(p) {
  const before = await p.$eval("[data-testid=advisor-page]", (e) => e.outerHTML.length).catch(() => 0);
  await p.click("[data-testid=advisor-refresh]");
  const ok = await waitFor(p, () => [...document.querySelectorAll("[role=status], [role=alert], li")].some((e) => /Analiz (yenilendi|kısa süre)/.test(e.textContent)), null, 30000);
  await p.waitForNetworkIdle({ idleTime: 600, timeout: 20000 }).catch(() => null);
  await sleep(before ? 400 : 0);
  return ok;
}
async function restart(env) {
  killPort(3820);
  startServer(3820, env, "server-s15-restart.log");
  await waitHealthy(3820, 90_000);
}

let seq = 7000;
async function order(t, spec) {
  const T = state.demo.id;
  const total = spec.items.reduce((s, i) => s + i.unit * i.qty, 0);
  const accepted = min(spec.at, 1);
  const o = await db.order.create({
    data: {
      tenantId: T, branchId: spec.table.branchId, tableId: spec.table.id, publicId: crypto.randomBytes(16).toString("base64url"), orderNumber: ++seq, status: "SERVED", currency: "TRY",
      subtotalMinor: total, totalMinor: total, itemCount: spec.items.reduce((s, i) => s + i.qty, 0), locale: "tr", branchName: "Merkez Şube", tableName: spec.table.name, areaName: spec.area,
      idempotencyKeyHash: crypto.randomBytes(16).toString("hex"), requestHash: "e2e", submittedAt: spec.at, createdAt: spec.at, acceptedAt: accepted, preparingAt: min(accepted, 1), readyAt: min(accepted, spec.prep), servedAt: min(accepted, spec.prep + 3),
    },
  });
  let s = 0;
  for (const it of spec.items) await db.orderItem.create({ data: { tenantId: T, orderId: o.id, productId: it.product.id, productName: it.product.name, productNameDefault: it.product.name, basePriceMinor: it.unit, modifiersTotalMinor: 0, unitPriceMinor: it.unit, quantity: it.qty, lineTotalMinor: it.unit * it.qty, sortOrder: s++ } });
  for (const tk of spec.tickets ?? []) await db.orderTicket.create({ data: { tenantId: T, branchId: spec.table.branchId, orderId: o.id, stationId: tk.station.id, stationName: tk.station.name, stationType: tk.station.type, status: "READY", createdAt: accepted, startedAt: min(accepted, 2), readyAt: min(accepted, tk.ready) } });
}
async function request(table, areaId, areaName, when, ackSec) {
  await db.tableServiceRequest.create({ data: { tenantId: state.demo.id, branchId: table.branchId, tableId: table.id, diningAreaId: areaId, publicId: crypto.randomBytes(16).toString("base64url"), type: "WAITER", status: "COMPLETED", activeSlot: null, branchName: "Merkez Şube", areaName, tableName: table.name, createdAt: when, acknowledgedAt: new Date(when.getTime() + ackSec * 1000), completedAt: new Date(when.getTime() + (ackSec + 60) * 1000) } });
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true } });
  const T = state.demo.id;
  await cleanup();
  const burger = await db.product.findFirstOrThrow({ where: { tenantId: T, slug: "cheeseburger" } });
  const ayran = await db.product.findFirstOrThrow({ where: { tenantId: T, slug: "ayran" } });
  const corba = await db.product.findFirstOrThrow({ where: { tenantId: T, slug: "mercimek-corbasi" } });
  state.productBefore = { price: burger.basePriceMinor, active: burger.active, soldOut: burger.soldOut, updatedAt: burger.updatedAt.toISOString() };
  const m1 = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 1" } });
  const m9 = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 9" } });
  const merkez = await db.branch.findFirstOrThrow({ where: { tenantId: T, name: "Merkez Şube" } });
  const kadikoy = await db.branch.findFirstOrThrow({ where: { tenantId: T, name: "Kadıköy Şube" } });
  const st = await db.preparationStation.findMany({ where: { tenantId: T, branchId: merkez.id } });
  const mutfak = st.find((s) => s.type === "KITCHEN");
  const bar = st.find((s) => s.type === "BAR");

  // 2. Deterministik geçmiş: önceki 7 gün 40 sipariş (hazırlama 9 dk), son 7 gün 60 sipariş (12 dk), Cheeseburger 20 → 40
  for (let i = 0; i < 40; i++) {
    const items = [{ product: ayran, qty: 1, unit: 4500 }];
    if (i < 20) items.push({ product: burger, qty: 1, unit: 38000 });
    await order(T, { table: i % 2 ? m9 : m1, area: i % 2 ? "Bahçe" : "İç Salon", at: at(8 + (i % 5), 12 + (i % 6), 10), items, prep: 9 });
  }
  for (let i = 0; i < 60; i++) {
    // Ayran sabit (40 ↔ 40) — yalnızca Cheeseburger hareket etsin; 40–59. siparişler çorba (önceki dönemde yok → taban 0, içgörü yok)
    const items = i < 40 ? [{ product: ayran, qty: 1, unit: 4500 }, { product: burger, qty: 1, unit: 38000 }] : [{ product: corba, qty: 1, unit: 12000 }];
    await order(T, { table: i % 2 ? m9 : m1, area: i % 2 ? "Bahçe" : "İç Salon", at: at(1 + (i % 5), 12 + (i % 6), 20), items, prep: 12, tickets: i < 20 ? [{ station: mutfak, ready: 8 }, { station: bar, ready: 13 }] : undefined });
  }
  for (let i = 0; i < 20; i++) await request(m1, m1.diningAreaId, "İç Salon", at(8 + (i % 5), 14, i), 120);
  for (let i = 0; i < 10; i++) await request(m9, m9.diningAreaId, "Bahçe", at(1 + (i % 5), 14, i), 240);
  for (let i = 0; i < 10; i++) await request(m1, m1.diningAreaId, "İç Salon", at(1 + (i % 5), 15, i), 120);
  check("2. Geçici deterministik geçmiş veri oluşturuldu (100 sipariş, 40 servis talebi, iki istasyonlu fişler)", true);

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const consoleErrors = [];
  const newPage = async (viewport) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("console", (m) => m.type() === "error" && !/status of 40[134]|net::ERR_/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
    await p.setViewport(viewport);
    return p;
  };
  const owner = await newPage({ width: 1440, height: 1000 });

  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("1. Sahip giriş yaptı", owner.url().endsWith("/panel"), owner.url());
  await open(owner);
  check("3. /panel/ai/danisman açıldı (Son 7 gün, tüm şubeler)", (await owner.$eval("[data-testid=advisor-page]", (e) => e.dataset.range)) === "last7");
  const brief = await owner.$eval("[data-testid=advisor-brief]", (e) => e.textContent).catch(() => "");
  check("4. Haftalık özet görünür", brief.includes("Haftalık Özet") && brief.length > 40, brief.slice(0, 120));
  let list = await cards(owner);
  const find = (type, subject) => list.find((c) => c.type === type && (subject === undefined || c.subject === subject));
  check("5. Sipariş içgörüsü: 40 → 60 (+%50)", find("ORDER_VOLUME_CHANGE")?.comparison === "40 → 60 (+%50)", JSON.stringify(find("ORDER_VOLUME_CHANGE")));
  check("6. Hazırlama süresi içgörüsü: 9 dk → 12 dk (+%33)", find("PREP_TIME_CHANGE")?.comparison === "9 dk 00 sn → 12 dk 00 sn (+%33)", JSON.stringify(find("PREP_TIME_CHANGE")));
  check("7. Servis içgörüsü: yanıt 2 dk → 3 dk; Bahçe bölge farkı", find("SERVICE_RESPONSE_CHANGE")?.comparison === "2 dk 00 sn → 3 dk 00 sn (+%50)" && !!find("AREA_SERVICE_GAP", "Bahçe"), JSON.stringify(list.map((c) => c.type)));
  check("8. Ürün içgörüsü: Cheeseburger 20 → 40 adet", find("PRODUCT_MOMENTUM", "Cheeseburger")?.comparison === "20 → 40 adet (+%100)", JSON.stringify(find("PRODUCT_MOMENTUM")));
  check("Darboğaz: Bar istasyonu siparişlerin %100'ünde son", !!find("STATION_BOTTLENECK", "Bar"));
  const page1 = await owner.content();
  check("Kâr / marj iddiası, personel sıralaması, işe alma dili yok; her eylem 'Değerlendirilebilir'", !/kârınız|kârlı (bir )?ürün|yüksek marj|düşük marj|kâr(ı|ınız)? (arttı|düştü)|en (yavaş|hızlı) (garson|personel|çalışan)|işe al|işten çıkar|ciro/i.test(page1) && (await owner.$$eval("[data-testid=insight-action]", (els) => els.every((e) => /^Değerlendirilebilir/.test(e.textContent.trim())))));

  // 9–10 Bu nasıl hesaplandı?
  const prepCard = await owner.$('[data-testid=insight-card][data-type="PREP_TIME_CHANGE"]');
  await (await prepCard.$("[data-testid=insight-how] summary")).click();
  const how = await prepCard.$eval("[data-testid=insight-how]", (e) => ({ open: e.open, rows: [...e.querySelectorAll("tbody tr")].map((r) => r.textContent.replace(/\s+/g, " ").trim()), text: e.textContent }));
  check("9. 'Bu nasıl hesaplandı?' açıldı", how.open);
  check("10. Kesin olgu girdileri: medyan 12 dk 00 sn / 9 dk 00 sn, örneklem 60 / 40, dönem tarihleri", how.rows.some((r) => r.includes("Medyan hazırlama") && r.includes("12 dk 00 sn") && r.includes("9 dk 00 sn")) && how.rows.some((r) => r.includes("Sipariş (örneklem)") && r.includes("60") && r.includes("40")) && how.text.includes("Önceki eşdeğer dönem"), JSON.stringify(how.rows));

  // 11–12 Analitiğe derin bağlantı
  const deep = await prepCard.$eval("[data-testid=insight-deeplink]", (a) => a.getAttribute("href"));
  await prepCard.$eval("[data-testid=insight-deeplink]", (a) => a.click());
  await owner.waitForSelector("[data-testid=analytics-page]", { timeout: 20000 }).catch(() => null);
  const tab = await owner.$eval("[data-testid=analytics-page]", (e) => `${e.dataset.range}/${e.dataset.tab}`).catch(() => "");
  check("11. Derin bağlantı → Analitik › Operasyon (aynı dönem)", deep === "/panel/analitik?aralik=last7&sekme=operations" && tab === "last7/operations", `${deep} ${tab}`);
  await owner.goBack();
  check("12. Danışmana geri dönüldü", !!(await owner.waitForSelector("[data-testid=advisor-page]", { timeout: 20000 }).catch(() => null)));

  // 13–15 Kapat
  const vol = await owner.$('[data-testid=insight-card][data-type="ORDER_VOLUME_CHANGE"]');
  await (await vol.$("[data-testid=insight-dismiss]")).click();
  const gone = await waitFor(owner, () => !document.querySelector('[data-testid=insight-card][data-type="ORDER_VOLUME_CHANGE"]'));
  check("13. İçgörü kapatıldı", gone);
  await owner.reload({ waitUntil: "networkidle2" });
  check("14–15. Yenilemeden sonra kapatılan içgörü gizli kalır", !(await owner.$('[data-testid=insight-card][data-type="ORDER_VOLUME_CHANGE"]')));

  // 16–17 Önemli değişim → yeniden görünür
  for (let i = 0; i < 60; i++) await order(T, { table: m1, area: "İç Salon", at: at(1 + (i % 5), 19, 40), items: [{ product: ayran, qty: 1, unit: 4500 }], prep: 12 });
  const r16 = await refresh(owner);
  // router.refresh() çizimi eşzamansız: yeniden açılan kart DOM'a gelene kadar bekle
  await waitFor(owner, () => !!document.querySelector('[data-testid=insight-card][data-type="ORDER_VOLUME_CHANGE"]'), null, 20000);
  list = await cards(owner);
  const back = find("ORDER_VOLUME_CHANGE");
  check("16. Fixture önemli ölçüde değişti (40 → 120) ve analiz yenilendi", r16 && back?.comparison === "40 → 120 (+%200)", JSON.stringify(back));
  check("17. Önemli değişimle içgörü YENİDEN göründü (Yeni)", !!back && (await owner.$eval('[data-testid=insight-card][data-type="ORDER_VOLUME_CHANGE"]', (e) => e.textContent.includes("Yeni"))));
  check("Mock AI açıklaması yenilemede üretildi ve işaretlendi", list.some((c) => c.source === "ai") && !!(await owner.$("[data-testid=insight-ai-label]")));

  // 18–19 AI sağlayıcısı KAPALI → deterministik danışman çalışır
  await db.advisorInsight.updateMany({ where: { tenantId: T }, data: { explanation: Prisma.DbNull, explanationHash: null } });
  await restart({ AI_PROVIDER: "", VOICE_STT_PROVIDER: "", VOICE_TTS_PROVIDER: "" });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await open(owner);
  list = await cards(owner);
  check("18. AI sağlayıcısı kapalı: sayfa açılır, 'AI açıklaması kullanılamıyor' notu", list.length > 3 && (await owner.content()).includes("AI açıklaması şu an kullanılamıyor"));
  await owner.click("[data-testid=advisor-refresh]");
  const fallbackToast = await waitFor(owner, () => document.body.innerText.includes("içgörüler hesaplanan verilerle gösteriliyor"), null, 30000);
  await owner.reload({ waitUntil: "networkidle2" });
  list = await cards(owner);
  check("19. Deterministik içgörüler sağlayıcısız çalışır (şablon açıklama, aynı rakamlar)", fallbackToast && list.every((c) => c.source === "template") && find("PREP_TIME_CHANGE")?.comparison === "9 dk 00 sn → 12 dk 00 sn (+%33)");

  // 20–21 Mock AI yeniden açık
  await restart({ AI_PROVIDER: "mock", VOICE_STT_PROVIDER: "mock", VOICE_TTS_PROVIDER: "mock" });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await open(owner);
  check("20. Mock AI yeniden etkin", !(await owner.content()).includes("AI açıklaması şu an kullanılamıyor"));
  await refresh(owner);
  list = await cards(owner);
  const aiCard = await owner.$('[data-testid=insight-card][data-source="ai"]');
  const aiSummary = aiCard ? await aiCard.$eval("[data-testid=insight-summary]", (e) => e.textContent) : "";
  check("21. AI açıklaması görünür, işaretli, yalnızca hesaplanan rakamlar", list.filter((c) => c.source === "ai").length >= 3 && !!aiSummary && !/kâr|marj|999/.test(aiSummary), aiSummary);
  const usage = await db.aiUsage.count({ where: { tenantId: T, kind: "ADVISOR" } });
  check("Danışman AI kullanımı ayrı türde kaydedildi (ADVISOR)", usage >= 1, usage);

  // 22 Şube filtresi
  await owner.select("[data-testid=advisor-branch]", kadikoy.id);
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click("[data-testid=advisor-apply]")]);
  const kad = await owner.evaluate(() => ({ branch: document.querySelector("[data-testid=advisor-page]")?.dataset.branch, empty: !!document.querySelector("[data-testid=advisor-empty]"), scope: document.body.innerText.includes("Kapsam: Kadıköy Şube") }));
  check("22. Şube filtresi (Kadıköy): kapsam açık, az veri → içgörü yok", kad.branch === kadikoy.id && kad.empty && kad.scope, JSON.stringify(kad));
  await owner.goto(`${B}/panel/ai/danisman?aralik=last7&sube=cmzzzzzzzzzzzzzzzzzzzzzzz`, { waitUntil: "networkidle2" });
  check("Başka kiracının / olmayan şube kimliği reddedilir", (await owner.$eval("[data-testid=advisor-error]", (e) => e.textContent).catch(() => "")) === "Şube bulunamadı.");

  // 23–24 Roller
  const mkUser = async (role) => {
    const email = `e2e-${role.toLowerCase()}-${crypto.randomBytes(3).toString("hex")}@e2e.masanovai.test`;
    const password = `R-${crypto.randomBytes(12).toString("base64url")}`;
    const u = await db.user.create({ data: { tenantId: T, email, firstName: "E2E", lastName: role, role, passwordHash: await hash(password) } });
    state.users.push(u.id);
    return { email, password };
  };
  const mgr = await mkUser("BRANCH_MANAGER");
  const mp = await newPage({ width: 1280, height: 900 });
  await login(mp, mgr.email, mgr.password);
  await open(mp);
  check("23. Şube müdürü danışmanı görür, yenileyebilir ve kapatabilir", !!(await mp.$("[data-testid=insight-card]")) && !!(await mp.$("[data-testid=advisor-refresh]")) && !!(await mp.$("[data-testid=insight-dismiss]")));
  const waiter = await mkUser("WAITER");
  const wp = await newPage({ width: 1280, height: 900 });
  await login(wp, waiter.email, waiter.password);
  const wres = await wp.goto(`${B}/panel/ai/danisman`, { waitUntil: "networkidle2" });
  check("24. Garson → 404", wres.status() === 404, wres.status());

  // 25 Destek modu salt okunur
  const ap = await newPage({ width: 1440, height: 900 });
  await login(ap, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await ap.goto(`${B}/admin/isletmeler/${T}`, { waitUntil: "networkidle2" });
  await clickByText(ap, "Destek Modu", "//header");
  await ap.waitForSelector("dialog[open]");
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle2" }), clickByText(ap, "Destek modunu başlat", "//dialog[@open]")]);
  const before = await db.advisorInsight.findMany({ where: { tenantId: T }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } });
  await open(ap);
  const sup = await ap.evaluate(() => ({ cards: document.querySelectorAll("[data-testid=insight-card]").length, refresh: !!document.querySelector("[data-testid=advisor-refresh]"), dismiss: !!document.querySelector("[data-testid=insight-dismiss]"), ro: document.body.innerText.includes("Destek modu — salt okunur") }));
  const after = await db.advisorInsight.findMany({ where: { tenantId: T }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } });
  check("25. Destek modu: içgörüler görünür; yenile / kapat yok; hiçbir kayıt değişmedi", sup.cards > 0 && !sup.refresh && !sup.dismiss && sup.ro && JSON.stringify(before) === JSON.stringify(after), JSON.stringify(sup));
  await Promise.all([ap.waitForNavigation({ waitUntil: "networkidle2" }), clickByText(ap, "Destek modundan çık")]);

  // Salt okunur danışman: ürün / fiyat değişmedi
  const burgerAfter = await db.product.findUniqueOrThrow({ where: { id: burger.id } });
  check("Danışman hiçbir menü / fiyat verisini değiştirmedi", burgerAfter.basePriceMinor === state.productBefore.price && burgerAfter.active === state.productBefore.active && burgerAfter.updatedAt.toISOString() === state.productBefore.updatedAt);

  // Genel bakış özeti
  await owner.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  check("Genel bakışta danışman özeti (yönlendirme bağlantısı)", (await owner.$eval("[data-testid=overview-advisor] a", (a) => a.getAttribute("href")).catch(() => null)) === "/panel/ai/danisman");

  // 26–29 Duyarlılık
  const over = {};
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 1000]]) {
    const p = await newPage({ width: w, height: h, ...(w < 800 ? { isMobile: true, hasTouch: true } : {}) });
    await login(p, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
    await open(p);
    await p.$$eval("[data-testid=insight-how]", (els) => els.forEach((d) => (d.open = true)));
    over[w] = await overflow(p);
    await p.screenshot({ path: path.join(OUT, `advisor-${w}.png`), fullPage: w !== 390 });
  }
  check("26. 390 px", over[390] <= 0, over[390]);
  check("27. 768 px", over[768] <= 0, over[768]);
  check("28. 1440 px", over[1440] <= 0, over[1440]);
  check("29. Yatay taşma yok", Object.values(over).every((v) => v <= 0), JSON.stringify(over));
  check("30. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack || e.message))
  .finally(() => finish());

async function cleanup() {
  if (!state.demo) return;
  const T = state.demo.id;
  await db.advisorInsight.deleteMany({ where: { tenantId: T } });
  await db.aiUsage.deleteMany({ where: { tenantId: T, kind: "ADVISOR" } });
  await db.tableServiceRequest.deleteMany({ where: { tenantId: T } });
  await db.order.deleteMany({ where: { tenantId: T } });
  await db.orderSequence.deleteMany({ where: { tenantId: T } });
}

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
    const left = state.demo ? (await db.order.count({ where: { tenantId: state.demo.id } })) + (await db.advisorInsight.count({ where: { tenantId: state.demo.id } })) : 0;
    check("31. Geçici veri temizlendi (sipariş, talep, içgörü, kullanıcı)", left === 0, left);
  } catch (e) {
    check("31. Geçici veri temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

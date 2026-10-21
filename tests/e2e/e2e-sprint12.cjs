// MasaNova AI Sprint 12 — analitik paneli tarayıcı testi (production build). Demo kiracıya GEÇİCİ, deterministik veri
// yazılır (bugün + dün), panel üzerinden doğrulanır ve sonunda TAMAMEN silinir (geçici ürün / masa / kullanıcı dahil).
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s12");
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
const digits = (s) => String(s ?? "").replace(/\D/g, "");
const state = { demo: null, created: { products: [], tables: [], users: [] }, plan: null };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 12 dk aşıldı", false);
  finish();
}, 12 * 60_000).unref();

// Yerel (İstanbul) gün başlangıcı
function localMidnight(at) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return new Date(`${parts}T00:00:00+03:00`);
}
const min = (d, m) => new Date(d.getTime() + m * 60_000);

async function waitFor(p, fn, arg, timeout = 15000) {
  try {
    await p.waitForFunction(fn, { polling: 150, timeout }, arg);
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
const text = (p, sel) => p.$eval(sel, (e) => e.innerText).catch(() => null);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function go(p, qs) {
  await p.goto(`${B}/panel/analitik${qs ? `?${qs}` : ""}`, { waitUntil: "networkidle2" });
  await p.waitForSelector('[data-testid="analytics-page"], [data-testid="analytics-range-error"]', { timeout: 20000 });
}

let seq = 9000;
async function order(spec) {
  const T = state.demo.id;
  const total = spec.items.reduce((s, i) => s + i.unit * i.qty, 0);
  const created = spec.at;
  const acceptedAt = spec.accepted !== undefined ? min(created, spec.accepted) : null;
  const readyAt = acceptedAt && spec.ready !== undefined ? min(created, spec.ready) : null;
  const o = await db.order.create({
    data: {
      tenantId: T, branchId: spec.table.branchId, tableId: spec.table.id, publicId: crypto.randomBytes(16).toString("base64url"), orderNumber: ++seq, status: spec.status, currency: "TRY",
      subtotalMinor: total, totalMinor: total, itemCount: spec.items.reduce((s, i) => s + i.qty, 0), locale: "tr", branchName: spec.branchName, tableName: spec.table.name, areaName: spec.areaName,
      idempotencyKeyHash: crypto.randomBytes(16).toString("hex"), requestHash: "e2e", submittedAt: created, createdAt: created, acceptedAt, preparingAt: acceptedAt ? min(acceptedAt, 1) : null, readyAt,
      servedAt: spec.served !== undefined ? min(created, spec.served) : null, rejectedAt: spec.status === "REJECTED" ? min(created, 1) : null, cancelledAt: spec.status === "CANCELLED" ? min(created, 5) : null,
    },
  });
  let sort = 0;
  for (const it of spec.items) {
    await db.orderItem.create({ data: { tenantId: T, orderId: o.id, productId: it.product.id, variantId: it.variant?.id ?? null, productName: it.product.name, productNameDefault: it.product.name, variantName: it.variant?.name ?? null, basePriceMinor: it.unit, modifiersTotalMinor: 0, unitPriceMinor: it.unit, quantity: it.qty, lineTotalMinor: it.unit * it.qty, sortOrder: sort++ } });
  }
  for (const tk of spec.tickets ?? []) {
    await db.orderTicket.create({ data: { tenantId: T, branchId: spec.table.branchId, orderId: o.id, stationId: tk.station.id, stationName: tk.station.name, stationType: tk.station.type, status: "READY", createdAt: acceptedAt, startedAt: min(created, tk.started), readyAt: min(created, tk.ready) } });
  }
  return o;
}

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true, plan: true } });
  state.plan = state.demo.plan;
  const T = state.demo.id;
  await cleanup();

  // ── Geçici deterministik veri ──
  const merkez = await db.branch.findFirstOrThrow({ where: { tenantId: T, name: "Merkez Şube" } });
  const kadikoy = await db.branch.findFirstOrThrow({ where: { tenantId: T, name: "Kadıköy Şube" } });
  const tbl = async (name) => db.diningTable.findFirstOrThrow({ where: { tenantId: T, name }, include: { area: true } });
  const [m1, m10, m9, m2, m3] = await Promise.all(["Masa 1", "Masa 10", "Masa 9", "Masa 2", "Masa 3"].map(tbl));
  const k1 = await db.diningTable.create({ data: { tenantId: T, branchId: kadikoy.id, name: `E2E K1 ${crypto.randomBytes(2).toString("hex")}` } });
  state.created.tables.push(k1.id);
  const prod = async (slug) => db.product.findFirstOrThrow({ where: { tenantId: T, slug }, include: { variants: true } });
  const [burger, ayran, tavuk, kahve, corba, cheesecake, menu] = await Promise.all(["cheeseburger", "ayran", "izgara-tavuk", "turk-kahvesi", "mercimek-corbasi", "san-sebastian-cheesecake", "tavuk-burger-menu"].map(prod));
  const cat = await db.menuCategory.findFirstOrThrow({ where: { tenantId: T } });
  const formula = await db.product.create({ data: { tenantId: T, categoryId: cat.id, name: "=Formül Testi", slug: `e2e-formul-${crypto.randomBytes(2).toString("hex")}`, basePriceMinor: 10000, active: false } });
  state.created.products.push(formula.id);
  const st = await db.preparationStation.findMany({ where: { tenantId: T, branchId: merkez.id } });
  const mutfak = st.find((s) => s.type === "KITCHEN");
  const bar = st.find((s) => s.type === "BAR");
  const cift = burger.variants.find((v) => v.name === "Çift");
  const buyuk = ayran.variants.find((v) => v.name === "Büyük");
  const kucuk = ayran.variants.find((v) => v.name === "Küçük");

  const now = new Date();
  const today = localMidnight(now);
  const base = new Date(today.getTime() + Math.max(10 * 60_000, (now.getTime() - today.getTime()) * 0.5) - 10 * 60_000);
  const yesterdayBase = new Date(base.getTime() - 24 * 3_600_000);
  const at = (i) => min(base, i);

  await order({ table: m1, branchName: "Merkez Şube", areaName: "İç Salon", at: at(0), status: "SERVED", accepted: 2, ready: 14, served: 17, items: [{ product: burger, variant: cift, unit: 52000, qty: 2 }, { product: ayran, variant: buyuk, unit: 6500, qty: 1 }], tickets: [{ station: mutfak, started: 3, ready: 14 }, { station: bar, started: 3, ready: 5 }] });
  await order({ table: m10, branchName: "Merkez Şube", areaName: "Bahçe", at: at(1), status: "SERVED", accepted: 1, ready: 21, served: 25, items: [{ product: tavuk, unit: 34000, qty: 1 }, { product: kahve, unit: 7000, qty: 2 }], tickets: [{ station: mutfak, started: 3, ready: 21 }] });
  await order({ table: m9, branchName: "Merkez Şube", areaName: "Bahçe", at: at(2), status: "READY", accepted: 1, ready: 10, items: [{ product: formula, unit: 10000, qty: 3 }, { product: corba, unit: 12000, qty: 1 }], tickets: [{ station: mutfak, started: 2, ready: 10 }] });
  await order({ table: m2, branchName: "Merkez Şube", areaName: "İç Salon", at: at(3), status: "REJECTED", items: [{ product: burger, variant: cift, unit: 52000, qty: 10 }] });
  await order({ table: m3, branchName: "Merkez Şube", areaName: "İç Salon", at: at(4), status: "CANCELLED", accepted: 1, items: [{ product: menu, unit: 42000, qty: 5 }] });
  await order({ table: k1, branchName: "Kadıköy Şube", areaName: null, at: at(5), status: "SERVED", accepted: 1, ready: 6, served: 8, items: [{ product: cheesecake, unit: 21000, qty: 1 }] });
  await order({ table: m1, branchName: "Merkez Şube", areaName: "İç Salon", at: yesterdayBase, status: "SERVED", accepted: 1, ready: 5, served: 6, items: [{ product: ayran, variant: kucuk, unit: 4500, qty: 2 }] });
  const TODAY_SALES = 110_500 + 48_000 + 42_000 + 21_000;

  const req = (table, areaId, areaName, type, i, ack, done) =>
    db.tableServiceRequest.create({ data: { tenantId: T, branchId: table.branchId, tableId: table.id, diningAreaId: areaId, publicId: crypto.randomBytes(16).toString("base64url"), type, status: done ? "COMPLETED" : "ACKNOWLEDGED", activeSlot: done ? null : "ACTIVE", branchName: "Merkez Şube", areaName, tableName: table.name, createdAt: at(i), acknowledgedAt: new Date(at(i).getTime() + ack * 1000), completedAt: done ? new Date(at(i).getTime() + done * 1000) : null } });
  await req(m1, m1.diningAreaId, "İç Salon", "WAITER", 6, 60, 300);
  await req(m10, m10.diningAreaId, "Bahçe", "WATER", 7, 120, 240);
  await req(m9, m9.diningAreaId, "Bahçe", "BILL", 8, 180, null);

  const conv = (language, i) => db.aiConversation.create({ data: { tenantId: T, branchId: merkez.id, tableId: m1.id, publicId: crypto.randomBytes(16).toString("base64url"), proofHash: crypto.randomBytes(32).toString("hex"), uiLocale: "tr", conversationLanguage: language, createdAt: at(i), lastActivityAt: at(i), expiresAt: min(at(i), 360) } });
  const c1 = await conv("tr", 9);
  const c2 = await conv("en", 10);
  for (const [c, lang] of [[c1, "tr"], [c2, "en"]]) {
    await db.aiMessage.create({ data: { tenantId: T, conversationId: c.id, publicId: crypto.randomBytes(12).toString("base64url"), role: "USER", language: lang, content: "GİZLİ MÜŞTERİ METNİ", createdAt: at(11) } });
    await db.aiMessage.create({ data: { tenantId: T, conversationId: c.id, publicId: crypto.randomBytes(12).toString("base64url"), role: "ASSISTANT", language: lang, content: "yanıt", createdAt: at(11), metadata: { actions: [{ kind: "cart_add" }], products: [], recommendation: null } } });
  }
  await db.aiTurn.create({ data: { tenantId: T, conversationId: c1.id, turnKey: crypto.randomBytes(16).toString("base64url"), mode: "REALTIME", status: "COMPLETED", createdAt: at(11), audioInMs: 30_000, audioOutMs: 30_000 } });
  await db.aiTurn.create({ data: { tenantId: T, conversationId: c2.id, turnKey: crypto.randomBytes(16).toString("base64url"), mode: "FALLBACK", status: "COMPLETED", createdAt: at(12), audioInMs: 30_000, audioOutMs: 30_000 } });

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const consoleErrors = [];
  const newPage = async (viewport) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("console", (m) => m.type() === "error" && !/status of 40[134]|net::ERR_/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
    await p.setViewport(viewport);
    return p;
  };

  // ── 1–5. Giriş, Genel bakış, KPI ──
  const owner = await newPage({ width: 1440, height: 1000 });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("1. Sahip giriş yaptı", owner.url().endsWith("/panel"), owner.url());
  check("2. Geçici deterministik veri oluşturuldu (sipariş, ret, iptal, masa / bölge, KDS, servis, AI)", true);
  await go(owner, "");
  check("3. /panel/analitik açıldı (varsayılan: Bugün, Genel)", (await owner.$eval('[data-testid="analytics-page"]', (e) => `${e.dataset.range}/${e.dataset.tab}`)) === "today/overview");
  const sales = await text(owner, '[data-testid="kpi-sales-value"]');
  const ordersK = await text(owner, '[data-testid="kpi-orders-value"]');
  const avg = await text(owner, '[data-testid="kpi-average-value"]');
  check("4. KPI: sipariş tutarı ₺2.215,00, 4 sipariş, ortalama ₺553,75", digits(sales) === String(TODAY_SALES) && ordersK === "4" && digits(avg) === "55375", `${sales} / ${ordersK} / ${avg}`);
  check("5. Reddedilen (₺5.200) ve iptal edilen (₺2.100) satışa DAHİL DEĞİL; tanım metni görünür", !/7\.\d{3}|5\.200|2\.100/.test(sales) && (await text(owner, '[data-testid="analytics-sales-definition"]')).includes("Reddedilen"));
  const funnel = await owner.$$eval('[data-testid="funnel-row"]', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ")));
  check("Huni: 6 gönderilen, 5 kabul, 1 ret, 1 iptal", funnel.some((f) => f.includes("Gönderilen 6")) && funnel.some((f) => f.includes("Kabul edilen 5")) && funnel.some((f) => f.includes("Reddedilen 1")) && funnel.some((f) => f.includes("İptal edilen 1")), funnel.join(" | "));
  check("KPI: hazırlama ve servis yanıtı (ortalama 2 dk 00 sn)", (await text(owner, '[data-testid="kpi-response-value"]')) === "2 dk 00 sn", await text(owner, '[data-testid="kpi-response-value"]'));
  const salesCard = await text(owner, '[data-testid="kpi-sales"]');
  const ordersCard = await text(owner, '[data-testid="kpi-orders"]');
  check("Karşılaştırma (bugün ↔ dün aynı saate kadar): tutar yüzdesi var; tek siparişlik tabanda sayım yüzdesi YOK", /%/.test(salesCard) && salesCard.includes("Önceki: ₺90,00") && ordersCard.includes("Karşılaştırma için yeterli veri yok"), `${salesCard} || ${ordersCard}`);
  await owner.screenshot({ path: path.join(OUT, "overview-1440.png"), fullPage: true });

  // ── 6–9. Son 7 gün, karşılaştırma, şube filtresi, grafik ──
  await owner.select('[data-testid="analytics-range"]', "last7");
  await waitFor(owner, () => document.querySelector('[data-testid="analytics-page"]')?.dataset.range === "last7", null, 20000);
  check("6. Bugün → Son 7 gün (URL ve görünüm)", owner.url().includes("aralik=last7"));
  check("7. Son 7 gün: 5 sipariş, ₺2.305,00 (dün dahil); karşılaştırma dönemi gösterilir", (await text(owner, '[data-testid="kpi-orders-value"]')) === "5" && digits(await text(owner, '[data-testid="kpi-sales-value"]')) === String(TODAY_SALES + 9000) && (await owner.$eval("h1 + p, header p", (e) => e.innerText).catch(() => "")).includes("Karşılaştırma"), await text(owner, '[data-testid="kpi-sales-value"]'));
  const bars = await owner.$$eval('[data-testid="analytics-trend-chart"] [data-bucket]', (gs) => gs.map((g) => Number(g.dataset.value)));
  check("9. Sipariş grafiği: 7 günlük kova, dolu günler doğru", bars.length === 7 && bars.filter((v) => v > 0).length === 2 && bars.reduce((a, b) => a + b, 0) === TODAY_SALES + 9000, JSON.stringify(bars));
  await owner.select('[data-testid="analytics-branch"]', kadikoy.id);
  await waitFor(owner, (id) => location.search.includes(`sube=${id}`), kadikoy.id, 20000);
  await owner.waitForSelector('[data-testid="kpi-sales-value"]');
  check("8. Şube filtresi (Kadıköy): yalnızca ₺210,00 / 1 sipariş", digits(await text(owner, '[data-testid="kpi-sales-value"]')) === "21000" && (await text(owner, '[data-testid="kpi-orders-value"]')) === "1");
  const foreign = await owner.goto(`${B}/panel/analitik?aralik=today&sube=cmzzzzzzzzzzzzzzzzzzzzzzz`, { waitUntil: "networkidle2" });
  check("Başka kiracının / olmayan şube kimliği reddedilir", (await text(owner, '[data-testid="analytics-range-error"]')) === "Şube bulunamadı." && foreign.status() === 200);

  // ── 10–16. Sekmeler ──
  await go(owner, "aralik=today&sekme=products");
  const products = await owner.$$eval('[data-testid="product-row"]', (rows) => rows.map((r) => `${r.dataset.product}=${r.querySelector('[data-testid="product-qty"]').innerText}`));
  check("10. Ürün sıralaması: '=Formül Testi' 3, Cheeseburger 2 (reddedilen 10 adet sayılmadı)", products[0] === "=Formül Testi=3" && products.includes("Cheeseburger=2") && !products.some((p) => p.startsWith("Tavuk Burger Menü")), products.join(", "));
  check("Varyant dağılımı (Cheeseburger Çift) ve menü dörtlü tablosu (kârlılık değil uyarısı)", (await text(owner, '[data-testid="analytics-variants"]')).includes("Çift") && (await text(owner, '[data-testid="analytics-quadrants"]')).includes("kârlılık DEĞİLDİR"));
  await go(owner, "aralik=today&sekme=tables");
  const tables = await owner.$$eval('[data-testid="table-row"]', (rows) => rows.map((r) => `${r.dataset.table}=${r.querySelector('[data-testid="table-total"]').innerText}`));
  check("11. Masa sıralaması: Masa 1 ₺1.105,00 en üstte", tables[0]?.startsWith("Masa 1=") && digits(tables[0].split("=")[1]) === "110500", tables.join(", "));
  const areas = await owner.$$eval('[data-testid="area-row"]', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ")));
  check("12. Bölgeler: İç Salon ₺1.105,00, Bahçe ₺900,00, Kadıköy masası Bölgesiz", areas.some((a) => a.startsWith("İç Salon") && a.includes("1.105,00")) && areas.some((a) => a.startsWith("Bahçe") && a.includes("900,00")) && areas.some((a) => a.startsWith("Bölgesiz")), areas.join(" | "));
  await go(owner, "aralik=today&sekme=operations");
  const stations = await owner.$$eval('[data-testid="station-row"]', (rows) => rows.map((r) => `${r.dataset.station}=${r.querySelector('[data-testid="station-avg"]').innerText}`));
  check("13. KDS: Mutfak ort. 12 dk 20 sn (11, 18, 8 dk), Bar 2 dk 00 sn", stations.includes("Mutfak=12 dk 20 sn") && stations.includes("Bar=2 dk 00 sn"), stations.join(", "));
  check("13b. Personel sıralaması yok (istasyon / restoran geneli uyarısı)", (await text(owner, '[data-testid="analytics-ops"]')).includes("personel bazlı sıralama yapılmaz"));
  await go(owner, "aralik=today&sekme=service");
  check("14. Servis: 3 talep, yanıt medyanı 2 dk 00 sn; türler", (await text(owner, '[data-testid="service-total"]')).includes("3") && (await text(owner, '[data-testid="service-response-median"]')).includes("2 dk 00 sn") && (await text(owner, '[data-testid="analytics-service-types"]')).includes("Hesap"));
  await go(owner, "aralik=today&sekme=ai");
  check("15. AI: 2 konuşma, 2 tur, 2 dk ses, %50 yedek oranı; konuşma metni yok", (await text(owner, '[data-testid="ai-conversations"]')).includes("2") && (await text(owner, '[data-testid="ai-voice"]')).includes("2 dk 00 sn") && (await text(owner, '[data-testid="ai-fallback"]')).includes("%50") && !(await owner.content()).includes("GİZLİ MÜŞTERİ METNİ"));
  const langs = await owner.$$eval('[data-testid="ai-language-row"]', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ")));
  check("16. Dil dağılımı: TR ve EN", langs.some((l) => l.includes("(TR)")) && langs.some((l) => l.includes("(EN)")), langs.join(" | "));

  // ── 17–19. CSV ──
  await go(owner, "aralik=today&sekme=products");
  const href = await owner.$eval('[data-testid="export-products"]', (a) => a.getAttribute("href"));
  const csv = await owner.evaluate(async (h) => {
    const r = await fetch(h);
    return { status: r.status, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), body: await r.text() };
  }, href);
  check("17. Ürün CSV indirildi (sunucuda üretildi)", csv.status === 200 && csv.type.includes("text/csv") && csv.disp.includes("attachment"), JSON.stringify({ s: csv.status, t: csv.type }));
  check("18. CSV içeriği: Cheeseburger 2 adet, ₺1.040,00 katkı (104000 kuruş)", /"Cheeseburger",,"Aktif",2,1,104000,"1040\.00"/.test(csv.body), csv.body.slice(0, 300));
  check("19. Formül hücresi kaçışlı: \"'=Formül Testi\"", csv.body.includes(`"'=Formül Testi"`) && !/(^|,)"=Formül/m.test(csv.body));
  const ordersCsv = await owner.evaluate(async (h) => (await fetch(h)).text(), href.replace("tur=products", "tur=orders"));
  check("CSV sipariş: yerel saat + ofset (+03:00), notlar yok", ordersCsv.includes("+03:00") && ordersCsv.includes('"REJECTED","Hayır"'));

  // ── 20. Boş durum ──
  await go(owner, "aralik=custom&bas=2026-01-01&bit=2026-01-03");
  check("20. Veri olmayan dönem: 'Henüz yeterli veri yok.' (NaN / 0-0 yok)", (await text(owner, '[data-testid="analytics-empty"]')) === "Henüz yeterli veri yok." && !/NaN|Infinity/.test(await owner.evaluate(() => document.body.innerText)));
  await go(owner, "aralik=custom&bas=2024-01-01&bit=2026-01-03");
  check("Tarih aralığı kötüye kullanımı sınırlı (> 366 gün)", (await text(owner, '[data-testid="analytics-range-error"]')) === "Tarih aralığı en fazla 366 gün olabilir.");

  // Garson analitiğe erişemez
  const waiterEmail = `e2e-garson-${crypto.randomBytes(3).toString("hex")}@e2e.masanovai.test`;
  const waiterPass = `W-${crypto.randomBytes(12).toString("base64url")}`;
  const waiter = await db.user.create({ data: { tenantId: T, email: waiterEmail, firstName: "E2E", lastName: "Garson", role: "WAITER", passwordHash: await hash(waiterPass) } });
  state.created.users.push(waiter.id);
  const wp = await newPage({ width: 1280, height: 900 });
  await login(wp, waiterEmail, waiterPass);
  const wres = await wp.goto(`${B}/panel/analitik`, { waitUntil: "networkidle2" });
  const wcsv = await wp.goto(`${B}${href}`, { waitUntil: "networkidle2" });
  check("Garson analitik sayfasına ve CSV'ye erişemez (404)", wres.status() === 404 && wcsv.status() === 404, `${wres.status()} ${wcsv.status()}`);

  // ── 21–24. Duyarlılık ──
  const overflows = {};
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
    const p = await newPage({ width: w, height: h, ...(w < 1000 ? { isMobile: true, hasTouch: true } : {}) });
    await login(p, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
    let worst = 0;
    for (const tab of ["overview", "products", "tables", "operations", "service", "ai"]) {
      await go(p, `aralik=today&sekme=${tab}`);
      worst = Math.max(worst, await overflow(p));
    }
    overflows[w] = worst;
    await go(p, "aralik=today");
    await p.screenshot({ path: path.join(OUT, `analytics-${w}.png`), fullPage: true });
  }
  check("21. 390 px", overflows[390] <= 0, overflows[390]);
  check("22. 768 px", overflows[768] <= 0, overflows[768]);
  check("23. 1440 px", overflows[1440] <= 0, overflows[1440]);
  check("24. Hiçbir sekmede yatay taşma yok", Object.values(overflows).every((v) => v <= 0), JSON.stringify(overflows));
  check("25. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.join(" | "));
})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack || e.message))
  .finally(() => finish());

async function cleanup() {
  if (!state.demo) return;
  const T = state.demo.id;
  await db.aiConversation.deleteMany({ where: { tenantId: T } });
  await db.aiUsage.deleteMany({ where: { tenantId: T } });
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
    if (state.created.users.length) {
      await db.session.deleteMany({ where: { userId: { in: state.created.users } } });
      await db.user.deleteMany({ where: { id: { in: state.created.users } } });
    }
    if (state.created.tables.length) await db.diningTable.deleteMany({ where: { id: { in: state.created.tables } } });
    if (state.created.products.length) await db.product.deleteMany({ where: { id: { in: state.created.products } } });
    const left = await db.order.count({ where: { tenantId: state.demo?.id } });
    check("26. Tüm test verisi temizlendi", left === 0, left);
  } catch (e) {
    check("26. Tüm test verisi temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

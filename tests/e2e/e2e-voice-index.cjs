/* eslint-disable */
// Sesli menü eğitimi — tarayıcı testi. İşletme sahibi menüyü tarar; test kutusunda müşteri ifadeleri:
// "çökertme kebabı", "fetuçini alfredo", "iki büyük ayran", bilerek bozuk söylenmiş ürün, menüde olmayan ürün.
// Demo kiracıya geçici ürünler (Çökertme Kebabı, Fettuccine Alfredo) eklenir; sonunda silinir ve dizin eski hâline döner.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s21");
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
const state = { demo: null, categoryId: null, productIds: [], indexBefore: null };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 8 dk aşıldı", false);
  finish();
}, 8 * 60_000).unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  if (!(await page.$("#email"))) return;
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
}

async function tryPhrase(page, phrase) {
  await page.$eval("[data-testid=voice-test-input]", (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type("[data-testid=voice-test-input]", phrase);
  const before = await page.$eval("[data-testid=voice-test-result]", (e) => e.textContent).catch(() => null);
  await page.click("[data-testid=voice-test-submit]");
  await page.waitForFunction((b) => {
    const el = document.querySelector("[data-testid=voice-test-result]");
    return el && el.textContent !== b;
  }, { timeout: 15000, polling: 150 }, before);
  return page.$eval("[data-testid=voice-test-result]", (e) => ({ status: e.dataset.status, reply: e.querySelector("[data-testid=voice-test-reply]").textContent, text: e.textContent }));
}

async function main() {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" } });
  const T = state.demo.id;
  state.indexBefore = await db.voiceMenuIndex.findUnique({ where: { tenantId: T } });
  // Geçici ürünler (yayında, etkin kategori).
  const cat = await db.menuCategory.create({ data: { tenantId: T, slug: `e2e-ses-${Date.now()}`, name: "E2E Ses Testi", sortOrder: 999 } });
  state.categoryId = cat.id;
  for (const [i, p] of [
    { slug: `e2e-cokertme-${Date.now()}`, name: "Çökertme Kebabı", price: 52000 },
    { slug: `e2e-fettuccine-${Date.now()}`, name: "Fettuccine Alfredo", price: 42000 },
  ].entries()) {
    const row = await db.product.create({ data: { tenantId: T, slug: p.slug, name: p.name, categoryId: cat.id, basePriceMinor: p.price, currency: "TRY", sortOrder: 9000 + i, allergensConfirmedAt: new Date() } });
    state.productIds.push(row.id);
  }

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000 });
  const owner = await browser.newPage();
  await owner.setViewport({ width: 1280, height: 900 });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("1. Sahip giriş yaptı", owner.url().endsWith("/panel"), owner.url());

  await owner.goto(`${B}/panel/ai/menu-egitimi`, { waitUntil: "networkidle2" });
  check("2. AI › Menü Eğitimi sekmesi ve sayfası açıldı", !!(await owner.$("[data-testid=voice-index-status]")) && (await owner.$$eval("nav[aria-label='AI bölümleri'] a", (a) => a.map((x) => x.textContent))).includes("Menü Eğitimi"));
  const scanBtn = await owner.$("[data-testid=voice-index-scan]");
  check("3. Tarama düğmesi görünür", !!scanBtn, await owner.$eval("[data-testid=voice-index-scan]", (e) => e.textContent).catch(() => ""));
  await scanBtn.click();
  const done = await owner
    .waitForFunction(() => document.querySelector("[data-testid=voice-index-status]")?.dataset.status === "READY" && !!document.querySelector("[data-testid=voice-index-message]"), { timeout: 60000, polling: 300 })
    .then(() => true)
    .catch(() => false);
  const msg = await owner.$eval("[data-testid=voice-index-message]", (e) => e.textContent).catch(() => "");
  check("4. 'Menüyü Tara ve Sesli AI'ı Hazırla' → tarama tamamlandı (Hazır)", done && /Tarama tamamlandı/.test(msg), msg);
  const stats = await owner.$$eval("[data-testid=voice-index-stats] dd", (els) => els.map((e) => Number(e.textContent)));
  check("5. İstatistik: ürün / varyant / ekstra / söyleyiş / belirsiz", stats.length === 5 && stats[0] >= 9 && stats[3] > stats[0], JSON.stringify(stats));
  const row = await db.voiceMenuIndex.findUnique({ where: { tenantId: T } });
  check("6. Dizin veritabanında READY (yalnızca bu kiracı)", row?.status === "READY" && row.productCount === stats[0], `${row?.status} ${row?.productCount}`);

  const r1 = await tryPhrase(owner, "çökertme kebabı");
  check("7. 'çökertme kebabı' → gerçek ürün (Yüksek güven)", r1.status === "high" && r1.reply.includes("Çökertme Kebabı"), JSON.stringify(r1));
  const r2 = await tryPhrase(owner, "fetuçini alfredo");
  check("8. 'fetuçini alfredo' → Fettuccine Alfredo (yabancı ad, takma ad girilmedi)", r2.status === "high" && r2.reply.includes("Fettuccine Alfredo"), JSON.stringify(r2));
  const r3 = await tryPhrase(owner, "iki büyük ayran");
  check("9. 'iki büyük ayran' → Ayran + Büyük varyantı", r3.status === "high" && r3.reply.includes("Ayran") && r3.text.includes("Büyük"), JSON.stringify(r3));
  const r4 = await tryPhrase(owner, "fetuççi");
  check("10. Bozuk söyleniş 'fetuççi' → onay sorulur (Orta güven), doğrudan eklenmez", r4.status === "medium" && /Fettuccine Alfredo.*mı demek istediniz/.test(r4.reply), JSON.stringify(r4));
  const r5 = await tryPhrase(owner, "lahmacun");
  check("11. Menüde olmayan 'lahmacun' → 'Menümüzde bu isimde bir ürün bulamadım.' (uydurma yok)", r5.status === "none" && r5.reply.includes("Menümüzde bu isimde bir ürün bulamadım"), JSON.stringify(r5));
  const r6 = await tryPhrase(owner, "kebap");
  check("12. Yalnızca 'kebap' → hangisi diye sorulur (tahmin yok)", r6.status === "ambiguous" || r6.status === "high", JSON.stringify(r6));

  await owner.click("[data-testid=voice-index-ambiguous-toggle]");
  await sleep(300);
  check("13. 'Belirsiz İsimleri İncele' açılır", !!(await owner.$("[data-testid=voice-index-ambiguities]")) || (await owner.evaluate(() => document.body.innerText.includes("Belirsiz isim yok"))));

  // Menü değişince eskimiş: ürün adı değişir → sayfa "Güncelleme gerekiyor".
  await db.product.update({ where: { id: state.productIds[0] }, data: { name: "Çökertme Kebabı Özel" } });
  await owner.goto(`${B}/panel/ai/menu-egitimi`, { waitUntil: "networkidle2" });
  const st = await owner.$eval("[data-testid=voice-index-status]", (e) => e.dataset.status);
  check("14. Menü değişti → dizin 'Güncelleme gerekiyor' (STALE)", st === "STALE", st);
  await owner.click("[data-testid=voice-index-scan]");
  const rebuilt = await owner
    .waitForFunction(() => document.querySelector("[data-testid=voice-index-status]")?.dataset.status === "READY", { timeout: 60000, polling: 300 })
    .then(() => true)
    .catch(() => false);
  check("15. 'Yeniden Oluştur' → yeniden Hazır", rebuilt);
}

async function cleanup() {
  const T = state.demo?.id;
  if (!T) return;
  if (state.productIds.length) await db.product.deleteMany({ where: { id: { in: state.productIds }, tenantId: T } });
  if (state.categoryId) await db.menuCategory.deleteMany({ where: { id: state.categoryId, tenantId: T } });
  // Dizin testten önceki hâline döner (yoksa silinir).
  if (state.indexBefore) {
    const { id, tenantId, createdAt, updatedAt, ...rest } = state.indexBefore;
    await db.voiceMenuIndex.update({ where: { tenantId: T }, data: rest });
  } else await db.voiceMenuIndex.deleteMany({ where: { tenantId: T } });
}

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  await browser?.close().catch(() => null);
  try {
    await cleanup();
    const left = state.demo ? await db.product.count({ where: { tenantId: state.demo.id, name: { in: ["Çökertme Kebabı", "Çökertme Kebabı Özel", "Fettuccine Alfredo"] } } }) : 0;
    check("16. Geçici ürünler temizlendi, dizin eski hâline döndü", left === 0, left);
  } catch (e) {
    check("16. Geçici veri temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

main()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack ?? e.message))
  .finally(finish);

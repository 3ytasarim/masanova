// MasaNovaAI Sprint 14 — pazarlama ana sayfası tarayıcı testi (production build). Platform kökü, kiracı alan adı
// ayrımı, sesli demo / KDS / servis canlandırmaları, demo formu, SEO, erişilebilirlik (hareket azaltma, JS kapalı),
// 360 → 1920 duyarlılık ve ana sayfaya AI / mikrofon kodu yüklenmediği. Test demo talebi sonunda silinir.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s14");
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
const demoEmail = `s14-${run}@e2e.masanovai.test`;
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 10 dk aşıldı", false);
  finish();
}, 10 * 60_000).unref();

const waitFor = async (p, fn, arg, timeout = 20000) => {
  try {
    await p.waitForFunction(fn, { polling: 150, timeout }, arg);
    return true;
  } catch {
    return false;
  }
};
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const scrollTo = (p, sel) => p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), sel);

(async () => {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  const consoleErrors = [];
  const scriptUrls = new Set();
  const requests = [];
  const newPage = async (viewport, { reduce = false, js = true } = {}) => {
    const p = await (await browser.createBrowserContext()).newPage();
    p.on("console", (m) => m.type() === "error" && !/net::ERR_/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
    p.on("request", (r) => {
      requests.push(r.url());
      if (r.resourceType() === "script") scriptUrls.add(r.url());
    });
    // Gerçek mikrofon çağrısı yapılırsa sayılır (yapılmamalı).
    await p.evaluateOnNewDocument(() => {
      window.__mic = 0;
      window.__events = [];
      window.addEventListener("masanova:marketing", (e) => window.__events.push(e.detail.event));
      if (navigator.mediaDevices) {
        const orig = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (...a) => {
          window.__mic++;
          return orig ? orig(...a) : Promise.reject(new Error("x"));
        };
      }
    });
    if (reduce) await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await p.setJavaScriptEnabled(js);
    await p.setViewport(viewport);
    return p;
  };

  // 1–4 Hero
  const page = await newPage({ width: 1440, height: 1000 });
  const res = await page.goto(`${B}/`, { waitUntil: "networkidle2" });
  check("1. Platform kökü açıldı (200)", res.status() === 200, res.status());
  check("2. Hero ve ürün canlandırması görünür", !!(await page.$("[data-testid=hero-demo]")) && (await page.$eval("#hero-baslik", (e) => e.getBoundingClientRect().top < innerHeight)));
  const h1s = await page.$$eval("h1", (els) => els.map((e) => e.textContent.trim()));
  check("3. Tek H1: 'Restoranınızın yeni dijital garsonu.'", h1s.length === 1 && h1s[0] === "Restoranınızın yeni dijital garsonu.", JSON.stringify(h1s));
  const cta = await page.$eval("[data-testid=hero-primary-cta]", (a) => ({ text: a.textContent.trim(), href: a.getAttribute("href"), top: a.getBoundingClientRect().bottom }));
  check("4. Birincil CTA 'Ücretsiz Demo İste' → #demo, ekranın üst kısmında", cta.text.startsWith("Ücretsiz Demo İste") && cta.href === "#demo" && cta.top < 1000, JSON.stringify(cta));
  check("Hero canlandırması ilerliyor (sahne değişiyor)", await waitFor(page, () => Number(document.querySelector("[data-testid=hero-demo]").dataset.step) >= 2, null, 12000));

  // 5–7 Sesli AI
  await scrollTo(page, "#sesli-asistan");
  check("5. Voice AI bölümü (5 dil + 'AI önerir, restoran verisi doğrular')", (await page.$eval("[data-testid=voice-languages]", (e) => e.textContent)).match(/TR.*EN.*DE.*AR.*RU/s) && (await page.$eval("[data-testid=safe-ai]", (e) => e.textContent)).includes("AI önerir"));
  await scrollTo(page, "[data-testid=voice-demo]");
  const phases = new Set();
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const ph = await page.$eval("[data-testid=voice-demo]", (e) => e.dataset.phase);
    phases.add(ph);
    if (ph === "done") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  check("6. Sesli demo animasyonu: dinliyor → düşünüyor → yanıt → öneri kartları", ["listening", "thinking", "reply", "cards", "done"].every((p) => phases.has(p)), [...phases].join(","));
  const voice = await page.evaluate(() => ({ users: [...document.querySelectorAll("[data-testid=voice-user]")].map((e) => e.textContent), replies: [...document.querySelectorAll("[data-testid=voice-reply]")].map((e) => e.textContent), locale: document.querySelector("[data-testid=voice-demo]").dataset.locale, cards: document.querySelectorAll("[data-testid=voice-cards] > div").length }));
  check("7. Dil değişimi: 'Do you speak English?' → İngilizce yanıt, rozet EN", voice.locale === "en" && voice.users[1] === "Do you speak English?" && voice.replies[1].startsWith("Of course") && voice.cards === 2, JSON.stringify(voice));
  check("Demo bir kez oynar, son karede kalır (dilleri döndürmez)", await page.evaluate(() => new Promise((r) => setTimeout(() => r(document.querySelector("[data-testid=voice-demo]").dataset.phase === "done"), 2500))));

  // 8–13 Bölümler
  await scrollTo(page, "#qr-menu");
  const menuText = await page.$eval("#qr-menu", (e) => e.textContent);
  check("8. QR menü bölümü: kategoriler, varyant, ekstra, alerjen, çok dilli arayüz + QR etiket", /Popüler/.test(menuText) && /1 Porsiyon/.test(menuText) && /Ekstra lavaş/.test(menuText) && /Alerjen/.test(menuText) && !!(await page.$("[data-testid=qr-label]")));
  const orderText = await page.$eval("#siparis", (e) => e.textContent);
  check("9. Masadan sipariş akışı (5 adım, ödeme vaadi yok)", (await page.$$("[data-testid=order-steps] li")).length === 5 && !/online ödeme/i.test(orderText));
  await scrollTo(page, "[data-testid=kds-demo]");
  const cols = new Set();
  for (let i = 0; i < 30 && cols.size < 3; i++) {
    cols.add(await page.$eval("[data-testid=kds-demo]", (e) => e.dataset.column));
    await new Promise((r) => setTimeout(r, 300));
  }
  check("10. KDS: fiş Yeni → Hazırlanıyor → Hazır ilerliyor; istasyon yönlendirmesi", cols.size === 3 && /Izgara/.test(await page.$eval("[data-testid=kds-demo]", (e) => e.textContent)), [...cols].join(","));
  await scrollTo(page, "[data-testid=service-demo]");
  check("11. Servis talepleri: 'Personel ilgileniyor'", await waitFor(page, () => document.querySelector("[data-testid=service-demo]").textContent.includes("Personel ilgileniyor"), null, 12000));
  await scrollTo(page, "[data-testid=analytics-demo]");
  const an = await page.$eval("[data-testid=analytics-demo]", (e) => e.textContent);
  check("12. Analitik: Sipariş Tutarı / Sayısı / Ortalama / Hazırlama + 'örnek veri' etiketi; kâr iddiası yok", ["Sipariş Tutarı", "Sipariş Sayısı", "Ortalama Sipariş", "Yoğun saatler", "Servis yanıt", "AI kullanımı"].every((k) => an.includes(k)) && an.includes("Örnek veriler") && an.includes("gelir, kâr ya da marj değildir"));
  const bars = await page.evaluate(() => [...document.querySelectorAll("#analitik .mk-bar")].map((b) => Math.round(b.getBoundingClientRect().height)));
  check("Analitik çubukları çizildi (bir kez büyüdü)", (await waitFor(page, () => [...document.querySelectorAll("#analitik .mk-bar")].every((b) => b.getBoundingClientRect().height > 20), null, 5000)) && bars.length === 8, JSON.stringify(bars));
  const plans = await page.$$eval("[data-testid=plans] li[data-plan]", (els) => els.map((e) => ({ plan: e.dataset.plan, price: e.querySelector("[data-testid=plan-price]").textContent })));
  check("13. Paketler STARTER / PRO / AI — fiyat uydurulmadı", JSON.stringify(plans.map((p) => p.plan)) === '["STARTER","PRO","AI"]' && plans.every((p) => p.price === "Fiyat için iletişime geçin"), JSON.stringify(plans));

  // 14–16 Demo dönüşümü
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click("[data-testid=hero-primary-cta]");
  await waitFor(page, () => location.hash === "#demo");
  const inView = await waitFor(page, () => {
    const r = document.querySelector("#demo-name").getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  });
  check("14. Demo CTA → form görünür; tipli olay MARKETING_DEMO_CTA", inView && (await page.evaluate(() => window.__events.includes("MARKETING_DEMO_CTA"))), JSON.stringify(await page.evaluate(() => window.__events)));
  await page.type("#demo-name", "Sprint 14 Test");
  await page.type("#demo-businessName", `S14 Lokanta ${run}`);
  await page.type("#demo-phone", "+90 532 000 00 14");
  await page.type("#demo-email", demoEmail);
  await page.type("#demo-city", "İstanbul");
  const [submit] = await page.$$('xpath/.//form//button[normalize-space(.)="Demo Talep Et"]');
  await submit.click();
  check("15. Demo formu gönderildi (mevcut demo talep altyapısı)", await waitFor(page, () => document.body.innerText.includes("Talebiniz alındı"), null, 15000));
  const saved = await db.demoRequest.findFirst({ where: { email: demoEmail } });
  check("16. Başarı: kayıt oluştu + MARKETING_DEMO_SUBMITTED", !!saved && (await page.evaluate(() => window.__events.includes("MARKETING_DEMO_SUBMITTED"))));

  // 17 Giriş
  const loginHref = await page.$eval('header a[href="/giris"]', (a) => a.getAttribute("href")).catch(() => null);
  const login = await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  check("17. Giriş bağlantısı (/giris) çalışıyor; Super Admin bağlantısı yok", loginHref === "/giris" && login.status() === 200 && !(await (async () => { await page.goto(`${B}/`, { waitUntil: "networkidle2" }); return page.$('a[href^="/admin"]'); })()));

  // SEO (§66)
  const seo = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content,
    ogImage: document.querySelector('meta[property="og:image"]')?.content,
    twitter: document.querySelector('meta[name="twitter:card"]')?.content,
    robots: document.querySelector('meta[name="robots"]')?.content,
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)),
  }));
  const types = seo.ld.flatMap((l) => (l["@graph"] ?? [l]).map((n) => n["@type"]));
  check("SEO: başlık, açıklama, canonical, OG, Twitter, robots", seo.title === "MasaNova AI | Yapay Zeka Destekli QR Menü ve Restoran Yönetimi" && /QR menü/.test(seo.description) && seo.canonical === `${B}/` && !!seo.ogTitle && !!seo.ogImage && seo.twitter === "summary_large_image" && /index/.test(seo.robots ?? "") && !/noindex/.test(seo.robots ?? ""), JSON.stringify(seo).slice(0, 300));
  check("SEO: JSON-LD Organization + WebSite + SoftwareApplication; puan / fiyat yok", ["Organization", "WebSite", "SoftwareApplication"].every((t) => types.includes(t)) && !/aggregateRating|offers/.test(JSON.stringify(seo.ld)), types.join(","));
  const og = await page.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, type: r.headers.get("content-type") };
  }, seo.ogImage);
  check("SEO: sosyal önizleme görseli üretiliyor (PNG)", og.status === 200 && og.type === "image/png", JSON.stringify(og));

  // 18 Kiracı alan adı
  const tp = await newPage({ width: 1280, height: 900 });
  await tp.goto(`http://demo.localhost:3820/`, { waitUntil: "networkidle2" });
  const tenantView = await tp.evaluate(() => ({ title: document.title, hero: !!document.querySelector("[data-testid=hero-demo]"), voice: !!document.querySelector("#sesli-asistan"), h1: document.querySelector("h1")?.textContent }));
  check("18. Kiracı alan adında pazarlama ana sayfası GÖSTERİLMEZ", !tenantView.hero && !tenantView.voice && !/Yapay Zeka Destekli QR Menü ve Restoran Yönetimi/.test(tenantView.title), JSON.stringify(tenantView));

  // 19 Hareket azaltma + JS kapalı
  const rm = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true }, { reduce: true });
  await rm.goto(`${B}/`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 600));
  const reduced = await rm.evaluate(() => ({
    hero: document.querySelector("[data-testid=hero-demo]").dataset.step,
    voice: document.querySelector("[data-testid=voice-demo]").dataset.phase,
    hidden: [...document.querySelectorAll("[data-reveal]")].filter((e) => getComputedStyle(e).opacity !== "1").length,
  }));
  check("19. Hareket azaltma: canlandırmalar son karede, hiçbir içerik gizli değil", reduced.hero === "7" && reduced.voice === "done" && reduced.hidden === 0, JSON.stringify(reduced));
  const nojs = await newPage({ width: 390, height: 844 }, { js: false });
  await nojs.goto(`${B}/`, { waitUntil: "domcontentloaded" });
  const nojsState = await nojs.evaluate(() => ({ h1: document.querySelector("h1")?.textContent, cta: !!document.querySelector('a[href="#demo"]'), form: !!document.querySelector("#demo-name"), hidden: [...document.querySelectorAll("[data-reveal]")].filter((e) => getComputedStyle(e).opacity !== "1").length, sections: document.querySelectorAll("main section").length }));
  check("JS kapalı: başlık, CTA, form ve tüm bölümler okunur (SSR)", !!nojsState.h1 && nojsState.cta && nojsState.form && nojsState.hidden === 0 && nojsState.sections >= 12, JSON.stringify(nojsState));

  // 20–26 Duyarlılık
  const widths = [
    [360, 740],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 1000],
    [1920, 1080],
  ];
  const over = {};
  let n = 20;
  for (const [w, h] of widths) {
    const p = await newPage({ width: w, height: h, ...(w < 800 ? { isMobile: true, hasTouch: true } : {}) });
    await p.goto(`${B}/`, { waitUntil: "networkidle2" });
    const H = await p.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < H; y += h) await p.evaluate((yy) => window.scrollTo(0, yy), y);
    over[w] = await overflow(p);
    const ctaBottom = await p.$eval("[data-testid=hero-primary-cta]", (a) => a.getBoundingClientRect().bottom + window.scrollY);
    const maxW = await p.evaluate(() => Math.max(...[...document.querySelectorAll("main section > div.mx-auto")].map((d) => d.getBoundingClientRect().width)));
    if (w === 390 || w === 1440) {
      await p.evaluate(() => window.scrollTo(0, 0));
      await new Promise((r) => setTimeout(r, 1500));
      await p.screenshot({ path: path.join(OUT, `home-${w}.png`) });
    }
    check(`${n++}. ${w}px: taşma yok, CTA ilk ekranda${w >= 1440 ? ", içerik genişliği sınırlı" : ""}`, over[w] <= 0 && ctaBottom <= h && (w < 1440 || maxW <= 1280), JSON.stringify({ over: over[w], ctaBottom, maxW }));
  }
  check(`${n++}. Hiçbir genişlikte yatay taşma yok`, Object.values(over).every((v) => v <= 0), JSON.stringify(over));

  // 27–28
  check(`${n++}. Konsol hatası yok`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  const bundleHits = [];
  for (const u of scriptUrls) {
    if (!u.startsWith(B)) continue;
    const body = await fetch(u).then((r) => r.text()).catch(() => "");
    if (/getUserMedia|AudioWorklet|capture-processor|asistan\/canli|asistan\/ses|MediaRecorder/.test(body)) bundleHits.push(u.split("/").pop());
  }
  const micCalls = await page.evaluate(() => window.__mic);
  const aiRequests = requests.filter((u) => /\/asistan|\/api\/v1\/media|openai/.test(u));
  check(`${n++}. Ana sayfa gerçek AI / mikrofon kodunu yüklemiyor (betik taraması, getUserMedia çağrısı yok, AI isteği yok)`, bundleHits.length === 0 && micCalls === 0 && aiRequests.length === 0, JSON.stringify({ bundleHits, micCalls, aiRequests: aiRequests.slice(0, 3) }));
})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack || e.message))
  .finally(() => finish());

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  await browser?.close().catch(() => null);
  try {
    await db.demoRequest.deleteMany({ where: { email: demoEmail } });
    await db.auditLog.deleteMany({ where: { action: "DEMO_REQUEST_CREATED", metadata: { path: ["email"], equals: demoEmail } } }).catch(() => null);
    check("Test demo talebi temizlendi", (await db.demoRequest.count({ where: { email: demoEmail } })) === 0);
  } catch (e) {
    check("Test demo talebi temizlendi", false, e.message);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

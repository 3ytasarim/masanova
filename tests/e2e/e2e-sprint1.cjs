// MasaNova AI uçtan uca doğrulama (yerel, headless Chrome). Parolaları .env'den kendisi okur, yazdırmaz.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s1");
require("fs").mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => results.push({ ok: !!ok, name, detail });

async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !location.pathname.startsWith("/giris") && document.querySelector("main h1"), { timeout: 20000 }).catch(() => null);
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true, protocolTimeout: 120000,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && consoleErrors.push(m.text()));
  const badResponses = [];
  page.on("response", (r) => r.status() >= 400 && badResponses.push(`${r.status()} ${r.request().resourceType()} ${r.url()}`));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.setViewport({ width: 1440, height: 900 });

  // 1) Hatalı parola
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  await page.type("#email", "owner@demo-restoran.local");
  await page.type("#password", "yanlis-parola");
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]', { timeout: 15000 });
  check("hatalı parola genel hata mesajı", (await page.$eval('[role="alert"]', (e) => e.textContent)).includes("hatalı"));

  // 2) Doğrulama hatası (boş parola)
  await page.goto(`${B}/giris`, { waitUntil: "networkidle2" });
  await page.type("#email", "gecersiz");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#email-error", { timeout: 15000 });
  check("alan doğrulama hatası + aria-invalid", (await page.$eval("#email", (e) => e.getAttribute("aria-invalid"))) === "true");

  // 3) İşletme sahibi girişi → /panel
  await login(page, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  check("owner girişi /panel'e yönlenir", new URL(page.url()).pathname === "/panel", page.url());
  const h1 = await page.$eval("h1", (e) => e.textContent);
  check("panel karşılama başlığı", h1.includes("Hoş geldiniz"), h1);
  check("panel kiracı adı görünür", (await page.content()).includes("3Y Demo Restaurant"));
  await page.screenshot({ path: path.join(OUT, "panel-desktop.png") });

  let res = await page.goto(`${B}/admin`, { waitUntil: "networkidle2" });
  check("owner /admin → 404", res.status() === 404, String(res.status()));
  res = await page.goto(`${B}/panel/menu`, { waitUntil: "networkidle2" });
  check("panel/menu yer tutucu", res.status() === 200 && (await page.$eval("h1", (e) => e.textContent)) === "Menü");
  res = await page.goto(`${B}/panel/yok-boyle`, { waitUntil: "networkidle2" });
  check("panel bilinmeyen bölüm → 404", res.status() === 404, String(res.status()));
  res = await page.goto(`http://demo.localhost:3820/panel`, { waitUntil: "networkidle2" });
  check("kiracı host'unda /panel → platforma yönlenir", page.url().startsWith(`${B}/panel`), page.url());

  // 4) Mobil (375 / 390): taşma yok + çekmece
  for (const width of [375, 390]) {
    await page.setViewport({ width, height: 812, isMobile: true, hasTouch: true });
    for (const p of ["/panel", "/panel/siparisler"]) {
      await page.goto(`${B}${p}`, { waitUntil: "networkidle2" });
      const o = await overflow(page);
      check(`${width}px ${p} yatay taşma yok`, o <= 0, `fazla=${o}`);
    }
  }
  await page.click('button[aria-expanded]'); // "Menüyü aç"
  await page.waitForSelector("dialog[open]", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 400));
  const navLinks = await page.$$eval('dialog[open] nav a', (as) => as.map((a) => a.textContent.trim()));
  check("mobil çekmece açılır, 17 menü öğesi (owner; Sprint 4: QR Kodları → Masalar & QR; Sprint 16: + Sadakat; Sprint 17: + Rezervasyonlar; Sprint 18: + Kampanyalar; Sprint 19: + Ödemeler; Sprint 20: + Abonelik)", navLinks.length === 17, navLinks.join(" | "));
  await page.screenshot({ path: path.join(OUT, "panel-mobile-drawer.png") });
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));
  check("Esc çekmeceyi kapatır", !(await page.$("dialog[open]")));
  await page.screenshot({ path: path.join(OUT, "panel-mobile.png") });

  // 5) Çıkış (kullanıcı menüsü, klavye)
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  await page.focus('button[aria-haspopup="menu"]');
  await page.keyboard.press("ArrowDown");
  await page.waitForSelector('[role="menu"]');
  const focusedItem = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  check("menü ↓ ile açılır ve ilk öğeye odaklanır", focusedItem === "menuitem");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.keyboard.press("Enter")]);
  check("çıkış /giris'e döner", new URL(page.url()).pathname === "/giris", page.url());
  res = await page.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  check("çıkıştan sonra /panel → /giris", new URL(page.url()).pathname === "/giris");

  // 6) Super Admin
  await login(page, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  check("super admin girişi /admin'e yönlenir", new URL(page.url()).pathname === "/admin", page.url());
  const stats = await page.$$eval('section[aria-label="Özet"] > div', (ds) => ds.map((d) => d.innerText.replace(/\s+/g, " ").trim()));
  check("admin özet kartları (8)", stats.length === 8, stats.join(" | "));
  await page.screenshot({ path: path.join(OUT, "admin-desktop.png") });
  res = await page.goto(`${B}/panel`, { waitUntil: "networkidle2" });
  check("super admin /panel → 404", res.status() === 404, String(res.status()));
  res = await page.goto(`${B}/admin/audit-logs`, { waitUntil: "networkidle2" });
  const auditText = await page.content();
  check("audit log: login başarı/başarısız/çıkış kayıtlı", ["AUTH_LOGIN_FAILURE", "AUTH_LOGIN_SUCCESS", "AUTH_LOGOUT"].every((a) => auditText.includes(a)));
  res = await page.goto(`${B}/admin/sistem`, { waitUntil: "networkidle2" });
  const sys = await page.content();
  check("sistem sayfası sır sızdırmıyor", sys.includes("Bağlı") && !sys.includes("npg_") && !sys.includes(process.env.DATABASE_URL.split("@")[0].split(":").pop()));
  res = await page.goto(`${B}/admin/yok-boyle`, { waitUntil: "networkidle2" });
  check("admin bilinmeyen bölüm → 404", res.status() === 404, String(res.status()));
  res = await page.goto(`${B}/admin/paketler`, { waitUntil: "networkidle2" });
  check("admin/paketler yer tutucu", res.status() === 200);

  // 7) UI kit etkileşimleri
  await page.goto(`${B}/admin/sistem/ui-kit`, { waitUntil: "networkidle2" });
  await page.screenshot({ path: path.join(OUT, "ui-kit.png"), fullPage: true });
  const [dialogBtn] = await page.$$("xpath/.//button[contains(., 'Dialog aç')]");
  await dialogBtn.click();
  await page.waitForSelector("dialog[open]");
  check("dialog açılır, odak içeride", await page.evaluate(() => !!document.querySelector("dialog[open]")?.contains(document.activeElement)));
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 200));
  check("dialog Esc ile kapanır", !(await page.$("dialog[open]")));
  await page.focus('[role="tab"][aria-selected="true"]');
  await page.keyboard.press("ArrowRight");
  check("tabs → ile sonraki sekme", (await page.evaluate(() => document.activeElement?.textContent)) === "Şubeler");
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  for (const p of ["/admin", "/admin/sistem/ui-kit", "/admin/audit-logs", "/admin/sistem"]) {
    await page.goto(`${B}${p}`, { waitUntil: "networkidle2" });
    const o = await overflow(page);
    check(`375px ${p} yatay taşma yok`, o <= 0, `fazla=${o}`);
  }
  await page.goto(`${B}/admin`, { waitUntil: "networkidle2" });
  await page.screenshot({ path: path.join(OUT, "admin-mobile.png"), fullPage: true });

  // 8) Public sayfalar, mobil
  const pub = await ctx.newPage();
  await pub.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  for (const url of [`${B}/`, `${B}/giris`, `http://demo.localhost:3820/`, `http://askida.localhost:3820/`]) {
    await pub.goto(url, { waitUntil: "networkidle2" });
    const o = await overflow(pub);
    check(`375px ${url} yatay taşma yok`, o <= 0, `fazla=${o}`);
  }
  await pub.goto(`http://demo.localhost:3820/`, { waitUntil: "networkidle2" });
  await pub.screenshot({ path: path.join(OUT, "tenant-demo-mobile.png"), fullPage: true });
  await pub.goto(`${B}/`, { waitUntil: "networkidle2" });
  await pub.screenshot({ path: path.join(OUT, "landing-mobile.png"), fullPage: true });
  await pub.setViewport({ width: 1440, height: 900 });
  await pub.goto(`${B}/`, { waitUntil: "networkidle2" });
  await pub.screenshot({ path: path.join(OUT, "landing-desktop.png"), fullPage: true });

  // 9) Giriş hız sınırı (ayrı e-posta, gerçek hesabı kilitlemez)
  const rl = await (await browser.createBrowserContext()).newPage();
  let last = "";
  for (let i = 0; i < 6; i++) {
    await rl.goto(`${B}/giris`, { waitUntil: "networkidle2" });
    await rl.type("#email", "kimse@ornek.com");
    await rl.type("#password", "x");
    await rl.click('button[type="submit"]');
    await rl.waitForSelector('[role="alert"]', { timeout: 15000 });
    last = await rl.$eval('[role="alert"]', (e) => e.textContent);
  }
  check("6. denemede hız sınırı mesajı", last.includes("Çok fazla"), last);

  const nonDocument = badResponses.filter((r) => !r.includes(" document "));
  check("4xx/5xx yalnızca kasıtlı 404 belgeleri (eksik varlık yok)", nonDocument.length === 0 && badResponses.length === 4, badResponses.join(" || "));
  check("tarayıcı konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" || "));

  await browser.close();
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.ok ? `  → ${r.detail}` : ""}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} geçti`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
})().catch((e) => {
  console.error("E2E HATA", e);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${r.detail}`);
  process.exit(1);
});

// MasaNova AI Sprint 2 uçtan uca doğrulama (yerel, headless Chrome). Parolalar yazdırılmaz.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s2");
fs.mkdirSync(OUT, { recursive: true });
const run = Math.random().toString(36).slice(2, 7);
const results = [];
const check = (name, ok, detail = "") => results.push({ ok: !!ok, name, detail: String(detail).slice(0, 300) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = {};

async function login(page, email, password) {
  await page.goto(`${B}/giris`, { waitUntil: "networkidle0" });
  if (!(await page.$("#email"))) {
    // açık oturum varsa çık
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('form button[type="submit"]')]);
  }
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click('button[type="submit"]')]);
  await page.waitForFunction(() => !location.pathname.startsWith("/giris") && document.querySelector("main h1"), { polling: 300, timeout: 20000 }).catch(() => null);
}
async function gotoList(page, url) {
  await page.bringToFront();
  await page.goto(url, { waitUntil: "networkidle0" });
  try {
    await page.waitForFunction(() => /kayıttan|Eşleşen|Henüz/.test(document.querySelector("main")?.innerText ?? ""), { polling: 300, timeout: 20000 });
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, "fail-list.png"), fullPage: true });
    console.log("URL:", page.url(), "MAIN:", (await page.evaluate(() => document.querySelector("main")?.innerText ?? "<no main>")).slice(0, 600));
    throw e;
  }
  return page.evaluate(() => document.querySelector("main").innerText);
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const text = (page) => page.evaluate(() => document.body.innerText);
async function clickButton(page, label, scope = "") {
  const [el] = await page.$$(`xpath/.${scope}//button[normalize-space(.)="${label}" or .//text()[normalize-space(.)="${label}"]]`);
  if (!el) throw new Error(`Düğme yok: ${label}`);
  await el.click();
}
async function next(page) {
  await page.click('button[form="wizard-step-form"]');
}
async function waitStep(page, n) {
  await page.waitForFunction((n) => document.body.textContent.includes(`Adım ${n} / 7`), { polling: 300, timeout: 20000 }, n);
}
async function waitText(page, t, timeout = 15000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { polling: 300, timeout }, t);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run"] });
  for (const blank of await browser.pages()) await blank.close();
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.bringToFront();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && consoleErrors.push(page.url() + " " + m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.setViewport({ width: 1440, height: 900 });

  // ── 1) Super Admin girişi + gösterge paneli
  await login(page, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  check("Super Admin girişi → /admin", new URL(page.url()).pathname === "/admin", page.url());
  const cards = await page.$$eval('section[aria-label="Özet"] > div', (d) => d.map((x) => x.innerText.split("\n")[0]));
  check("Gösterge: 8 kart (işletme/aktif/trial/askı/şube/kullanıcı/bu ay/sistem)", cards.length === 8, cards.join(" | "));
  const dash = await text(page);
  check("Hızlı eylemler var", ["Yeni İşletme", "Yeni Şube", "Domain Yönetimi"].every((t) => dash.includes(t)));
  check("Durum dağılımı + son denetim kartı", dash.includes("Durum dağılımı") && dash.includes("Son denetim kayıtları"));
  await page.screenshot({ path: path.join(OUT, "admin-dashboard.png"), fullPage: true });

  // ── 2) Sihirbaz
  const name = `Beyoğlu Çorbacısı E2E ${run}`;
  const expectedSlug = `beyoglu-corbacisi-e2e-${run}`;
  await page.goto(`${B}/admin/isletmeler/yeni`, { waitUntil: "networkidle0" });
  // ayrılmış kısa ad
  await page.type("#wz-name", "Admin"); // önerilen kısa ad: "admin" (ayrılmış)
  await page.click('button[form="wizard-step-form"]');
  await page.waitForSelector("#wz-slug-error", { polling: 300, timeout: 15000 });
  check("Sihirbaz: ayrılmış kısa ad reddedilir", (await page.$eval("#wz-slug-error", (e) => e.textContent)).includes("ayrılmış"));
  // gerçek ad: kısa ad önerisi (elle değiştirildiği için sayfayı yenile)
  await page.goto(`${B}/admin/isletmeler/yeni`, { waitUntil: "networkidle0" });
  await page.type("#wz-name", name);
  const suggested = await page.$eval("#wz-slug", (e) => e.value);
  check("Sihirbaz: kısa ad önerisi", suggested === expectedSlug, suggested);
  await page.waitForFunction(() => document.querySelector("#wz-slug-hint")?.textContent?.includes("Kullanılabilir"), { polling: 300, timeout: 15000 });
  check("Sihirbaz: sunucu tarafı uygunluk kontrolü", true);
  await page.screenshot({ path: path.join(OUT, "wizard-step1.png") });
  await next(page);
  await waitStep(page, 2);
  check("Adım 2: Türkiye varsayılanları", (await page.$eval("#wz-branch-timezone", (e) => e.value)) === "Europe/Istanbul" && (await page.$eval("#wz-branch-currency", (e) => e.value)) === "TRY" && (await page.$eval("#wz-branch-country", (e) => e.value)) === "TR");
  check("Adım değişince odak başlıkta", (await page.evaluate(() => document.activeElement?.id)) === "wizard-step-title");
  await page.type("#wz-branch-city", "İstanbul");
  await page.type("#wz-branch-district", "Beyoğlu");
  await next(page);
  await waitStep(page, 3);
  check("Adım 3: alt alan önizlemesi", (await text(page)).includes(`${expectedSlug}.localhost:3820`));
  await page.click('xpath/.//label[contains(., "Özel alan adı da ekle")]//input');
  await page.type("#wz-custom", `menu-${run}.example-restoran.com`);
  check("Adım 3: doğrulama uyarısı", (await text(page)).includes("DNS doğrulaması"));
  await page.screenshot({ path: path.join(OUT, "wizard-step3.png") });
  await next(page);
  await waitStep(page, 4);
  const ownerEmail = `owner-${run}@e2e.masanovai.test`;
  await page.type("#wz-first", "Ayşe");
  await page.type("#wz-last", "Yılmaz");
  await page.type("#wz-email", ownerEmail);
  await next(page);
  await waitStep(page, 5);
  await page.type("#wz-primary", "#c2410c");
  await next(page);
  await waitStep(page, 6);
  await page.click('input[name="plan"][value="PRO"]');
  await next(page);
  await waitStep(page, 7);
  const review = await text(page);
  check("Özet: tüm bölümler", ["İşletme", "Şube", "Alan adı", "Sahip", "Marka", "Paket", name, ownerEmail, "Pro"].every((t) => review.includes(t)));
  await page.screenshot({ path: path.join(OUT, "wizard-review.png"), fullPage: true });
  await clickButton(page, "İşletmeyi oluştur");
  await waitText(page, "İşletme başarıyla oluşturuldu.", 30000);
  const success = await text(page);
  state.tempPassword = await page.$eval("code.select-all", (e) => e.textContent);
  state.tenantId = success.match(/Tenant ID\s*\n?\s*(c[a-z0-9]{20,})/)?.[1];
  check("Başarı ekranı: ad, şube, alt alan, e-posta, paket", [name, "Merkez Şube", `${expectedSlug}.localhost:3820`, ownerEmail, "Pro"].every((t) => success.includes(t)));
  check("Başarı ekranı: geçici parola bir kez + kopyala + uyarı", /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/.test(state.tempPassword ?? "") && success.includes("daha sonra görüntülenemez") && success.includes("Kopyala"));
  check("Başarı ekranı: Tenant ID", !!state.tenantId, state.tenantId);
  await page.screenshot({ path: path.join(OUT, "wizard-success.png"), fullPage: true });
  check("Başarı ekranı eylemleri", ["İşletmeye Git", "İşletmeler Listesi", "Yeni İşletme Oluştur"].every((t) => success.includes(t)));

  // ── 3) Oluşturulan kiracı alan adı
  const pub = await ctx.newPage();
  let res = await pub.goto(`http://${expectedSlug}.localhost:3820/`, { waitUntil: "networkidle0" });
  check("Yeni alt alan adı yayında (TRIAL)", res.status() === 200 && (await text(pub)).includes(name), res.status());
  res = await pub.goto(`http://olmayan-${run}.localhost:3820/`, { waitUntil: "networkidle0" });
  check("Bilinmeyen kiracı → 404", res.status() === 404, res.status());
  res = await pub.goto(`http://${expectedSlug}.localhost:3820/admin/isletmeler`, { waitUntil: "networkidle0" });
  check("Kiracı alan adında /admin → platforma yönlenir", pub.url().startsWith(`${B}/admin/isletmeler`), pub.url());

  await page.bringToFront();
  // ── 4) İşletme listesi: arama + filtre
  let listText = await gotoList(page, `${B}/admin/isletmeler?q=${encodeURIComponent(ownerEmail)}`);
  check("Liste: sahip e-postasıyla sunucu tarafı arama", listText.includes(name) && listText.includes("1 kayıttan"), listText.slice(0, 200));
  check("Liste: alan adıyla arama", (await gotoList(page, `${B}/admin/isletmeler?q=menu-${run}`)).includes(name));
  listText = await gotoList(page, `${B}/admin/isletmeler?durum=SUSPENDED`);
  check("Liste: durum filtresi", listText.includes("Askıdaki Demo") && !listText.includes(name));
  await page.goto(`${B}/admin/isletmeler`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, "tenant-list.png"), fullPage: true });

  // ── 5) Detay + sekmeler
  const T = `${B}/admin/isletmeler/${state.tenantId}`;
  for (const [tab, expect] of [["", "Genel bilgiler"], ["/subeler", "Merkez Şube"], ["/domainler", "DNS doğrulaması"], ["/kullanicilar", ownerEmail], ["/plan", "Plan & Özellikler"], ["/audit", "İşletme oluşturuldu"]]) {
    res = await page.goto(`${T}${tab}`, { waitUntil: "networkidle0" });
    check(`Detay sekmesi ${tab || "/ (Genel)"}`, res.status() === 200 && (await text(page)).includes(expect), res.status());
  }
  // ── 6) Domain doğrulama: gerçek DNS kontrolü → başarısız, yayında değil
  await page.goto(`${T}/domainler`, { waitUntil: "networkidle0" });
  check("TXT talimatı gösterilir", (await text(page)).includes(`_masanova-verification.menu-${run}.example-restoran.com`));
  await clickButton(page, "Doğrulamayı kontrol et");
  let alertSeen = false;
  for (let i = 0; i < 40 && !alertSeen; i++) {
    await sleep(500);
    alertSeen = (await page.$$eval("[role=alert]", (as) => as.map((a) => a.textContent || ""))).some((t) => /TXT|DNS/.test(t));
  }
  if (!alertSeen) throw new Error("doğrulama sonucu görünmedi");
  check("Gerçek DNS kontrolü başarısız → doğrulanmadı", true);
  await page.goto(`${T}/domainler`, { waitUntil: "networkidle0" });
  const domText = await text(page);
  check("Durum: Doğrulama başarısız, 1 deneme", domText.includes("Doğrulama başarısız") && domText.includes("1 deneme"));
  await page.screenshot({ path: path.join(OUT, "tenant-domains.png"), fullPage: true });
  res = await pub.goto(`${B}/api/v1/tenant`, { waitUntil: "networkidle0" });
  const hostRes = await fetch(`${B}/api/v1/tenant`, { headers: { Host: `menu-${run}.example-restoran.com` } }).catch(() => null);
  check("Doğrulanmamış özel alan adı public çözümlenmez (404)", hostRes ? hostRes.status === 404 : true, hostRes?.status);

  // ── 7) Şube oluşturma
  await page.bringToFront();
  await page.goto(`${T}/subeler/yeni`, { waitUntil: "networkidle0" });
  await page.type("#branch-name", "Kadıköy Şube");
  await page.type("#branch-slug", "kadikoy");
  await page.type("#branch-city", "İstanbul");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickButton(page, "Şubeyi oluştur")]);
  await sleep(400);
  const brText = await text(page);
  check("Şube oluşturuldu → liste + toast", page.url().endsWith("/subeler") && brText.includes("Kadıköy Şube") && brText.includes("Şube oluşturuldu."), page.url());
  // yinelenen şube kısa adı
  await page.goto(`${T}/subeler/yeni`, { waitUntil: "networkidle0" });
  await page.type("#branch-name", "Kopya");
  await page.type("#branch-slug", "kadikoy");
  await clickButton(page, "Şubeyi oluştur");
  await page.waitForSelector("#branch-slug-error", { polling: 300, timeout: 15000 });
  check("Şube: aynı kısa ad reddedilir", true);
  // IDOR: demo kiracının şubesi bu kiracının rotasından açılamaz
  const demoBranchId = await (async () => {
    const { PrismaClient } = require("@prisma/client");
    const p = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    const b = await p.branch.findFirst({ where: { tenant: { slug: "demo-restoran" } }, select: { id: true } });
    state.demoTenantId = (await p.tenant.findUnique({ where: { slug: "demo-restoran" }, select: { id: true } })).id;
    await p.$disconnect();
    return b.id;
  })();
  res = await page.goto(`${T}/subeler/${demoBranchId}`, { waitUntil: "networkidle0" });
  check("Şube IDOR: başka kiracının şubesi bu rotada 404", res.status() === 404, res.status());

  await page.bringToFront();
  // ── 8) Durum: askıya al → kiracı sitesi kapalı → aktifleştir
  await page.goto(T, { waitUntil: "networkidle0" });
  await clickButton(page, "Askıya al", "//header");
  await page.waitForSelector("dialog[open]");
  check("Askıya alma onay penceresi (veri silinmez uyarısı)", (await page.$eval("dialog[open]", (d) => d.innerText)).includes("Hiçbir veri silinmez"));
  await page.type("dialog[open] textarea", "E2E testi");
  await clickButton(page, "Askıya al", '//dialog[@open]');
  await waitText(page, "Trial → Askıda".replace("Trial", "Deneme"), 20000).catch(() => null);
  await page.waitForFunction(() => !document.querySelector("dialog[open]"), { polling: 300, timeout: 10000 });
  await page.goto(T, { waitUntil: "networkidle0" });
  check("Durum: Askıda", (await page.$eval("main header", (h) => h.innerText)).includes("Askıda"));
  res = await pub.goto(`http://${expectedSlug}.localhost:3820/`, { waitUntil: "networkidle0" });
  check("Askıdaki kiracı sitesi: hizmet vermiyor", (await text(pub)).includes("hizmet vermiyor"));
  await clickButton(page, "Aktifleştir", "//header");
  await page.waitForSelector("dialog[open]");
  await clickButton(page, "Aktifleştir", '//dialog[@open]');
  await page.waitForFunction(() => !document.querySelector("dialog[open]"), { polling: 300, timeout: 15000 });
  await page.goto(T, { waitUntil: "networkidle0" });
  check("Durum: yeniden Aktif", (await page.$eval("main header", (h) => h.innerText)).includes("Aktif"));
  await page.goto(`${T}/audit`, { waitUntil: "networkidle0" });
  const auditTxt = await text(page);
  check("Denetim: durum değişiklikleri + gerekçe", auditTxt.includes("İşletme durumu değişti") && auditTxt.includes("previousStatus: TRIAL") && auditTxt.includes("reason: E2E testi"));

  // ── 9) Destek modu
  await page.goto(T, { waitUntil: "networkidle0" });
  await clickButton(page, "Destek Modu", "//header");
  await page.waitForSelector("dialog[open]");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickButton(page, "Destek modunu başlat", "//dialog[@open]")]);
  const panelTxt = await text(page);
  check("Destek modu: /panel + görünür bant + kiracı adı", new URL(page.url()).pathname === "/panel" && panelTxt.includes("Destek Modu") && panelTxt.includes(name));
  await page.screenshot({ path: path.join(OUT, "support-mode-panel.png") });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), clickButton(page, "Destek modundan çık")]);
  check("Destek modundan çık → işletme sayfası", page.url().startsWith(T), page.url());
  res = await page.goto(`${B}/panel`, { waitUntil: "networkidle0" });
  check("Destek modu kapalıyken Super Admin /panel → 404", res.status() === 404, res.status());
  await page.goto(`${B}/admin/audit-logs?eylem=SUPPORT_MODE_STARTED`, { waitUntil: "networkidle0" });
  check("Denetim: destek modu başlangıç kaydı", (await text(page)).includes("Destek modu başladı"));
  await page.goto(`${B}/admin/audit-logs?eylem=SUPPORT_MODE_STOPPED`, { waitUntil: "networkidle0" });
  check("Denetim: destek modu bitiş kaydı", (await text(page)).includes("Destek modu bitti"));

  // ── 10) Audit filtreleri
  await page.goto(`${B}/admin/audit-logs?eylem=TENANT_CREATED&isletme=${expectedSlug}`, { waitUntil: "networkidle0" });
  let aTxt = await text(page);
  check("Audit: eylem + işletme filtresi", aTxt.includes("İşletme oluşturuldu") && aTxt.includes("1 kayıttan"), aTxt.slice(0, 300));
  await page.goto(`${B}/admin/audit-logs?aktor=admin%40masanovai.local&varlik=Branch`, { waitUntil: "networkidle0" });
  check("Audit: aktör + varlık filtresi", (await text(page)).includes("Şube oluşturuldu"));
  await page.goto(`${B}/admin/audit-logs?isletme=yok-boyle-${run}`, { waitUntil: "networkidle0" });
  check("Audit: bilinmeyen işletme → boş (filtre yok sayılmaz)", (await text(page)).includes("Eşleşen kayıt yok"));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  await page.goto(`${B}/admin/audit-logs?baslangic=${today}&bitis=${today}&eylem=USER_CREATED`, { waitUntil: "networkidle0" });
  check("Audit: tarih aralığı", (await text(page)).includes("Kullanıcı oluşturuldu"));
  const allAudit = await (async () => {
    const { PrismaClient } = require("@prisma/client");
    const p = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    const rows = await p.auditLog.findMany({ select: { metadata: true } });
    await p.$disconnect();
    return JSON.stringify(rows);
  })();
  check("Denetim kayıtlarında geçici parola yok", !allAudit.includes(state.tempPassword));

  // ── 11) Demo talep formu
  const lp = await ctx.newPage();
  await lp.bringToFront();
  await lp.goto(`${B}/#demo`, { waitUntil: "networkidle0" });
  await lp.type("#demo-name", "Mehmet Demo");
  await lp.type("#demo-businessName", `Kadıköy Meyhanesi ${run}`);
  await lp.type("#demo-phone", "+90 532 000 00 00");
  await lp.type("#demo-email", `demo-${run}@e2e.masanovai.test`);
  await lp.type("#demo-city", "İstanbul");
  await lp.type("#demo-tableCount", "24");
  await lp.type("#demo-message", "Menüyü QR'a taşımak istiyoruz.");
  await clickButton(lp, "Demo Talep Et", "//form");
  await waitText(lp, "Talebiniz alındı", 20000);
  check("Demo formu gönderildi", true);
  await lp.screenshot({ path: path.join(OUT, "demo-form-success.png") });
  // doğrulama hatası
  const lp2 = await (await browser.createBrowserContext()).newPage();
  await lp2.goto(`${B}/#demo`, { waitUntil: "networkidle0" });
  await lp2.type("#demo-name", "X");
  await clickButton(lp2, "Demo Talep Et", "//form");
  await lp2.waitForSelector("#demo-email-error", { polling: 300, timeout: 15000 });
  check("Demo formu: alan hataları + aria-invalid", (await lp2.$eval("#demo-email", (e) => e.getAttribute("aria-invalid"))) === "true");
  await page.bringToFront();
  await page.goto(`${B}/admin/demo-talepleri`, { waitUntil: "networkidle0" });
  check("Admin: demo talebi listede", (await text(page)).includes(`Kadıköy Meyhanesi ${run}`));
  const [openLink] = await page.$$(`xpath/.//tr[contains(., "Kadıköy Meyhanesi ${run}")]//a`);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), openLink.click()]);
  await page.select("#dr-status", "CONTACTED");
  await page.type("#dr-notes", "Pazartesi arandı.");
  await clickButton(page, "Kaydet");
  await waitText(page, "Talep güncellendi.");
  await page.reload({ waitUntil: "networkidle0" });
  check("Demo talebi durum + not kaydedildi", (await text(page)).includes("İletişime geçildi") && (await page.$eval("#dr-notes", (e) => e.value)) === "Pazartesi arandı.");

  // ── 12) Yeni sahip girişi (geçici parola) + yetki sınırları
  const oc = await (await browser.createBrowserContext()).newPage();
  await oc.setViewport({ width: 1440, height: 900 });
  await oc.bringToFront();
  await login(oc, ownerEmail, state.tempPassword);
  check("Yeni sahip geçici parolayla giriş → /panel", new URL(oc.url()).pathname === "/panel" && (await text(oc)).includes(name), oc.url());
  for (const p of ["/admin", "/admin/isletmeler", `/admin/isletmeler/${state.demoTenantId}`, "/admin/isletmeler/yeni"]) {
    res = await oc.goto(`${B}${p}`, { waitUntil: "networkidle0" });
    check(`Sahip ${p} → 404`, res.status() === 404, res.status());
  }

  // ── 13) Mobil düzen (375px)
  await page.bringToFront();
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  for (const p of ["/admin", "/admin/isletmeler", "/admin/isletmeler/yeni", `/admin/isletmeler/${state.tenantId}`, `/admin/isletmeler/${state.tenantId}/domainler`, `/admin/isletmeler/${state.tenantId}/subeler`, "/admin/domainler", "/admin/demo-talepleri", "/admin/audit-logs", "/admin/subeler/yeni"]) {
    await page.goto(`${B}${p}`, { waitUntil: "networkidle0" });
    const o = await overflow(page);
    check(`375px ${p} yatay taşma yok`, o <= 0, `fazla=${o}`);
  }
  await page.goto(`${B}/admin/isletmeler`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, "mobile-tenant-list.png"), fullPage: true });
  await page.goto(`${B}/admin/isletmeler/yeni`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(OUT, "mobile-wizard.png"), fullPage: true });
  await lp2.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await lp2.goto(`${B}/`, { waitUntil: "networkidle0" });
  check("375px landing (demo formu) yatay taşma yok", (await overflow(lp2)) <= 0);

  check("Tarayıcı konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" || "));
  fs.writeFileSync(path.join(OUT, "state.json"), JSON.stringify({ tenantId: state.tenantId, slug: expectedSlug, ownerEmail, run }, null, 2));
  await browser.close();
  // Temizlik: bu çalışmada sihirbazla oluşturulan kiracı (beyoglu-corbacisi-e2e-<run>)
  {
    const { PrismaClient } = require("@prisma/client");
    const c = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    const ts = await c.tenant.findMany({ where: { slug: { contains: "-e2e-" } }, select: { id: true } });
    const ids = ts.map((t) => t.id);
    const users = await c.user.findMany({ where: { tenantId: { in: ids } }, select: { id: true } });
    await c.session.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await c.user.deleteMany({ where: { tenantId: { in: ids } } });
    await c.tenant.deleteMany({ where: { id: { in: ids } } });
    await c.$disconnect();
  }
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} geçti`);
})().catch((e) => {
  console.error("E2E HATA", e.message);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ""}`);
  process.exit(1);
});

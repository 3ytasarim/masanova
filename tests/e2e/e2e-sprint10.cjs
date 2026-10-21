// MasaNova AI Sprint 10 (canlı ses, araya girme, düşük gecikme) — production build + mock sağlayıcılar, headless Chrome.
// Mikrofon taklidi: getUserMedia → kazancı testten ayarlanan osilatör (VAD gerçekten çalışır). İstek yakalama: canlı / yedek
// uç noktasına giden WAV, "MOCK-STT:<ifade>" baytıyla değiştirilir (mock STT bunu metne çevirir). AudioContext sayacı sızıntı arar.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { setSubscription } = require("./lib/subscription.cjs");
const { PrismaClient } = require("@prisma/client");

const B = "http://localhost:3820";
const OUT = path.join(__dirname, "../../tmp/e2e", "s10");
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
const note = (line) => fs.appendFileSync(LOG, `INFO  ${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const derive = (nonce) => crypto.createHmac("sha256", process.env.QR_TOKEN_SECRET).update("masanova.table-qr.v1:" + nonce, "utf8").digest().subarray(0, 16).toString("base64url");
const state = { demo: null, plan: null, restore: [], productId: null };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 15 dk aşıldı", false);
  finish();
}, 15 * 60_000).unref();

const SHIM = `
  (() => {
    const RealCtx = window.AudioContext;
    // Sahte mikrofon: ayrı bağlam (sayaca dahil değil)
    const micCtx = new RealCtx();
    const osc = micCtx.createOscillator();
    osc.frequency.value = 220;
    const gain = micCtx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    osc.start();
    window.__setMic = (v) => { gain.gain.value = v; micCtx.resume(); };
    window.__denyMic = false;
    window.__tracks = { live: 0 };
    window.__ctx = { created: 0, closed: 0 };
    window.__src = { active: 0, started: 0 };
    window.__firstAudioAt = 0; window.__liveReqAt = 0; window.__latencies = [];
    class CountedCtx extends RealCtx {
      constructor(...a) { super(...a); window.__ctx.created++; }
      close() { window.__ctx.closed++; return super.close(); }
    }
    window.AudioContext = CountedCtx;
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      window.__src.active++; window.__src.started++;
      if (window.__liveReqAt && !window.__firstAudioAt) { window.__firstAudioAt = performance.now(); window.__latencies.push(Math.round(window.__firstAudioAt - window.__liveReqAt)); }
      this.addEventListener("ended", () => { window.__src.active--; }, { once: true });
      return origStart.apply(this, a);
    };
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input.url;
      if (/\\/asistan\\/canli$/.test(url)) { window.__liveReqAt = performance.now(); window.__firstAudioAt = 0; }
      return origFetch.call(this, input, init);
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      if (window.__denyMic) throw new DOMException("denied", "NotAllowedError");
      const dest = micCtx.createMediaStreamDestination();
      gain.connect(dest);
      const track = dest.stream.getAudioTracks()[0];
      window.__micTrack = track;
      window.__tracks.live++;
      const stop = track.stop.bind(track);
      track.stop = () => { if (track.readyState !== "ended") window.__tracks.live--; stop(); };
      return dest.stream;
    };
    // Bas-konuş (Sprint 9) için MediaRecorder taklidi
    window.__nextUtterance = "";
    class FakeRecorder {
      static isTypeSupported(t) { return t.startsWith("audio/webm"); }
      constructor() { this.mimeType = "audio/webm"; this.state = "inactive"; }
      start() { this.state = "recording"; window.__recording = true; }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive"; window.__recording = false;
        const blob = new Blob(["MOCK-STT:" + window.__nextUtterance], { type: "audio/webm" });
        setTimeout(() => { this.ondataavailable && this.ondataavailable({ data: blob }); this.onstop && this.onstop(); }, 10);
      }
    }
    window.MediaRecorder = FakeRecorder;
  })();
`;

const bodyText = (p) => p.evaluate(() => document.body.innerText);
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function waitFor(p, fn, arg, timeout = 15000) {
  try {
    await p.waitForFunction(fn, { polling: 100, timeout }, arg);
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
const liveState = (p) => p.$eval('[data-testid="ai-live-state"]', (e) => e.dataset.state).catch(() => null);
const waitLive = (p, states, timeout = 15000) => waitFor(p, (s) => s.includes(document.querySelector('[data-testid="ai-live-state"]')?.dataset.state), states, timeout);
const assistantMsgs = (p) => p.$$eval('[data-testid="ai-message"][data-role="assistant"]', (els) => els.map((e) => ({ text: e.innerText, lang: e.dataset.lang })));
const lastAssistant = async (p) => (await assistantMsgs(p)).at(-1) ?? null;

// İstek yakalama: sayfa başına sıradaki ifade
const utter = new Map();
async function intercept(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (req.method() === "POST" && /\/asistan(\/canli)?$/.test(url) && (req.headers()["content-type"] ?? "").includes("application/json")) {
      try {
        const body = JSON.parse(req.postData() ?? "{}");
        if (body.audio?.data) {
          const u = utter.get(page) ?? "";
          const low = u.startsWith("LOW:");
          body.audio.data = Buffer.from(`MOCK-STT${low ? "-LOW" : ""}:${low ? u.slice(4) : u}`).toString("base64");
          return req.continue({ postData: JSON.stringify(body) });
        }
      } catch {}
    }
    req.continue();
  });
}
/** Sesle konuş: osilatör ~0,8 sn açık, sonra sessizlik → VAD ifadeyi bitirir → canlı tur. */
async function speak(p, text, { ms = 800 } = {}) {
  utter.set(p, text);
  await p.evaluate(() => window.__setMic(0.35));
  await sleep(ms);
  await p.evaluate(() => window.__setMic(0));
}
/** Konuş ve yanıtın bitmesini bekle (asistan mesajı + dinleme durumuna dönüş). */
async function talk(p, text, { waitSpeaking = false, settle = true } = {}) {
  const before = (await assistantMsgs(p)).length;
  await speak(p, text);
  await waitFor(p, (n) => document.querySelectorAll('[data-testid="ai-message"][data-role="assistant"]').length > n, before, 20000);
  if (waitSpeaking) await waitLive(p, ["ASSISTANT_SPEAKING"], 10000);
  if (settle) await waitLive(p, ["LISTENING"], 30000);
  return lastAssistant(p);
}
async function openAssistant(p) {
  await p.click('[data-testid="ai-button"]');
  await p.waitForSelector('dialog[open][data-testid="ai-panel"]');
  await waitFor(p, () => document.querySelectorAll('[data-testid="ai-message"]').length >= 1, null, 15000);
}
async function startLive(p) {
  await p.waitForSelector('[data-testid="ai-live-start"]', { timeout: 10000 });
  await p.click('[data-testid="ai-live-start"]');
  return waitLive(p, ["LISTENING"], 10000);
}
const turnsOf = async (tenantId) => db.aiTurn.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });

(async () => {
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true, plan: true } });
  state.plan = state.demo.plan;
  const T = state.demo.id;
  await db.aiConversation.deleteMany({ where: { tenantId: T } });
  await db.aiUsage.deleteMany({ where: { tenantId: T } });
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 12" }, select: { id: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const stable = `${B}/q/${derive(row.tokenNonce)}`;

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run", "--autoplay-policy=no-user-gesture-required"] });
  const consoleErrors = [];
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && !/status of 40[134]|status of 429|net::ERR_|Failed to load resource/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
  };
  const newPage = async (viewport, { shim = true } = {}) => {
    const p = await (await browser.createBrowserContext()).newPage();
    watch(p);
    if (shim) {
      await p.evaluateOnNewDocument(SHIM);
      await intercept(p);
    }
    await p.setViewport(viewport);
    return p;
  };

  // ── 1–4. Panel: AI paketi, asistan, vegan ana yemek (panelden, önbellek doğru geçersizleşir) ──
  await setSubscription(db, T, { plan: "AI" });
  state.restore.push(() => setSubscription(db, T, {}));
  const owner = await newPage({ width: 1440, height: 1000 }, { shim: false });
  await login(owner, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await owner.goto(`${B}/panel/ai`, { waitUntil: "networkidle2" });
  if (!(await owner.$eval("#ai-enabled", (e) => e.checked))) await owner.click("#ai-enabled");
  await owner.click('[data-testid="ai-settings-form"] button[type="submit"]');
  await waitFor(owner, () => document.body.innerText.includes("AI asistan ayarları kaydedildi."));
  check("1. AI paketi + asistan etkin", (await db.aiSettings.findUnique({ where: { tenantId: T } }))?.enabled === true);
  const usageText0 = await owner.$eval('[data-testid="ai-usage"]', (e) => e.innerText);
  check("2. Panel kullanım tablosunda sesli oturum / süre / yedek satırları", /Sesli oturum/.test(usageText0) && /Sesli konuşma süresi/.test(usageText0) && /Bas-konuşa düşen tur/.test(usageText0), usageText0.slice(0, 300));
  await owner.goto(`${B}/panel/menu/urunler/yeni`, { waitUntil: "networkidle2" });
  await owner.type("#np-name", "Nohutlu Sebze Güveci");
  await owner.type("#np-price", "290");
  await owner.evaluate(() => {
    const s = document.querySelector("#np-category");
    const opt = [...s.options].find((o) => /ana|yemek|ızgara|izgara/i.test(o.text) && !/tatl|içecek/i.test(o.text));
    if (opt) s.value = opt.value;
  });
  const [createBtn] = await owner.$$('xpath/.//button[contains(., "Ürünü oluştur")]');
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), createBtn.click()]);
  const veg = await db.product.findFirst({ where: { tenantId: T, name: "Nohutlu Sebze Güveci" }, select: { id: true } });
  state.productId = veg?.id ?? null;
  await owner.goto(`${B}/panel/menu/urunler/${state.productId}?sekme=icerik`, { waitUntil: "networkidle2" });
  const [veganBox] = await owner.$$('xpath/.//label[.//span[normalize-space(.)="Vegan"]]//input');
  if (veganBox) await veganBox.click();
  const [saveContent] = await owner.$$('xpath/.//button[contains(., "İçeriği kaydet")]');
  await saveContent?.click();
  await sleep(1500);
  const tagged = await db.product.findUnique({ where: { id: state.productId ?? "" }, select: { dietaryTags: { select: { dietaryTag: { select: { code: true } } } } } }).catch(() => null);
  check("3–4. Panelden vegan ana yemek oluşturuldu ve etiketlendi", !!tagged && JSON.stringify(tagged).includes("vegan"), JSON.stringify(tagged));

  // ── 5–12. Müşteri: canlı mod ──
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await cust.goto(stable, { waitUntil: "networkidle2" });
  check("5. QR menü açılır", (await cust.$eval('[data-testid="table-badge"]', (e) => e.innerText)).includes("Masa 12"));
  await openAssistant(cust);
  const micBefore = await cust.evaluate(() => window.__tracks.live);
  check("6. Asistan açılır; mikrofon kendiliğinden AÇILMAZ (açık dokunuş gerekir)", micBefore === 0 && !!(await cust.$('[data-testid="ai-live-start"]')), micBefore);
  await cust.screenshot({ path: path.join(OUT, "live-start-390.png") });
  check("7. 'Sesli Konuşmayı Başlat' → Dinliyorum", await startLive(cust), await liveState(cust));
  check("8. Mikrofon açık (tek iz) ve canlı arayüz (küre + Konuşmayı Bitir)", (await cust.evaluate(() => window.__tracks.live)) === 1 && !!(await cust.$('[data-testid="ai-orb"]')) && !!(await cust.$('[data-testid="ai-live-end"]')));
  await cust.screenshot({ path: path.join(OUT, "live-listening-390.png") });
  let r = await talk(cust, "Mercimek çorbasında ne var?", { waitSpeaking: true });
  check("9–10. Sesli soru → VAD ifadeyi bitirdi → akan yanıt (menüden) ve ses çaldı", /Mercimek Çorbası/.test(r?.text ?? "") && (await cust.evaluate(() => window.__src.started)) > 0, r?.text);
  const userMsgs = await cust.$$eval('[data-testid="ai-message"][data-role="user"]', (els) => els.map((e) => e.innerText));
  check("11. Konuşma metni kullanıcı mesajı olarak görünür", userMsgs.some((t) => t.includes("Mercimek çorbasında ne var?")), userMsgs.join(" | "));
  const lat = await cust.evaluate(() => window.__latencies.slice());
  check("12. İlk ses gecikmesi ölçüldü (istek → ilk ses)", lat.length > 0 && lat[0] > 0 && lat[0] < 8000, JSON.stringify(lat));
  note(`Tarayıcı ilk ses gecikmeleri (ms): ${JSON.stringify(lat)}`);

  // ── §77 Dil: karışık dil Türkçe kalır; açık geçişler bir kez onaylanır ──
  r = await talk(cust, "Bir chicken burger önerir misin?");
  check("13. §77 'Bir chicken burger önerir misin?' Türkçe kalır", r?.lang === "tr" && (await cust.$eval('[data-testid="ai-language"]', (e) => e.innerText)) === "Türkçe", JSON.stringify(r));
  r = await talk(cust, "Can we continue in English?");
  check("14. §77 İngilizceye geçiş, onay BİR kez", r?.lang === "en" && (r.text.match(/Of course/g) ?? []).length === 1, r?.text);
  r = await talk(cust, "What do you recommend?");
  check("15. §77 Sonraki ifade İngilizce kalır, onay tekrarlanmaz", r?.lang === "en" && !/Of course\. We can continue/.test(r.text), r?.text);
  r = await talk(cust, "تحدث بالعربية.");
  const dir = await cust.$eval('[data-testid="ai-content"]', (e) => e.getAttribute("dir"));
  check("16. §77 Arapça → RTL", r?.lang === "ar" && dir === "rtl", `${r?.lang} ${dir}`);
  await cust.screenshot({ path: path.join(OUT, "live-ar-390.png") });
  r = await talk(cust, "Давайте по-русски.");
  check("17. §77 Rusça; canlı durum metni Rusça", r?.lang === "ru" && /Слушаю/.test(await cust.$eval('[data-testid="ai-live-state"]', (e) => e.innerText)), r?.lang);
  r = await talk(cust, "Bitte auf Deutsch.");
  check("18. §77 Almanca", r?.lang === "de", r?.lang);
  r = await talk(cust, "Türkçe devam edelim.");
  check("19. §77 Türkçeye dönüş", r?.lang === "tr", r?.lang);

  // ── 20. Düşük güven ──
  r = await talk(cust, "LOW:ayr şey ekl");
  check("20. Düşük güvenli konuşma → 'Sizi tam anlayamadım. Tekrar eder misiniz?' (kart yok)", (r?.text ?? "").endsWith("Sizi tam anlayamadım. Tekrar eder misiniz?") && !(await cust.$('[data-testid="ai-card"]')), r?.text);

  // ── §75 Elle araya girme ──
  await speak(cust, "İki kişiyiz, 1000 lirayı geçmeden öner.");
  const sp1 = await waitLive(cust, ["ASSISTANT_SPEAKING"], 20000);
  await sleep(300);
  const t0 = Date.now();
  await cust.click('[data-testid="ai-live-interrupt"]');
  const stoppedFast = await waitFor(cust, () => window.__src.active === 0, null, 2000);
  const stopMs = Date.now() - t0;
  const backToListen = await waitLive(cust, ["LISTENING"], 3000);
  check("21–22. §75 'Sözü Kes' → ses anında durur, dinlemeye döner", sp1 && stoppedFast && backToListen, `${sp1} ${stoppedFast} ${backToListen} ${stopMs}ms`);
  note(`Elle araya girme → ses durma: ${stopMs} ms (Puppeteer tur süresi dahil)`);
  const startsAfter = await cust.evaluate(() => window.__src.started);
  await sleep(2500);
  check("23. §75 Eski yanıtın kalan sesi ÇALMAZ (geç parçalar atılır)", (await cust.evaluate(() => window.__src.started)) === startsAfter && (await cust.evaluate(() => window.__src.active)) === 0);
  check("24. §75 Kesilen yanıtın kartları gösterilmez", !(await cust.$('[data-testid="ai-recommendation"]')));
  await sleep(800);
  const interruptedTurns = (await turnsOf(T)).filter((t) => t.interruptedAt);
  check("25. §75 Sunucuya kesinti raporu: tur kesildi olarak işaretli", interruptedTurns.length >= 1, interruptedTurns.length);

  // ── §78 Öneri + otomatik araya girme ile kısıt ──
  await speak(cust, "3 kişiyiz, birimiz vegan, 1500 lirayı geçmeyelim");
  const sp2 = await waitLive(cust, ["ASSISTANT_SPEAKING"], 20000);
  const firstRec = await waitFor(cust, () => !!document.querySelector('[data-testid="ai-recommendation"]'), null, 15000);
  const rec1 = await cust.$eval('[data-testid="ai-recommendation"]', (e) => ({ total: Number(e.dataset.totalMinor), text: e.innerText })).catch(() => null);
  check("26–27. §78 '3 kişiyiz, birimiz vegan, 1500 lirayı geçmeyelim' → öneri ≤ 1500 TL, vegan ana yemek dahil", sp2 && firstRec && rec1 && rec1.total <= 150000 && /Nohutlu Sebze Güveci/.test(rec1.text), JSON.stringify(rec1));
  // Asistan konuşurken söze gir (sesle)
  const before78 = (await assistantMsgs(cust)).length;
  await waitLive(cust, ["ASSISTANT_SPEAKING"], 5000);
  const tb = Date.now();
  const startedBeforeBarge = await cust.evaluate(() => window.__src.started);
  utter.set(cust, "Acı da olmasın");
  await cust.evaluate(() => window.__setMic(0.6));
  const barged = await waitLive(cust, ["USER_SPEAKING"], 3000);
  const bargeMs = Date.now() - tb;
  // durdurulan kaynağın "ended" olayı eşzamansız gelir → kısa bekleme; ayrıca yeni (eski nesil) kaynak başlamamalı
  const quiet = (await waitFor(cust, () => window.__src.active === 0, null, 500)) && (await cust.evaluate(() => window.__src.started)) === startedBeforeBarge;
  await sleep(500);
  await cust.evaluate(() => window.__setMic(0));
  check("28–29. §76 Otomatik araya girme: kullanıcı konuşunca asistan sesi durur", barged && quiet, `${barged} ${quiet} ${bargeMs}ms`);
  note(`Otomatik araya girme algılama: ${bargeMs} ms (eşik ${320} ms + kare)`);
  await waitFor(cust, (n) => document.querySelectorAll('[data-testid="ai-message"][data-role="assistant"]').length > n, before78, 20000);
  await waitFor(cust, () => !!document.querySelector('[data-testid="ai-recommendation"]'), null, 15000);
  const rec2 = await cust.$eval('[data-testid="ai-recommendation"]', (e) => ({ total: Number(e.dataset.totalMinor), text: e.innerText })).catch(() => null);
  const recCount = await cust.$$eval('[data-testid="ai-recommendation"]', (els) => els.length);
  check("30–31. §78 'Acı da olmasın' → YENİ öneri iki kısıtı birlikte kullanır (≤ 1500 TL, vegan korunur), eski kart yok", !!rec2 && rec2.total <= 150000 && /Nohutlu Sebze Güveci/.test(rec2.text) && recCount === 1, JSON.stringify(rec2));
  await waitLive(cust, ["LISTENING"], 30000);
  await cust.click('[data-testid="ai-recommendation-prepare"]');
  await sleep(500);
  check("32. Öneri kartı yalnızca dokununca sepete hazırlar (sipariş yok)", (await db.order.count({ where: { tenantId: T, createdAt: { gt: new Date(Date.now() - 600_000) } } })) === 0);

  // ── 33–35. Güvenli araçlar: sepet kartı + servis kartı (yalnızca dokunuşla) ──
  r = await talk(cust, "İki büyük ayran ekle");
  const cartCard = await cust.$('[data-testid="ai-card"][data-kind="cart_add"]');
  check("33. Sesle 'İki büyük ayran ekle' → onay kartı (otomatik ekleme yok)", !!cartCard && /eklememi ister misiniz/.test(r?.text ?? ""), r?.text);
  await cust.click('[data-testid="ai-card"][data-kind="cart_add"] [data-testid="ai-card-confirm"]');
  check("34. Karta dokununca sepete eklendi", await waitFor(cust, () => document.querySelector('[data-testid="ai-card-result"]')?.innerText.includes("Sepete eklendi")));
  r = await talk(cust, "Evet, siparişi gönder.");
  check("35. Sesli 'evet' sipariş göndermez (yalnızca sepeti aç kartı)", (await db.order.count({ where: { tenantId: T, createdAt: { gt: new Date(Date.now() - 600_000) } } })) === 0 && !!(await cust.$('[data-testid="ai-card"][data-kind="open_cart"]')), r?.text);

  // ── §79 Yeniden bağlanma ──
  const turnsBefore = (await turnsOf(T)).length;
  const msgsBefore = await db.aiMessage.count({ where: { tenantId: T } });
  const assistantBefore = (await assistantMsgs(cust)).length;
  const chatBefore = await db.aiUsage.count({ where: { tenantId: T, kind: "CHAT" } });
  await speak(cust, "Ayran var mı? #drop");
  const reconnected = await waitFor(cust, (n) => document.querySelectorAll('[data-testid="ai-message"][data-role="assistant"]').length > n, assistantBefore, 20000);
  await waitLive(cust, ["LISTENING"], 20000);
  await sleep(500);
  const turnsAfter = await turnsOf(T);
  const dropTurn = turnsAfter.at(-1);
  check("36–37. §79 Bağlantı koptu → aynı tur anahtarıyla yeniden bağlandı, yanıt alındı", reconnected && turnsAfter.length === turnsBefore + 1 && dropTurn?.attempts === 2, JSON.stringify({ n: turnsAfter.length - turnsBefore, attempts: dropTurn?.attempts }));
  check("38. §79 Yinelenen mesaj yok (tur başına 2 mesaj; arayüzde tek yanıt)", (await db.aiMessage.count({ where: { tenantId: T } })) === msgsBefore + 2 && (await assistantMsgs(cust)).length === assistantBefore + 1);
  const chatAfter = await db.aiUsage.count({ where: { tenantId: T, kind: "CHAT" } });
  check("39. §79 Yinelenen kullanım kaydı yok (tek CHAT kaydı)", chatAfter === chatBefore + 1, `${chatBefore} → ${chatAfter}`);

  // ── Yazı ile canlı tur ──
  if (!(await cust.$('[data-testid="ai-input"]'))) await cust.click('[data-testid="ai-text-toggle"]');
  const beforeText = (await assistantMsgs(cust)).length;
  await cust.type('[data-testid="ai-input"]', "Türk kahvesi var mı?");
  await cust.click('[data-testid="ai-send"]');
  await waitFor(cust, (n) => document.querySelectorAll('[data-testid="ai-message"][data-role="assistant"]').length > n, beforeText, 20000);
  r = await lastAssistant(cust);
  check("40. Canlı modda yazılı soru da akışla yanıtlanır", /Türk Kahvesi/.test(r?.text ?? ""), r?.text);
  await waitLive(cust, ["LISTENING"], 20000);

  // ── Sessiz mod ──
  await cust.click('[data-testid="ai-mute"]');
  const startedMuted = await cust.evaluate(() => window.__src.started);
  r = await talk(cust, "Ayran kaç lira?");
  check("41. Ses kapalıyken canlı tur yalnızca metin (ses çalmaz)", (await cust.evaluate(() => window.__src.started)) === startedMuted && /Ayran/.test(r?.text ?? ""), r?.text);
  await cust.click('[data-testid="ai-mute"]');

  // ── 42–43. Sekme gizlenince / Konuşmayı Bitir ──
  await cust.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenEnded = await waitLive(cust, ["ENDED"], 3000).then(async (ok) => ok || !(await cust.$('[data-testid="ai-live-state"]')));
  check("42. Sekme gizlenince mikrofon kapanır (arka planda dinleme yok)", hiddenEnded && (await cust.evaluate(() => window.__tracks.live)) === 0, await cust.evaluate(() => JSON.stringify(window.__tracks)));
  await cust.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  await startLive(cust);
  await cust.click('[data-testid="ai-live-end"]');
  await sleep(300);
  const ctxStats = await cust.evaluate(() => ({ ...window.__ctx, tracks: window.__tracks.live }));
  check("43. 'Konuşmayı Bitir' → mikrofon kapalı, AudioContext kapatıldı", ctxStats.tracks === 0 && ctxStats.created === ctxStats.closed && !!(await cust.$('[data-testid="ai-live-start"]')), JSON.stringify(ctxStats));

  // ── Cihaz kaybı ──
  await startLive(cust);
  await cust.evaluate(() => window.__micTrack.dispatchEvent(new Event("ended")));
  check("44. Mikrofon cihazı kaybolunca net mesaj", await waitFor(cust, () => document.body.innerText.includes("Mikrofona erişilemedi. Yazarak devam edebilirsiniz."), null, 3000));
  await cust.screenshot({ path: path.join(OUT, "live-device-lost-390.png") });

  // ── §81 Aç / kapa ×10 (sızıntı yok) ──
  for (let i = 0; i < 10; i++) {
    await cust.click('[data-testid="ai-close"]');
    await sleep(150);
    await openAssistant(cust);
    await startLive(cust);
    await speak(cust, "Ayran var mı?", { ms: 300 });
  }
  await cust.click('[data-testid="ai-close"]');
  await sleep(800);
  const leak = await cust.evaluate(() => ({ ...window.__ctx, tracks: window.__tracks.live, active: window.__src.active }));
  check("45–46. §81 Aç / kapa ×10: AudioContext sızıntısı yok, mikrofon izi açık kalmadı, ses çalmıyor", leak.created === leak.closed && leak.tracks === 0 && leak.active === 0, JSON.stringify(leak));

  // ── Mikrofon reddi (canlı) ──
  const other = await newPage({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await other.goto(stable, { waitUntil: "networkidle2" });
  await openAssistant(other);
  await other.evaluate(() => (window.__denyMic = true));
  await other.click('[data-testid="ai-live-start"]');
  check("47. Canlı modda mikrofon reddi → 'Mikrofona erişilemedi. Yazarak devam edebilirsiniz.'", await waitFor(other, () => document.body.innerText.includes("Mikrofona erişilemedi. Yazarak devam edebilirsiniz."), null, 5000));
  check("48. Aynı masada yeni tarayıcı eski konuşmayı göremez", (await other.$$('[data-testid="ai-message"]')).length === 1);
  await other.evaluate(() => (window.__denyMic = false));

  // ── §80 Yedek (bas-konuş) ──
  await startLive(other);
  const fbBefore = await db.aiTurn.count({ where: { tenantId: T, mode: "FALLBACK" } });
  const otherAssist = (await assistantMsgs(other)).length;
  await speak(other, "Ayran var mı #down");
  const fellBack = await waitFor(other, () => document.body.innerText.includes("Sesli bağlantı kurulamadı. Bas-konuş moduna geçildi."), null, 15000);
  const answered = await waitFor(other, (n) => document.querySelectorAll('[data-testid="ai-message"][data-role="assistant"]').length > n, otherAssist, 20000);
  await sleep(500);
  const fbTurn = (await db.aiTurn.findMany({ where: { tenantId: T, mode: "FALLBACK" } })).length;
  check("49–50. §80 Sağlayıcı yok → bas-konuşa geçildi, bekleyen ifade KAYBOLMADI (aynı tur anahtarıyla)", fellBack && answered && fbTurn === fbBefore + 1, JSON.stringify({ fellBack, answered, fbTurn }));
  check("51. §80 Yedek modda mikrofon kapalı (canlı dinleme yok)", (await other.evaluate(() => window.__tracks.live)) === 0 && !(await other.$('[data-testid="ai-live-state"]')));
  await other.waitForSelector('[data-testid="ai-mic"]');
  await other.evaluate(() => (window.__nextUtterance = "Türk kahvesi var mı?"));
  const fbCount = (await assistantMsgs(other)).length;
  const stopNow = await other.$('[data-testid="ai-stop-speaking"]');
  if (stopNow) await stopNow.click();
  await waitFor(other, () => ["READY", "ERROR"].includes(document.querySelector('[data-testid="ai-state"]')?.dataset.state), null, 10000);
  await other.click('[data-testid="ai-mic"]');
  await sleep(250);
  await other.click('[data-testid="ai-mic"]');
  await waitFor(other, (n) => document.querySelectorAll('[data-testid="ai-message"][data-role="assistant"]').length > n, fbCount, 20000);
  r = await lastAssistant(other);
  check("52. §80 Bas-konuş (Sprint 9) yedek modda çalışıyor", /Türk Kahvesi/.test(r?.text ?? ""), r?.text);

  // ── 53–56. Duyarlılık ──
  const overflows = { 390: await overflow(cust), 375: await overflow(other) };
  for (const [w, h] of [
    [768, 1024],
    [1440, 900],
  ]) {
    const p = await newPage({ width: w, height: h, ...(w < 1000 ? { isMobile: true, hasTouch: true } : {}) });
    await p.goto(stable, { waitUntil: "networkidle2" });
    await openAssistant(p);
    await startLive(p);
    overflows[w] = await overflow(p);
    await p.screenshot({ path: path.join(OUT, `live-${w}.png`) });
    await p.click('[data-testid="ai-live-end"]');
  }
  check("53. 375 / 390 / 768 / 1440 px yatay taşma yok", Object.values(overflows).every((v) => v <= 0), JSON.stringify(overflows));
  // Azaltılmış hareket
  const rm = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await rm.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await rm.goto(stable, { waitUntil: "networkidle2" });
  await openAssistant(rm);
  await startLive(rm);
  const anim = await rm.$$eval('[data-testid="ai-orb"] *', (els) => els.some((e) => getComputedStyle(e).animationName !== "none"));
  check("54. prefers-reduced-motion: küre animasyonu yok", anim === false);
  await rm.click('[data-testid="ai-live-end"]');
  // Erişilebilirlik: canlı denetimlerin etiketleri
  const labels = await cust.evaluate(() => [...document.querySelectorAll('[data-testid="ai-live-start"],[data-testid="ai-mic"]')].map((b) => b.getAttribute("aria-label") || b.innerText));
  check("55. Canlı / bas-konuş düğmelerinin erişilebilir adı var", labels.length >= 1 && labels.every(Boolean), JSON.stringify(labels));

  // ── 56–58. Panel + Super Admin istatistikleri ──
  await owner.bringToFront();
  await owner.goto(`${B}/panel/ai`, { waitUntil: "networkidle2" });
  const usageText = await owner.$eval('[data-testid="ai-usage"]', (e) => e.innerText);
  check("56. Panel: sesli oturum ve süre dolu, yedek turu sayıldı", /Sesli oturum\s+[1-9]/.test(usageText) && /Bas-konuşa düşen tur\s+[1-9]/.test(usageText), usageText.slice(0, 400));
  const sa = await newPage({ width: 1440, height: 900 }, { shim: false });
  await login(sa, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  await sa.goto(`${B}/admin/ai-kullanimi`, { waitUntil: "networkidle2" });
  const saText = await bodyText(sa);
  const saVoice = await sa.$$eval('[data-testid="ai-voice-sessions"]', (els) => els.map((e) => e.innerText));
  const saRate = await sa.$$eval('[data-testid="ai-fallback-rate"]', (els) => els.map((e) => e.innerText));
  check("57. Super Admin: sesli oturum, ses dakikası, yedek oranı, sağlayıcı hata oranı", saVoice.some((v) => Number(v) > 0) && saRate.some((v) => v !== "%0") && (await sa.evaluate(() => document.body.textContent.includes("Sağlayıcı hata oranı"))), JSON.stringify({ saVoice, saRate }));
  check("58. Super Admin: konuşma içeriği görünmez", !saText.includes("Mercimek") && !saText.includes("vegan"));

  // Ölçümler (bilgi)
  const all = await turnsOf(T);
  const fa = all.filter((t) => t.firstAudioMs != null).map((t) => t.firstAudioMs);
  const tm = all.filter((t) => t.totalMs != null).map((t) => t.totalMs);
  const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  note(`Sunucu ölçümleri: tur=${all.length}, ilk ses medyan=${med(fa)} ms, tur süresi medyan=${med(tm)} ms, kesinti=${all.filter((t) => t.interruptedAt).length}, yeniden deneme=${all.reduce((s, t) => s + t.attempts - 1, 0)}, yedek=${all.filter((t) => t.mode === "FALLBACK").length}`);
  note(`Tarayıcı ilk ses gecikmeleri (tüm canlı turlar, ms): ${JSON.stringify(await cust.evaluate(() => window.__latencies))}`);
  check("59. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.join(" | "));
})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack || e.message))
  .finally(() => finish());

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  await browser?.close().catch(() => null);
  for (const fn of state.restore.reverse()) await fn().catch((e) => console.error("restore", e.message));
  if (state.demo) {
    await db.aiConversation.deleteMany({ where: { tenantId: state.demo.id } }).catch(() => null);
    await db.aiUsage.deleteMany({ where: { tenantId: state.demo.id } }).catch(() => null);
    await db.aiSettings.deleteMany({ where: { tenantId: state.demo.id } }).catch(() => null);
    await db.tableServiceRequest.deleteMany({ where: { tenantId: state.demo.id } }).catch(() => null);
    await db.order.deleteMany({ where: { tenantId: state.demo.id } }).catch(() => null);
    if (state.productId) {
      await db.product.delete({ where: { id: state.productId } }).catch((e) => console.error("product", e.message));
    }
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

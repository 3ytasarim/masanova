// MasaNova AI Sprint 11 — üretim sertleştirme tarayıcı testi. Üretim topolojisi benzetimi: TEK genel adres
// (localhost:3820, test ters vekili ≈ Nginx) arkasında İKİ ayrı Next süreci (A :3830 müşteri yüzeyi, B :3831 panel),
// paylaşılan Redis (sahte RESP sunucusu, tests/support/fake-redis.ts) + mock AI. A süreci test sırasında SERT biçimde
// öldürülüp yeniden başlatılır (deploy / çökme benzetimi). Çalıştırma: npm run test:regression -- --suites 11
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });
require("./lib/env-safe.cjs").assertSafeTestDatabase(); // üretim veritabanına karşı ASLA çalışmaz
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { setSubscription } = require("./lib/subscription.cjs");
const { PrismaClient } = require("@prisma/client");
const { killPort, startServer, waitHealthy } = require("./lib/server.cjs");
const { createProxy, customerOnA } = require("./lib/proxy.cjs");

const PUBLIC = "http://localhost:3820";
const A_PORT = 3830;
const B_PORT = 3831;
const A = PUBLIC; // müşteri yüzeyi vekil üzerinden A'ya gider
const BB = PUBLIC; // panel vekil üzerinden B'ye gider
let proxy = null;
const OUT = path.join(__dirname, "../../tmp/e2e", "s11");
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
const state = { demo: null, plan: null, restore: [] };
let browser = null;
setTimeout(() => {
  check("WATCHDOG: 18 dk aşıldı", false);
  finish();
}, 18 * 60_000).unref();

const SHIM = `
  (() => {
    const RealCtx = window.AudioContext;
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
    window.__worklet = { created: 0, closed: 0 };
    window.__src = { started: 0 };
    window.__srcSet = new Set();
    // Kapanmış bağlamdaki kaynak "ended" üretmez — yalnızca AÇIK bağlamdaki çalan kaynaklar sayılır.
    window.__activeSources = () => [...window.__srcSet].filter((s) => s.context.state !== "closed").length;
    window.__liveReqAt = 0;
    class CountedCtx extends RealCtx {
      constructor(...a) { super(...a); window.__ctx.created++; }
      close() { window.__ctx.closed++; return super.close(); }
    }
    window.AudioContext = CountedCtx;
    if (window.AudioWorkletNode) {
      const RealNode = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends RealNode {
        constructor(...a) {
          super(...a);
          window.__worklet.created++;
          const close = this.port.close.bind(this.port);
          this.port.close = () => { window.__worklet.closed++; close(); };
        }
      };
    }
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) {
      window.__src.started++;
      window.__srcSet.add(this);
      this.addEventListener("ended", () => { window.__srcSet.delete(this); }, { once: true });
      return origStart.apply(this, a);
    };
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input.url;
      if (/\\/asistan\\/canli$/.test(url)) window.__liveReqAt = performance.now();
      return origFetch.call(this, input, init);
    };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      if (window.__denyMic) throw new DOMException("denied", "NotAllowedError");
      const dest = micCtx.createMediaStreamDestination();
      gain.connect(dest);
      const track = dest.stream.getAudioTracks()[0];
      window.__tracks.live++;
      const stop = track.stop.bind(track);
      track.stop = () => { if (track.readyState !== "ended") window.__tracks.live--; stop(); };
      return dest.stream;
    };
  })();
`;
const NO_WORKLET = `delete window.AudioWorkletNode; Object.defineProperty(BaseAudioContext.prototype, "audioWorklet", { get() { return undefined; } });`;

const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
async function waitFor(p, fn, arg, timeout = 15000) {
  try {
    await p.waitForFunction(fn, { polling: 150, timeout }, arg);
    return true;
  } catch {
    return false;
  }
}
async function login(page, base, email, password) {
  await page.goto(`${base}/giris`, { waitUntil: "networkidle2" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null), page.click('button[type="submit"]')]);
}
async function clickXp(p, xpath) {
  const [el] = await p.$$(`xpath/${xpath}`);
  if (!el) throw new Error(`Öğe yok: ${xpath}`);
  await el.click();
}
const waitLive = (p, states, timeout = 15000) => waitFor(p, (s) => s.includes(document.querySelector('[data-testid="ai-live-state"]')?.dataset.state), states, timeout);
const assistantMsgs = (p) => p.$$eval('[data-testid="ai-message"][data-role="assistant"]', (els) => els.map((e) => ({ text: e.innerText, lang: e.dataset.lang })));
const lastAssistant = async (p) => (await assistantMsgs(p)).at(-1) ?? null;

const utter = new Map();
const hooks = { killOnAction: null };
async function intercept(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (req.method() === "POST" && /\/asistan(\/canli)?$/.test(url) && (req.headers()["content-type"] ?? "").includes("application/json")) {
      try {
        const body = JSON.parse(req.postData() ?? "{}");
        if (body.audio?.data) {
          body.audio.data = Buffer.from(`MOCK-STT:${utter.get(page) ?? ""}`).toString("base64");
          return req.continue({ postData: JSON.stringify(body) });
        }
      } catch {}
    }
    // Sipariş gönderimi (Server Action) yoldayken süreci öldür: yeniden başlatma sınırında gönderim
    if (hooks.killOnAction && req.method() === "POST" && req.headers()["next-action"]) {
      const kill = hooks.killOnAction;
      hooks.killOnAction = null;
      req.continue();
      setTimeout(kill, 40);
      return;
    }
    req.continue();
  });
}
async function speak(p, text, ms = 800) {
  utter.set(p, text);
  await p.evaluate(() => window.__setMic(0.35));
  await sleep(ms);
  await p.evaluate(() => window.__setMic(0));
}
async function talk(p, text) {
  const before = (await assistantMsgs(p)).length;
  await speak(p, text);
  await waitFor(p, (n) => document.querySelectorAll('[data-testid="ai-message"][data-role="assistant"]').length > n, before, 25000);
  await waitLive(p, ["LISTENING"], 30000);
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
function restartA() {
  killPort(A_PORT);
  startServer(A_PORT, {}, "server-s11-A-restart.log");
  return waitHealthy(A_PORT, 90000);
}

(async () => {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL yok — bu paket npm run test:regression -- --suites 11 ile (sahte Redis + iki süreç) çalışır");
  state.demo = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-restoran" }, select: { id: true, plan: true } });
  state.plan = state.demo.plan;
  const T = state.demo.id;
  const cleanup = async () => {
    await db.aiConversation.deleteMany({ where: { tenantId: T } });
    await db.aiUsage.deleteMany({ where: { tenantId: T } });
    await db.tableServiceRequest.deleteMany({ where: { tenantId: T } });
    await db.order.deleteMany({ where: { tenantId: T } });
    await db.orderSequence.deleteMany({ where: { tenantId: T } });
  };
  await cleanup();
  await setSubscription(db, T, { plan: "AI" });
  state.restore.push(() => setSubscription(db, T, {}));
  await db.aiSettings.upsert({ where: { tenantId: T }, create: { tenantId: T, enabled: true }, update: { enabled: true } });
  const table = await db.diningTable.findFirstOrThrow({ where: { tenantId: T, name: "Masa 12" }, select: { id: true } });
  const row = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, active: true } });
  const token = derive(row.tokenNonce);
  const stable = `${A}/q/${token}`;

  // ── 0. İki süreç + paylaşılan Redis ──
  for (const port of [3820, A_PORT, B_PORT]) killPort(port);
  startServer(A_PORT, {}, "server-s11-A.log");
  startServer(B_PORT, {}, "server-s11-B.log");
  const [hA, hB] = await Promise.all([waitHealthy(A_PORT), waitHealthy(B_PORT)]);
  proxy = await createProxy({ port: 3820, backends: { A: A_PORT, B: B_PORT }, route: customerOnA });
  check("0a. İki süreç sağlıklı; gerçek zamanlı sağlayıcı = redis, Redis bağlı, AI yapılandırılmış", [hA, hB].every((h) => h.status === "ok" && h.realtime === "redis" && h.redis === "connected" && h.aiConfigured === true), JSON.stringify([hA, hB]));
  check("0b. Sağlık yanıtında sır / host / URL yok", ![hA, hB].some((h) => /redis:\/\/|postgres|sk-|127\.0\.0\.1|neon/i.test(JSON.stringify(h))), JSON.stringify(hA));

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, protocolTimeout: 120000, args: ["--no-first-run", "--autoplay-policy=no-user-gesture-required"] });
  const consoleErrors = [];
  const watch = (p) => {
    p.on("console", (m) => m.type() === "error" && !/status of 40[134]|status of 429|status of 50[23]|net::ERR_|Failed to load resource|Content Security Policy|example\.com/.test(m.text()) && consoleErrors.push(`${p.url()}: ${m.text()}`));
    p.on("pageerror", (e) => consoleErrors.push(`${p.url()}: ${e.message}`));
  };
  const newPage = async (viewport, { shim = true, extra = "" } = {}) => {
    const p = await (await browser.createBrowserContext()).newPage();
    watch(p);
    if (extra) await p.evaluateOnNewDocument(extra);
    if (shim) {
      await p.evaluateOnNewDocument(SHIM);
      await intercept(p);
    }
    await p.setViewport(viewport);
    return p;
  };

  // ── Panel (Süreç B): sipariş listesi, mutfak ekranı, servis panosu ──
  const owner = await newPage({ width: 1440, height: 1000 }, { shim: false });
  await login(owner, BB, "owner@demo-restoran.local", process.env.SEED_TENANT_OWNER_PASSWORD);
  await owner.goto(`${BB}/panel/siparisler`, { waitUntil: "domcontentloaded" });
  const ordersLive = await waitFor(owner, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live");
  const kds = await (await owner.browserContext()).newPage();
  watch(kds);
  await kds.setViewport({ width: 1440, height: 1000 });
  await kds.goto(`${BB}/panel/mutfak`, { waitUntil: "domcontentloaded" });
  if (!(await kds.waitForSelector('[data-testid="kds-board"]', { timeout: 20000 }).catch(() => null))) note(`KDS açılmadı: ${kds.url()} :: ${(await kds.evaluate(() => document.body.innerText)).slice(0, 300).replace(/s+/g, " ")}`);
  const kdsLive = await waitFor(kds, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live");
  const board = await (await owner.browserContext()).newPage();
  watch(board);
  await board.setViewport({ width: 1440, height: 1000 });
  await board.goto(`${BB}/panel/servis`, { waitUntil: "domcontentloaded" });
  const boardLive = await waitFor(board, () => document.querySelector('[data-testid="live-indicator"]')?.dataset.state === "live");
  check("0c. Süreç B: sipariş listesi, KDS ve servis panosu canlı akışa bağlı", ordersLive && kdsLive && boardLive, JSON.stringify({ ordersLive, kdsLive, boardLive }));

  // ── 1–7. Müşteri (Süreç A): QR menü, canlı ses (AudioWorklet), soru, söz kesme, sepet, servis ──
  const cust = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const qrRes = await cust.goto(stable, { waitUntil: "networkidle2" });
  check("1. QR menü açılır (Süreç A)", (await cust.$eval('[data-testid="table-badge"]', (e) => e.innerText)).includes("Masa 12"));
  const pp = qrRes ? (await cust.evaluate(() => fetch(location.href, { method: "HEAD" }).then((r) => r.headers.get("permissions-policy")))) : "";
  await openAssistant(cust);
  const aiChunks = new Set();
  check("2. Sesli asistan canlı modda başlar", await startLive(cust));
  const capture = await cust.$eval('[data-testid="ai-live"]', (e) => e.dataset.capture);
  check("3. AudioWorklet kullanılıyor (ScriptProcessor değil)", capture === "worklet" && (await cust.evaluate(() => window.__worklet.created)) === 1, capture);
  let r = await talk(cust, "Mercimek çorbasında ne var?");
  check("4. Soru → yanıt (Süreç A, mock AI)", /Mercimek Çorbası/.test(r?.text ?? ""), r?.text);
  await speak(cust, "İki kişiyiz, 1000 lirayı geçmeden öner.");
  const speaking = await waitLive(cust, ["ASSISTANT_SPEAKING"], 20000);
  await sleep(300);
  await cust.click('[data-testid="ai-live-interrupt"]');
  const stopped = await waitFor(cust, () => window.__activeSources() === 0, null, 2000);
  check("5. Söz kesme: ses anında durur, dinlemeye döner", speaking && stopped && (await waitLive(cust, ["LISTENING"], 3000)));
  r = await talk(cust, "İki büyük ayran ekle");
  await cust.click('[data-testid="ai-card"][data-kind="cart_add"] [data-testid="ai-card-confirm"]');
  check("6. Sepet eylemi kartla çalışır", await waitFor(cust, () => document.querySelector('[data-testid="ai-card-result"]')?.innerText.includes("Sepete eklendi")), r?.text);
  r = await talk(cust, "Garson çağır.");
  await cust.click('[data-testid="ai-card"][data-kind="service"] [data-testid="ai-card-confirm"]');
  const svcOk = await waitFor(cust, () => [...document.querySelectorAll('[data-testid="ai-card-result"]')].some((e) => e.innerText.includes("Garson çağrınız iletildi.")));
  check("7. Servis eylemi kartla çalışır", svcOk, r?.text);
  check("15. Servis panosu (Süreç B) talebi süreçler arası aldı", await waitFor(board, () => !!document.querySelector('[data-testid="service-card"][data-type="WAITER"]'), null, 15000));

  // ── 8–11. Ses turu sırasında Süreç A sert biçimde öldürülür ve yeniden başlar ──
  const conv = await db.aiConversation.findFirstOrThrow({ where: { tenantId: T }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const turnsBefore = await db.aiTurn.count({ where: { conversationId: conv.id } });
  const msgsBefore = await db.aiMessage.count({ where: { conversationId: conv.id, role: "ASSISTANT" } });
  const uiBefore = (await assistantMsgs(cust)).length;
  await cust.evaluate(() => (window.__liveReqAt = 0));
  utter.set(cust, "Türk kahvesi var mı?");
  await cust.evaluate(() => window.__setMic(0.35));
  await sleep(800);
  await cust.evaluate(() => window.__setMic(0));
  await waitFor(cust, () => window.__liveReqAt > 0, null, 5000);
  const killedAt = Date.now();
  const health = restartA(); // istek yoldayken süreç ölür
  const reconnecting = await waitLive(cust, ["RECONNECTING"], 8000);
  const healthAfter = await health;
  check("8. Süreç A öldürüldü ve yeniden başladı (sağlık ok, redis)", healthAfter.status === "ok" && healthAfter.realtime === "redis", JSON.stringify(healthAfter));
  const resumed = await waitFor(cust, (n) => document.querySelectorAll('[data-testid="ai-message"][data-role="assistant"]').length > n, uiBefore, 45000);
  await waitLive(cust, ["LISTENING", "ASSISTANT_SPEAKING"], 30000);
  note(`Yeniden başlatma → canlı tur yanıtı: ${Math.round((Date.now() - killedAt) / 100) / 10} sn (yeniden bağlanma durumu görüldü: ${reconnecting})`);
  r = await lastAssistant(cust);
  check("9–10. Tarayıcı aynı tur anahtarıyla yeniden bağlandı, konuşma sürdü (yanıt geldi)", resumed && /Türk Kahvesi/.test(r?.text ?? ""), r?.text);
  await sleep(1000);
  const turnsAfter = await db.aiTurn.count({ where: { conversationId: conv.id } });
  const msgsAfter = await db.aiMessage.count({ where: { conversationId: conv.id, role: "ASSISTANT" } });
  const lastTurn = await db.aiTurn.findFirst({ where: { conversationId: conv.id }, orderBy: { createdAt: "desc" }, select: { attempts: true, status: true } });
  check("11. Yinelenen AI turu yok (tek tur, tek yanıt; arayüzde tek mesaj)", turnsAfter === turnsBefore + 1 && msgsAfter === msgsBefore + 1 && (await assistantMsgs(cust)).length === uiBefore + 1, JSON.stringify({ turnsBefore, turnsAfter, msgsBefore, msgsAfter, lastTurn }));

  // Dinleme sızıntısı: 20 × aç / dinle / kapat
  await cust.click('[data-testid="ai-close"]');
  await sleep(200);
  for (let i = 0; i < 20; i++) {
    await openAssistant(cust);
    await startLive(cust);
    await speak(cust, "Ayran var mı?", 250);
    await cust.click('[data-testid="ai-close"]');
    await sleep(120);
  }
  await sleep(1000);
  const leak = await cust.evaluate(() => ({ ctx: window.__ctx, worklet: window.__worklet, tracks: window.__tracks.live, active: window.__activeSources() }));
  check("13a. 20 × aç / dinle / kapat: AudioContext, worklet, mikrofon izi ve ses kaynağı sızıntısı yok", leak.ctx.created === leak.ctx.closed && leak.worklet.created === leak.worklet.closed && leak.worklet.created >= 21 && leak.tracks === 0 && leak.active === 0, JSON.stringify(leak));

  // ── 12–14. Yeniden başlatma sınırında sipariş + süreçler arası olaylar ──
  const ordersBefore = await db.order.count({ where: { tenantId: T } });
  await cust.click('[data-testid="cart-bar"]');
  await cust.waitForSelector("dialog[open] #pm-cart-title");
  await waitFor(cust, () => !document.body.innerText.match(/kontrol ediliyor/), null, 15000);
  await sleep(300);
  await cust.click('[data-testid="review-order"]');
  await cust.waitForSelector('[data-testid="send-order"]');
  let restartPromise = null;
  hooks.killOnAction = () => {
    restartPromise = restartA();
  };
  await cust.click('[data-testid="send-order"]');
  const firstOutcome = await Promise.race([cust.waitForSelector('[data-testid="order-success"]', { timeout: 15000 }).then(() => "success"), waitFor(cust, () => /tekrar deneyin|Bir sorun/i.test(document.body.innerText), null, 15000).then((x) => (x ? "error" : "none"))]).catch(() => "none");
  if (restartPromise) await restartPromise;
  if (!(await cust.$('[data-testid="order-success"]'))) {
    await cust.click('[data-testid="send-order"]'); // kullanıcı yeniden dener — AYNI anahtar
    await cust.waitForSelector('[data-testid="order-success"]', { timeout: 30000 }).catch(() => null);
  }
  const number = await cust.$eval('[data-testid="order-number"]', (e) => e.textContent.trim()).catch(() => null);
  const ordersAfter = await db.order.count({ where: { tenantId: T } });
  check("12–13. Yeniden başlatma sınırında gönderim + yeniden deneme → TEK sipariş", !!number && ordersAfter === ordersBefore + 1, JSON.stringify({ firstOutcome, number, ordersBefore, ordersAfter }));
  const orderNo = number ? number.replace(/\D/g, "") : "";
  check("14a. Sipariş listesi (Süreç B) yeni siparişi süreçler arası aldı", await waitFor(owner, (n) => !!document.querySelector(`tr[data-order-number="${n}"]`), orderNo, 20000));
  // B'de kabul → KDS (B) fiş alır; A'daki müşteri sayfası durumu canlı görür
  await Promise.all([cust.waitForNavigation({ waitUntil: "networkidle2" }), clickXp(cust, `.//a[contains(., "Siparişi Gör")]`)]);
  await owner.bringToFront();
  await Promise.all([owner.waitForNavigation({ waitUntil: "networkidle2" }), owner.click(`tr[data-order-number="${orderNo}"] a`)]);
  await clickXp(owner, `.//button[normalize-space(.)="Kabul et"]`);
  await owner.waitForSelector("dialog[open]");
  await clickXp(owner, `.//dialog[@open]//button[normalize-space(.)="Kabul et"]`);
  check("14b. KDS (Süreç B) fişi aldı", await waitFor(kds, () => document.querySelectorAll('[data-testid="kds-lane-PENDING"] [data-testid="kds-ticket"]').length >= 1, null, 20000));
  check("14c. Müşteri (Süreç A) durumu süreçler arası 'kabul edildi' gördü", await waitFor(cust, () => document.querySelector('[data-testid="public-order-status"]')?.dataset.status === "ACCEPTED", null, 20000));

  // ── 16. Hız sınırı iki süreç arasında paylaşılır (QR girişi: 60 / dk / IP) ──
  const ip = `203.0.113.${crypto.randomInt(1, 250)}`;
  const statuses = [];
  for (let i = 0; i < 80; i++) {
    const res = await fetch(`${PUBLIC}/q/${token}`, { redirect: "manual", headers: { "x-forwarded-for": ip, "x-e2e-backend": i % 2 ? "A" : "B" } });
    statuses.push(res.status);
  }
  const allowed = statuses.filter((s) => s === 307 || s === 308 || s === 302).length;
  check("16. Hız sınırı iki süreç arasında paylaşılır: 80 istekten tam 60'ı geçer (bellek olsaydı 80)", allowed === 60, JSON.stringify({ allowed, limited: statuses.length - allowed }));

  // ── 17. Mikrofon izin politikası ──
  check("17. Permissions-Policy: microphone=(self), kamera / konum kapalı", /microphone=\(self\)/.test(pp ?? "") && /camera=\(\)/.test(pp ?? ""), pp);

  // AudioWorklet güvenliği ve yedek
  const remote = await cust.evaluate(async () => {
    const ctx = new AudioContext();
    try {
      await ctx.audioWorklet.addModule("https://example.com/evil-worklet.js");
      return "loaded";
    } catch (e) {
      return `blocked:${e.name}`;
    } finally {
      await ctx.close();
    }
  });
  check("13b. Uzak AudioWorklet betiği yüklenemez (CSP script-src 'self')", remote.startsWith("blocked"), remote);
  const legacy = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true }, { extra: NO_WORKLET });
  await legacy.goto(stable, { waitUntil: "networkidle2" });
  await openAssistant(legacy);
  await startLive(legacy);
  const legacyMode = await legacy.$eval('[data-testid="ai-live"]', (e) => e.dataset.capture);
  r = await talk(legacy, "Ayran var mı?");
  check("13c. AudioWorklet yoksa ScriptProcessor yedeği çalışır", legacyMode === "script-processor" && /Ayran/.test(r?.text ?? ""), `${legacyMode} ${r?.text}`);
  await legacy.click('[data-testid="ai-live-end"]');

  // AI anahtarı / sağlayıcı adresi istemci paketinde yok
  const scripts = await cust.evaluate(() => [...new Set(performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.endsWith(".js")))]);
  let leakedKey = false;
  for (const src of scripts) {
    // Statik parçalar host'tan bağımsız; Node *.localhost alt alanını çözemez → aynı yol platform host'undan.
    const text = await (await fetch(src.replace(/\/\/[a-z0-9-]+\.localhost:/i, "//localhost:"))).text();
    if (/AI_API_KEY|api\.openai\.com|REDIS_URL|DATABASE_URL|ioredis/.test(text)) leakedKey = src;
  }
  check("18a. İstemci paketinde AI anahtarı adı / sağlayıcı adresi / Redis / veritabanı yok", !leakedKey, leakedKey);

  // ── 18. AI paketi olmayan restoran asistan kodunu indirmez ──
  const aiPage = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const beforeOpen = new Set();
  aiPage.on("requestfinished", (q) => q.url().endsWith(".js") && beforeOpen.add(q.url()));
  await aiPage.goto(stable, { waitUntil: "networkidle2" });
  const initial = new Set(beforeOpen);
  await openAssistant(aiPage);
  await sleep(800);
  for (const u of beforeOpen) if (!initial.has(u)) aiChunks.add(u);
  await setSubscription(db, T, { plan: "STARTER" });
  const plain = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true }, { shim: false });
  const plainJs = [];
  plain.on("requestfinished", (q) => q.url().endsWith(".js") && plainJs.push(q.url()));
  await plain.goto(stable, { waitUntil: "networkidle2" });
  await sleep(500);
  const noButton = !(await plain.$('[data-testid="ai-button"]'));
  const loadedAi = plainJs.filter((u) => aiChunks.has(u));
  check("18. AI'sız restoran: asistan düğmesi yok, asistan kod parçaları indirilmedi", aiChunks.size > 0 && noButton && loadedAi.length === 0, JSON.stringify({ aiChunks: aiChunks.size, noButton, loadedAi }));
  await setSubscription(db, T, { plan: "AI" });

  // ── 19–23. Duyarlılık (canlı ses açık) ──
  const overflows = {};
  for (const [w, h] of [
    [375, 812],
    [390, 844],
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
  check("19. 375 px", overflows[375] <= 0, overflows[375]);
  check("20. 390 px", overflows[390] <= 0, overflows[390]);
  check("21. 768 px", overflows[768] <= 0, overflows[768]);
  check("22. 1440 px", overflows[1440] <= 0, overflows[1440]);
  check("23. Yatay taşma yok", Object.values(overflows).every((v) => v <= 0), JSON.stringify(overflows));

  // Metrikler (Super Admin, Süreç B) — kişisel veri yok
  const sa = await newPage({ width: 1440, height: 900 }, { shim: false });
  await login(sa, BB, "admin@masanovai.local", process.env.SEED_SUPER_ADMIN_PASSWORD);
  const metrics = await sa.evaluate(() => fetch("/api/admin/metrics").then((r) => r.json()));
  check("Metrikler: süreç, SSE, gerçek zamanlı sayaçları; kişisel veri yok", metrics.realtime === "redis" && typeof metrics.sseOpen === "number" && metrics.counters && !/Masa 12|Mercimek|owner@/.test(JSON.stringify(metrics)), JSON.stringify(metrics).slice(0, 200));
  note(`Süreç B metrikleri: sseOpen=${metrics.sseOpen}, delivered=${metrics.counters?.["realtime.delivered"] ?? 0}, rss=${metrics.memoryMb?.rss}MB`);
  const anon = await fetch(`${BB}/api/admin/metrics`);
  check("Metrikler oturumsuz erişilemez", anon.status === 404, anon.status);

  check("24. Konsol hatası yok", consoleErrors.length === 0, consoleErrors.join(" | "));
})()
  .catch((e) => check("BEKLENMEYEN HATA", false, e.stack || e.message))
  .finally(() => finish());

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  await browser?.close().catch(() => null);
  await proxy?.close().catch(() => null);
  killPort(A_PORT);
  killPort(B_PORT);
  for (const fn of state.restore.reverse()) await fn().catch((e) => console.error("restore", e.message));
  if (state.demo) {
    const T = state.demo.id;
    await db.aiConversation.deleteMany({ where: { tenantId: T } }).catch(() => null);
    await db.aiUsage.deleteMany({ where: { tenantId: T } }).catch(() => null);
    await db.aiSettings.deleteMany({ where: { tenantId: T } }).catch(() => null);
    await db.tableServiceRequest.deleteMany({ where: { tenantId: T } }).catch(() => null);
    await db.order.deleteMany({ where: { tenantId: T } }).catch(() => null);
    await db.orderSequence.deleteMany({ where: { tenantId: T } }).catch(() => null);
  }
  await db.$disconnect();
  const summary = `\n${results.filter((r) => r.ok).length}/${results.length} geçti`;
  fs.appendFileSync(LOG, summary + "\n");
  console.log(summary);
  process.exit(0);
}

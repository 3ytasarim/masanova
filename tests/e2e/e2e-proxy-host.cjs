/**
 * Üretim benzeri kiracı alt alan adı testi — nginx arkasında HTTP backend + HTTPS ters vekil.
 *
 *   node tests/e2e/e2e-proxy-host.cjs            (önce üretim alan adıyla derler)
 *   node tests/e2e/e2e-proxy-host.cjs --no-build (mevcut .next'i kullanır; aynı NEXT_PUBLIC_* ile derlenmiş olmalı)
 *
 * 1) HATA KANITI: `next start -H 127.0.0.1` + `X-Forwarded-Proto: https` → kiracı ana sayfası 500 ve günlükte
 *    "Failed to proxy https://localhost:<port>/site" (Next issue #94745).
 * 2) DÜZELTME: `node server.mjs` (soket 127.0.0.1, Next'e iç ad "localhost") — aynı başlıklarla 10 senaryo:
 *    platform / giriş / kiracı siteleri / bilinmeyen kiracı 404 / platforma yönlendirme / QR girişi / API /
 *    sorgu dizesi + dil / kiracılar arası erişim yok. İstekler hem DOĞRUDAN (nginx başlıkları elle) hem de önünde TLS
 *    sonlandıran bir HTTPS ters vekil (nginx benzeri: Host + X-Forwarded-* ekler) üzerinden gönderilir.
 *
 * SALT OKUNUR: yalnızca GET; QR okutma sayacına dokunulmaz (geçersiz / başka kiracının token'ı kullanılır — sayaçtan
 * ÖNCE 404 döner). Veritabanı mevcut .env'den okunur; hiçbir kayıt oluşturulmaz / silinmez.
 */
const { spawn, execSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "../..");
const ROOT_DOMAIN = "masanova.corvis.tech";
const PLATFORM = `https://${ROOT_DOMAIN}`;
const BUG_PORT = 5122;
const FIX_PORT = 5123;
const TLS_PORT = 5443;
const BEYOGLU_TOKEN = "nfF-jCn61abXHETaOVQMsg"; // başka kiracının (Beyoğlu) masa token'ı — Khalkedon'da 404 beklenir
const ENV = {
  ...process.env,
  NODE_ENV: "production",
  APP_ENV: "staging",
  NEXT_PUBLIC_APP_URL: PLATFORM,
  NEXT_PUBLIC_ROOT_DOMAIN: ROOT_DOMAIN,
  QR_ENTRY_ORIGIN: `https://go.${ROOT_DOMAIN}`,
  PLATFORM_HOST_ALIASES: "",
  AI_PROVIDER: "mock",
};

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? `  → ${String(detail).slice(0, 220)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const pid of new Set(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter((p) => p && /^\d+$/.test(p) && p !== "0")))
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      } catch {}
  } catch {}
}

function start(label, cmd, args, extraEnv) {
  const logs = [];
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...ENV, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  return { label, child, logs, text: () => logs.join("") };
}

/** Doğrudan backend isteği — nginx'in ilettiği başlıklarla (yönlendirme izlenmez). */
function direct(port, host, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "GET", headers: { Host: host, "X-Forwarded-Host": host, "X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.7", "X-Real-IP": "203.0.113.7" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location ?? null, body }));
      },
    );
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

/** nginx benzeri TLS sonlandıran ters vekil: HTTPS alır, Host'u KORUYARAK X-Forwarded-* ekleyip HTTP backend'e iletir. */
function startTlsProxy(upstreamPort) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mn-tls-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", `/CN=*.${ROOT_DOMAIN}`], { stdio: "ignore" });
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const host = req.headers.host;
    const up = http.request(
      { host: "127.0.0.1", port: upstreamPort, path: req.url, method: req.method, headers: { ...req.headers, host, "x-forwarded-host": host, "x-forwarded-proto": "https", "x-forwarded-for": req.socket.remoteAddress, "x-real-ip": req.socket.remoteAddress } },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(TLS_PORT, "127.0.0.1", () => resolve({ server, dir })));
}

/** TLS vekil üzerinden istek (SNI + Host = gerçek alan adı; kendinden imzalı sertifika). */
function viaTls(host, pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: "127.0.0.1", port: TLS_PORT, servername: host, path: pathname, method: "GET", headers: { Host: host }, rejectUnauthorized: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location ?? null, body }));
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function waitReady(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await direct(port, ROOT_DOMAIN, "/api/ready");
      if (r.status === 200) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function scenarios(label, get) {
  const T = `khalkedon.${ROOT_DOMAIN}`;
  const B = `beyoglucorbasici.${ROOT_DOMAIN}`;
  // 1–2 platform
  let r = await get(ROOT_DOMAIN, "/");
  check(`[${label}] 1. platform ana sayfası 200`, r.status === 200 && /MasaNova/.test(r.body), r.status);
  r = await get(ROOT_DOMAIN, "/giris");
  check(`[${label}] 2. platform giriş ekranı 200`, r.status === 200 && /Tekrar hoş geldiniz/.test(r.body), r.status);
  // 3 Khalkedon
  r = await get(T, "/");
  check(`[${label}] 3. khalkedon ana sayfa 200 + kendi içeriği`, r.status === 200 && /Khalkedon Rakı Balık/.test(r.body) && !/Beyoğlu Çorbacısı/.test(r.body), `${r.status} ${r.body.slice(0, 120)}`);
  // 4 başka kiracı
  r = await get(B, "/");
  check(`[${label}] 4. beyoğlu ana sayfa 200 + kendi içeriği`, r.status === 200 && /Beyoğlu Çorbacısı/.test(r.body) && !/Khalkedon Rakı Balık/.test(r.body), r.status);
  // 5 tanımsız kiracı
  r = await get(`tanimsiz-isletme.${ROOT_DOMAIN}`, "/");
  check(`[${label}] 5. tanımsız alt alan güvenli 404`, r.status === 404 && !/Khalkedon|Beyoğlu/.test(r.body), r.status);
  // 6 kiracıda platform yolları → platforma yönlendirme (sorgu dizesi korunur)
  for (const [p, want] of [["/admin", `${PLATFORM}/admin`], ["/panel/menu?sekme=urun&x=1", `${PLATFORM}/panel/menu?sekme=urun&x=1`], ["/giris", `${PLATFORM}/giris`]]) {
    r = await get(T, p);
    check(`[${label}] 6. ${p} → platforma 307`, r.status === 307 && r.location === want, `${r.status} ${r.location}`);
  }
  // 7 QR giriş host'u
  r = await get(`go.${ROOT_DOMAIN}`, "/q/AAAAAAAAAAAAAAAAAAAAAA");
  check(`[${label}] 7. go./q/<geçersiz> güvenli 404 (QR akışı çalışıyor)`, r.status === 404, r.status);
  r = await get(`go.${ROOT_DOMAIN}`, "/");
  check(`[${label}] 7. go./ → platform köküne yönlendirme`, [307, 308].includes(r.status) && r.location === `${PLATFORM}/`, `${r.status} ${r.location}`);
  // 8 API
  for (const h of [ROOT_DOMAIN, T, `go.${ROOT_DOMAIN}`]) {
    r = await get(h, "/api/ready");
    check(`[${label}] 8. ${h}/api/ready 200`, r.status === 200, r.status);
  }
  // 9 sorgu dizesi + dil
  r = await get(T, "/?dil=en&utm_source=qr");
  check(`[${label}] 9. kiracı sorgu dizesi + dil (?dil=en) 200`, r.status === 200 && /Khalkedon/.test(r.body), r.status);
  r = await get(ROOT_DOMAIN, "/?utm_source=test");
  check(`[${label}] 9. platform sorgu dizesi 200`, r.status === 200, r.status);
  // 10 kiracılar arası erişim yok (Beyoğlu masa token'ı Khalkedon alan adında)
  r = await get(T, `/t/${BEYOGLU_TOKEN}`);
  check(`[${label}] 10. başka kiracının QR'ı bu alan adında 404, içerik sızmaz`, r.status === 404 && !/Beyoğlu Çorbacısı/.test(r.body), r.status);
  r = await get(B, `/t/${BEYOGLU_TOKEN}`.replace(BEYOGLU_TOKEN, "AAAAAAAAAAAAAAAAAAAAAA"));
  check(`[${label}] 10. geçersiz token 404`, r.status === 404, r.status);
}

(async () => {
  const build = !process.argv.includes("--no-build");
  if (build) {
    console.log(`… üretim derlemesi (NEXT_PUBLIC_ROOT_DOMAIN=${ROOT_DOMAIN})`);
    execSync("npx next build", { cwd: ROOT, env: ENV, stdio: ["ignore", "ignore", "inherit"] });
  }
  for (const p of [BUG_PORT, FIX_PORT, TLS_PORT]) killPort(p);
  const procs = [];
  try {
    // 1) Hata kanıtı
    const bug = start("next start -H 127.0.0.1", process.execPath, [require.resolve("next/dist/bin/next", { paths: [ROOT] }), "start", "-H", "127.0.0.1", "-p", String(BUG_PORT)], {});
    procs.push(bug);
    check("next start -H 127.0.0.1 hazır", await waitReady(BUG_PORT));
    const b = await direct(BUG_PORT, `khalkedon.${ROOT_DOMAIN}`, "/");
    await sleep(500);
    const proxied = /Failed to proxy https:\/\/localhost:\d+\/site/.test(bug.text());
    console.log(`  (hata kanıtı) next start -H 127.0.0.1 → khalkedon / = ${b.status}${proxied ? ' · günlük: "Failed to proxy https://localhost:…/site"' : ""}`);
    check("HATA YENİDEN ÜRETİLDİ: eski başlatma kiracı sayfasında 500 + dış proxy denemesi", b.status === 500 && proxied, b.status);
    bug.child.kill();
    killPort(BUG_PORT);

    // 2) Düzeltme
    const fix = start("node server.mjs", process.execPath, ["server.mjs"], { PORT: String(FIX_PORT), BIND_HOST: "127.0.0.1" });
    procs.push(fix);
    check("server.mjs hazır (127.0.0.1)", await waitReady(FIX_PORT));
    // netstat: "TCP  <yerel adres>  <karşı adres>  LISTENING  <pid>" — yalnızca YEREL adres sütunu değerlendirilir.
    const locals = execSync("netstat -ano | findstr LISTENING", { encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[1])
      .filter((addr) => addr && addr.endsWith(`:${FIX_PORT}`));
    check(`soket yalnızca loopback'te (127.0.0.1:${FIX_PORT})`, locals.length > 0 && locals.every((addr) => addr === `127.0.0.1:${FIX_PORT}`), locals.join(", "));
    await scenarios("doğrudan", (host, p) => direct(FIX_PORT, host, p));
    const { server: tls } = await startTlsProxy(FIX_PORT);
    try {
      await scenarios("https vekil", viaTls);
    } finally {
      tls.close();
    }
    check("günlükte dış proxy denemesi YOK (Failed to proxy / EPROTO)", !/Failed to proxy|EPROTO/.test(fix.text()), fix.text().match(/Failed to proxy[^\n]*/)?.[0]);
  } finally {
    for (const p of procs) p.child.kill();
    for (const p of [BUG_PORT, FIX_PORT, TLS_PORT]) killPort(p);
  }
  console.log(failures ? `\n${failures} kontrol BAŞARISIZ` : "\nTüm kontroller geçti");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("HATA", e.message);
  process.exit(1);
});

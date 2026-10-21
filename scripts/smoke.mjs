#!/usr/bin/env node
/**
 * Dağıtım sonrası SALT-OKUR duman testi (Sprint 21) — üretimde güvenle çalışır (yazma / giriş / sipariş YOK):
 *
 *   npm run smoke -- --base https://masanovai.com [--qr https://go.masanovai.com/q/<token>] [--expect-release <id>]
 *
 * Denetimler: ana sayfa · /api/health (status ≠ down, storage writable) · /api/ready 200 · giriş sayfası · güvenlik
 * başlıkları · (verilirse) QR menü yönlendirmesi + menü + AI / ödeme düğmesi yalnızca gerçek sağlayıcıyla · test ödeme
 * sayfası 404 · sürüm kimliği. Çıktıda sır / token yok (QR yolu maskelenir). Çıkış kodu: herhangi bir hata → 1.
 */
import http from "node:http";

const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const base = new URL(arg("base", "http://localhost:3820"));
const qr = arg("qr", "");
const expectRelease = arg("expect-release", "");
const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass: !!pass, detail });
/** Yanıt: { status, headers.get(), text(), json() }. *.localhost (yerel kiracı alt alanları) Node'da çözülmez → 127.0.0.1 + Host. */
function get(input) {
  const url = new URL(input);
  if (!url.hostname.endsWith(".localhost")) return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: url.port || 80, path: url.pathname + url.search, method: "GET", headers: { host: url.host }, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, headers: { get: (k) => res.headers[k.toLowerCase()] ?? null }, text: async () => body, json: async () => JSON.parse(body) });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function main() {
  const home = await get(new URL("/", base));
  ok("ana sayfa 200", home.status === 200, home.status);
  const h = home.headers;
  ok("güvenlik başlıkları (CSP, nosniff, frame)", !!h.get("content-security-policy") && h.get("x-content-type-options") === "nosniff" && !!(h.get("x-frame-options") || /frame-ancestors/.test(h.get("content-security-policy") ?? "")));
  ok("istek kimliği başlığı", !!h.get("x-request-id"));

  const health = await get(new URL("/api/health", base));
  const hj = await health.json().catch(() => ({}));
  ok("health (down değil)", health.status === 200 && hj.status !== "down", `${health.status} ${hj.status}`);
  ok("health: depolama yazılabilir", hj.storage === "writable", hj.storage);
  ok("health: sır / host içermiyor", !/postgres|redis:\/\/|sk-|@/.test(JSON.stringify(hj)));
  if (expectRelease) ok("sürüm kimliği", hj.release === expectRelease, hj.release);
  console.log(`  profil=${hj.appEnv} sürüm=${hj.release ?? "-"} db=${hj.database} redis=${hj.redis} ai=${hj.aiConfigured}`);

  const ready = await get(new URL("/api/ready", base));
  ok("ready 200", ready.status === 200, ready.status);
  const login = await get(new URL("/giris", base));
  ok("giriş sayfası 200", login.status === 200, login.status);

  if (qr) {
    const r1 = await get(qr);
    ok("QR girişi 307 → kiracı menüsü", r1.status === 307 && !!r1.headers.get("location"), r1.status);
    const loc = new URL(r1.headers.get("location"), qr);
    const menu = await get(loc);
    const html = await menu.text();
    ok("QR menü 200 (masa bağlamı)", menu.status === 200 && /data-product=/.test(html), menu.status);
    ok("müşteriye faturalama mesajı yok", !/abonelik|ödeme gecikti|ek süre/i.test(html));
    if (hj.appEnv === "production") {
      ok("üretimde AI düğmesi yalnızca gerçek sağlayıcıyla", hj.aiConfigured || !/data-testid="ai-button"/.test(html));
      const mock = await get(new URL("/odeme/mock/mock_000000000000000000000000", loc.origin));
      ok("test ödeme sayfası üretimde 404", mock.status === 404, mock.status);
    }
  }
  for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.pass || r.detail === "" ? "" : `  → ${r.detail}`}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed}/${results.length} geçti`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke çalışmadı:", e instanceof Error ? e.message.replace(/\/[qt]\/[A-Za-z0-9_-]{16,}/g, "/<qr>") : "hata");
  process.exit(1);
});

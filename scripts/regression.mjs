#!/usr/bin/env node
/**
 * Kritik tarayıcı paketleri — YALITILMIŞ koşu: npm run test:regression [-- --suites 6,9,10 --no-build]
 *
 *  - Uygulama bir kez derlenir (NEXT_PUBLIC_* derlemeye gömülür: localhost:3820).
 *  - Her paket için: port temizlenir → TAZE `next start` süreci paketin profiliyle (ör. mock AI) başlatılır →
 *    /api/health beklenir → paket çalışır → süreç durdurulur. Bellek içi hız sınırı / önbellek / olay yolu bir paketten
 *    diğerine TAŞINMAZ; sağlayıcı ayarı önceki paketten miras kalmaz.
 *  - Sprint 11 paketi ayrıca sahte Redis (RESP) + ikinci süreç ile çalışır (çok süreçli olaylar / hız sınırı).
 *  - Sonuç tablosu; herhangi bir paket başarısız / sonuçsuz ise çıkış kodu 1 (başarısızlık gizlenmez).
 *  - Gerçek AI sağlayıcısı GEREKMEZ (ücretli duman testi ayrı: npm run test:ai-smoke).
 */
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { ROOT, killPort, startServer, waitHealthy } = require("../tests/e2e/lib/server.cjs");
const { setDemoSubscription } = require("../tests/e2e/lib/subscription.cjs");
const { assertSafeTestDatabase, dotenvValues, loadPrismaClient, scrubEnv } = require("../tests/e2e/lib/env-safe.cjs");
// .env yalnızca AYRIŞTIRILIR (süreç ortamına YÜKLENMEZ) ve @prisma/client'ın yazdığı anahtarlar geri alınır: aksi halde
// NODE_ENV=development next build / paket süreçlerine sızar (Sprint 20'de prerender'ı bozdu; test: tests/unit/test-safety).
const DOTENV = dotenvValues();
const { PrismaClient, envBefore: ENV_BEFORE } = loadPrismaClient();
// Tarayıcı paketleri üretim veritabanında ASLA çalışmaz.
assertSafeTestDatabase({ ...DOTENV, ...process.env });

const PORT = 3820;
const MOCK_AI = { AI_PROVIDER: "mock", VOICE_STT_PROVIDER: "mock", VOICE_TTS_PROVIDER: "mock" };
const SUITES = [
  { id: 1, file: "e2e-sprint1.cjs", env: {} },
  { id: 2, file: "e2e-sprint2.cjs", env: {} },
  { id: 3, file: "e2e-sprint3.cjs", env: {} },
  { id: 4, file: "e2e-sprint4.cjs", env: {} },
  { id: 5, file: "e2e-sprint5.cjs", env: {} },
  { id: 6, file: "e2e-sprint6.cjs", env: {} },
  { id: 7, file: "e2e-sprint7.cjs", env: {} },
  { id: 8, file: "e2e-sprint8.cjs", env: {} },
  { id: 9, file: "e2e-sprint9.cjs", env: MOCK_AI },
  { id: 10, file: "e2e-sprint10.cjs", env: MOCK_AI },
  { id: 12, file: "e2e-sprint12.cjs", env: {} },
  // Görsel yükleme: geçici yükleme kökü (gerçek UPLOAD_ROOT / storage/uploads kullanılmaz)
  { id: 13, file: "e2e-sprint13.cjs", env: { UPLOAD_ROOT: "tmp/e2e/uploads", E2E_UPLOAD_ROOT: "tmp/e2e/uploads" } },
  { id: 14, file: "e2e-sprint14.cjs", env: {} },
  { id: 15, file: "e2e-sprint15.cjs", env: MOCK_AI },
  // CRM / sadakat: üretim derlemesi → doğrulama sağlayıcısı yok (doğrulanmamış katılım yolu)
  { id: 16, file: "e2e-sprint16.cjs", env: MOCK_AI },
  // Rezervasyon: demo kiracıda ayar + saatler geçici açılır, sonunda geri alınır
  { id: 17, file: "e2e-sprint17.cjs", env: {} },
  // Kupon / ödül / kampanya: demo kiracıda geçici kayıtlar; sadakat ayarı geri alınır
  { id: 18, file: "e2e-sprint18.cjs", env: {} },
  // Ödemeler: TEST sağlayıcısı (gerçek para yok); demo kiracıda ödeme ayarı geçici açılır, sonunda geri alınır
  { id: 19, file: "e2e-sprint19.cjs", env: { PAYMENT_PROVIDER: "mock" } },
  // Abonelik / paket uygulaması: demo kiracı paketi test içinde değişir, sonunda varsayılan profile döner
  { id: 20, file: "e2e-sprint20.cjs", env: { ...MOCK_AI, PAYMENT_PROVIDER: "mock" } },
  // Sesli menü eğitimi: demo kiracıya geçici ürünler eklenir; sonunda silinir, dizin eski hâline döner
  { id: 21, file: "e2e-voice-index.cjs", env: MOCK_AI },
  { id: 11, file: "e2e-sprint11.cjs", env: { ...MOCK_AI, REDIS_URL: "redis://127.0.0.1:6390", NEXT_MANUAL_SIG_HANDLE: "true" }, fakeRedis: 6390, selfManaged: true },
];

const args = process.argv.slice(2);
const pick = args.includes("--suites") ? new Set(args[args.indexOf("--suites") + 1].split(",").map(Number)) : null;
const selected = SUITES.filter((s) => !pick || pick.has(s.id));
const OUT = path.join(ROOT, "tmp/e2e");
fs.mkdirSync(OUT, { recursive: true });

if (!args.includes("--no-build")) {
  console.log("▶ derleme (NEXT_PUBLIC_APP_URL=http://localhost:3820)");
  killPort(PORT);
  execSync("npx next build", { cwd: ROOT, stdio: "inherit", env: { ...process.env, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`, NEXT_PUBLIC_ROOT_DOMAIN: `localhost:${PORT}` } });
}

function runSuite(suite, env) {
  return new Promise((resolve) => {
    const log = fs.openSync(path.join(OUT, `suite-${suite.id}.log`), "w");
    const child = spawn(process.execPath, [path.join(ROOT, "tests/e2e", suite.file)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", log, log] });
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 20 * 60_000);
    child.on("exit", (code) => {
      clearTimeout(watchdog);
      resolve(code ?? 1);
    });
  });
}

const results = [];
// Sprint 20: her paket DETERMİNİSTİK abonelik profiliyle başlar (varsayılan: demo = faturasız iç AI, istisna yok);
// bir paketin paket değişikliği sonrakine SIZMAZ. Koşu sonunda da varsayılana dönülür.
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? DOTENV.DIRECT_URL });
scrubEnv(ENV_BEFORE);
for (const suite of selected) {
  await setDemoSubscription(db, suite.subscription ?? {});
  // APP_ENV=test: `next start` varsayılan olarak ÜRETİM profilidir (mock sağlayıcılar kapalı, açılış denetimleri katı);
  // tarayıcı paketleri test profiliyle açıkça çalışır. NODE_ENV standart kalır (next start → production).
  const env = { APP_ENV: "test", ...suite.env, REDIS_NAMESPACE: `e2e-s${suite.id}-${Date.now().toString(36)}` };
  let fake = null;
  if (suite.fakeRedis) {
    killPort(suite.fakeRedis);
    fake = spawn(process.execPath, [path.join(ROOT, "tests/support/fake-redis.ts"), String(suite.fakeRedis)], { cwd: ROOT, stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 800));
  }
  killPort(PORT);
  // Next veri önbelleği (.next/cache/fetch-cache) diskte kalır, etiket geçersiz kılmaları ise yalnızca süreç belleğinde:
  // önceki paketin doğrudan DB'ye yazıp geri aldığı durum (ör. S5 "tükendi") ≤ 300 sn sonraki pakete eski menü olarak
  // sızıyordu (S6 sırasıyla koşunca kırılıyordu). Her paket boş veri önbelleğiyle başlar.
  fs.rmSync(path.join(ROOT, ".next/cache/fetch-cache"), { recursive: true, force: true });
  // selfManaged: paket kendi süreçlerini (vekil + iki arka uç) kurar ve yönetir.
  if (!suite.selfManaged) startServer(PORT, env, `server-s${suite.id}.log`);
  const started = Date.now();
  let summary = "sonuç yok";
  let ok = false;
  try {
    if (!suite.selfManaged) await waitHealthy(PORT);
    process.stdout.write(`▶ Sprint ${suite.id} (${suite.file}) … `);
    const code = await runSuite(suite, env);
    const text = fs.readFileSync(path.join(OUT, `suite-${suite.id}.log`), "utf8");
    const m = [...text.matchAll(/(\d+)\/(\d+) geçti/g)].pop();
    if (m) {
      summary = `${m[1]}/${m[2]}`;
      ok = m[1] === m[2] && Number(m[2]) > 0 && code === 0;
    } else summary = `çıkış ${code}, özet yok`;
  } catch (error) {
    summary = `sunucu açılmadı: ${error.message}`;
  } finally {
    killPort(PORT);
    for (const p of [3830, 3831]) killPort(p);
    if (fake) fake.kill();
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`${ok ? "GEÇTİ" : "KALDI"} ${summary} (${seconds} sn)`);
  results.push({ suite: suite.id, ok, summary, seconds });
}

await setDemoSubscription(db, {});
await db.$disconnect();
console.log("\nSprint  Sonuç   Süre");
for (const r of results) console.log(`S${String(r.suite).padEnd(6)} ${r.summary.padEnd(8)} ${r.seconds} sn ${r.ok ? "" : "  ← BAŞARISIZ (bkz. tmp/e2e/suite-" + r.suite + ".log)"}`);
fs.writeFileSync(path.join(OUT, "regression-summary.json"), JSON.stringify(results, null, 2));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;

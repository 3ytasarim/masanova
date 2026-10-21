#!/usr/bin/env node
/**
 * Kontrol noktası / sürüm doğrulaması (Sprint 21). Adımlar SIRAYLA çalışır; ilk hatada DURUR ve çıkış kodu 1.
 *
 *   npm run checkpoint:verify   → sır taraması · depo hijyeni · .gitignore · env · migration sağlığı · lint · typecheck ·
 *                                 birim · Neon entegrasyon · üretim derlemesi · kritik tarayıcı alt kümesi (S1, S6, S19, S20)
 *   npm run release:verify      → checkpoint:verify + TAM tarayıcı regresyonu (S1–S20) + üretim yapılandırma denetimi
 *                                 (deploy:check --production; release ortamının env'i ile çalıştırın)
 *
 * Bu betik .env'i süreç ortamına YÜKLEMEZ (NODE_ENV sızıntısı next build'i bozar — Sprint 20); her araç kendi
 * yapılandırmasını okur. Git'e YAZMAZ (add / commit / tag yok).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const isWin = process.platform === "win32";
const started = Date.now();
const results = [];

function run(name, cmd, args, env = {}) {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  const r = spawnSync(isWin ? "cmd" : cmd, isWin ? ["/c", cmd, ...args] : args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  const ok = r.status === 0;
  results.push({ name, ok, seconds: Math.round((Date.now() - t0) / 1000) });
  if (!ok) finish(1);
}

function check(name, fn) {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  let problems = [];
  try {
    problems = fn();
  } catch (e) {
    problems = [e instanceof Error ? e.message : String(e)];
  }
  for (const p of problems) console.log(`  ✗ ${p}`);
  if (!problems.length) console.log("  ✓ tamam");
  results.push({ name, ok: problems.length === 0, seconds: Math.round((Date.now() - t0) / 1000) });
  if (problems.length) finish(1);
}

function candidates() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
}

function finish(code) {
  console.log("\n─── Özet ───");
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name.padEnd(44)} ${r.seconds} sn`);
  console.log(`${code === 0 ? "BAŞARILI" : "BAŞARISIZ"} · ${Math.round((Date.now() - started) / 1000)} sn${release ? " (release:verify)" : " (checkpoint:verify)"}`);
  process.exit(code);
}

// 1) Sır taraması
run("sır taraması", "node", ["scripts/secret-scan.mjs"]);

// 2) Depo hijyeni: commit adaylarında sır / çalışma zamanı / geçici dosya / kontrol karakteri yok
check("depo hijyeni (commit adayları)", () => {
  const files = candidates();
  const problems = [];
  const FORBIDDEN = [/^\.env$/, /^\.env\.(?!example$)/, /^storage\//, /^tmp\//, /^\.next\//, /^node_modules\//, /^coverage\//, /\.log$/, /\.(sqlite3?|db|dump|bak|orig)$/, /^tests\/e2e\/out\//, /\.(webm|wav|mp3|har)$/];
  for (const f of files) {
    if (FORBIDDEN.some((re) => re.test(f))) problems.push(`commit edilmemeli: ${f}`);
    const full = path.join(ROOT, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.size > 5 * 1024 * 1024) problems.push(`5 MB üstü dosya: ${f}`);
    if (/\.(ts|tsx|mjs|cjs|js|json|md|sql|prisma|css|toml|example|conf|yml|yaml)$/.test(f) && st.size < 2 * 1024 * 1024) {
      if (/[\x00-\x08\x0e-\x1f]/.test(fs.readFileSync(full, "utf8"))) problems.push(`kontrol karakteri (bozuk kaçış?): ${f}`);
    }
  }
  if (!files.includes("package-lock.json")) problems.push("package-lock.json commit adayı değil");
  if (!files.includes(".env.example")) problems.push(".env.example commit adayı değil");
  if (files.some((f) => f.startsWith("node_modules/.prisma/"))) problems.push("üretilmiş Prisma istemcisi commit adayı");
  return problems;
});

// 3) .gitignore — zorunlu dışlamalar
check(".gitignore denetimi", () => {
  const must = [".env", ".env.local", ".env.production", ".env.staging.local", "storage/uploads/a.webp", "tmp/a", "coverage/a", "tests/e2e/out/a.png", "a.log", ".next/a", "node_modules/a", "tsconfig.tsbuildinfo", "x.webm", "dump.rdb", "a.sqlite"];
  const problems = [];
  for (const p of must) {
    const r = spawnSync("git", ["check-ignore", "-q", p], { cwd: ROOT });
    if (r.status !== 0) problems.push(`yok sayılmıyor: ${p}`);
  }
  if (spawnSync("git", ["check-ignore", "-q", ".env.example"], { cwd: ROOT }).status === 0) problems.push(".env.example yok sayılıyor (izlenmeli)");
  return problems;
});

// 4) Ortam + migration sağlığı (salt-okur)
run("env denetimi (çekirdek)", "npm", ["run", "-s", "env:check"]);
run("migration sağlığı (db:baseline:check)", "node", ["scripts/db-baseline.mjs", "check"]);

// 5) Kod kalitesi + testler
run("lint", "npm", ["run", "-s", "lint"]);
run("typecheck", "npm", ["run", "-s", "typecheck"]);
run("birim testleri", "npx", ["vitest", "run"]);
run("Neon entegrasyon testleri", "npx", ["vitest", "run", "--config", "vitest.integration.config.mts"]);

// 6) Üretim derlemesi (NODE_ENV açıkça production; regresyon sunucularıyla aynı NEXT_PUBLIC değerleri)
run("üretim derlemesi", "npx", ["next", "build"], { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost:3820", NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3820" });

// 7) Tarayıcı: kritik alt küme (checkpoint) ya da tam regresyon (release)
if (release) run("tam tarayıcı regresyonu S1–S20", "node", ["scripts/regression.mjs", "--no-build"]);
else run("kritik tarayıcı alt kümesi (S1, S6, S19, S20)", "node", ["scripts/regression.mjs", "--suites", "1,6,19,20", "--no-build"]);

// 8) Üretim yapılandırma denetimi (yalnızca release)
if (release) run("üretim yapılandırma denetimi (deploy:check --production)", "npx", ["tsx", "scripts/deploy-check.ts", "--production"]);

finish(0);

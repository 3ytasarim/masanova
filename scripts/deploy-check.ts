/**
 * Dağıtım öncesi denetim (Sprint 21): npm run deploy:check   [--production]
 *
 * VERİTABANINI / REDIS'İ DEĞİŞTİRMEZ (yalnızca SELECT 1, PING, migration durumu). Tek yazma: UPLOAD_ROOT'a küçük bir
 * geçici dosya yazılıp silinir (yazılabilirlik). Çıktı yalnızca durum + değişken ADI; değer / host / anahtar asla.
 * Çıkış kodu: çekirdek bir denetim başarısızsa 1. İsteğe bağlı özellik eksikleri (AI / ödeme / Redis tek süreçte) uyarıdır.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { diagnoseEnv, summarizeEnv } from "../src/lib/env-diagnostics";
import { resolveAppEnv } from "../src/lib/runtime-profile";
import { isMultiProcess, startupChecks } from "../src/lib/startup-checks";
import { resolveUploadRoot } from "../src/server/media/storage/root";
import { probeWritable } from "../src/server/media/storage/probe";

const ROOT = path.resolve(__dirname, "..");
if (process.argv.includes("--production")) process.env.APP_ENV = "production";
const env = process.env;
const appEnv = resolveAppEnv(env);
const MIN_FREE_MB = Number(env.DEPLOY_MIN_FREE_MB || 2048);

type Row = { name: string; ok: boolean; level: "core" | "warn"; detail: string };
const rows: Row[] = [];
const add = (name: string, ok: boolean, detail: string, level: Row["level"] = "core") => rows.push({ name, ok, level, detail });

async function main() {
  // 1) Ortam
  const diag = diagnoseEnv(env);
  const summary = summarizeEnv(diag, { production: appEnv === "production", aiProvider: env.AI_PROVIDER });
  add("env: çekirdek değişkenler", summary.coreOk, diag.filter((d) => d.class === "core" && d.status !== "ok").map((d) => `${d.name}=${d.status}`).join(", ") || "tamam");
  let uploadRoot = "";
  let writable: boolean | null = null;
  try {
    uploadRoot = resolveUploadRoot(env.UPLOAD_ROOT);
    writable = await probeWritable(uploadRoot);
  } catch (e) {
    add("UPLOAD_ROOT", false, e instanceof Error ? e.message.slice(0, 120) : "geçersiz");
  }
  const startup = startupChecks({ env, uploadWritable: env.UPLOAD_ROOT ? writable : null });
  add(`açılış denetimleri (APP_ENV=${appEnv})`, startup.fatal.length === 0, startup.fatal.join(" · ") || "çekirdek tamam");
  for (const w of [...summary.warnings, ...startup.warnings]) add("uyarı", false, w, "warn");

  // 2) Veritabanı (SELECT 1) + migration durumu (salt-okur)
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: env.DIRECT_URL || env.DATABASE_URL });
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    add("veritabanı erişimi", true, `${Date.now() - t0} ms`);
  } catch {
    add("veritabanı erişimi", false, "bağlanılamadı");
  } finally {
    await db.$disconnect();
  }
  const baseline = spawnSync(process.execPath, [path.join(ROOT, "scripts/db-baseline.mjs"), "check"], { cwd: ROOT, encoding: "utf8" });
  const state = /DURUM: (\w+)/.exec(baseline.stdout ?? "")?.[1] ?? "BİLİNMİYOR";
  add("migration durumu", state === "IN_SYNC" || state === "PENDING" || state === "FRESH", `${state}${state === "BASELINE_NEEDED" ? " → docs/migration-baseline.md (Durum B)" : ""}`, state === "BASELINE_NEEDED" ? "warn" : "core");

  // 3) Redis
  if (env.REDIS_URL) {
    const { default: Redis } = await import("ioredis");
    const r = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    r.on("error", () => undefined);
    try {
      await r.connect();
      const pong = await r.ping();
      add("Redis PING", pong === "PONG", pong);
    } catch {
      add("Redis PING", false, "bağlanılamadı");
    } finally {
      r.disconnect();
    }
  } else add("Redis", !isMultiProcess(env), isMultiProcess(env) ? "çok süreçli yapılandırma ama REDIS_URL yok" : "yapılandırılmadı (yalnızca tek süreç doğru)", isMultiProcess(env) ? "core" : "warn");

  // 4) İsteğe bağlı sağlayıcılar (durum raporu)
  const aiReal = env.AI_PROVIDER === "openai" && !!env.AI_API_KEY;
  add("AI sağlayıcısı", aiReal, aiReal ? "openai yapılandırılmış (gerçek duman testi: AI_SMOKE=1 npm run test:ai-smoke)" : "gerçek sağlayıcı YOK → sesli AI / Danışman açıklaması kapalı", "warn");
  add("ödeme sağlayıcısı", false, env.PAYMENT_PROVIDER === "mock" ? "mock (üretimde yok sayılır) → online ödeme kapalı" : "yok → online ödeme kapalı (gerçek adaptör henüz yok)", "warn");

  // 5) Disk alanı + gerekli dosyalar + derleme ön koşulları
  try {
    const target = uploadRoot && fs.existsSync(uploadRoot) ? uploadRoot : ROOT;
    const st = fs.statfsSync(target);
    const freeMb = Math.floor((st.bavail * st.bsize) / 1024 / 1024);
    add("disk alanı", freeMb >= MIN_FREE_MB, `${freeMb} MB boş (eşik ${MIN_FREE_MB} MB)`);
  } catch {
    add("disk alanı", false, "ölçülemedi", "warn");
  }
  for (const rel of ["prisma/migrations/migration_lock.toml", "public/worklets/capture-processor.js", "assets/fonts/Inter-Regular.ttf", "package-lock.json", ".nvmrc"]) add(`dosya: ${rel}`, fs.existsSync(path.join(ROOT, rel)), fs.existsSync(path.join(ROOT, rel)) ? "var" : "YOK");
  const wantedMajor = fs.existsSync(path.join(ROOT, ".nvmrc")) ? fs.readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim().replace(/^v/, "").split(".")[0] : "";
  add("Node sürümü", !wantedMajor || process.versions.node.split(".")[0] === wantedMajor, `${process.versions.node} (beklenen ${wantedMajor || "-"}.x)`);
  add("Prisma istemcisi üretilmiş", fs.existsSync(path.join(ROOT, "node_modules/.prisma/client/index.js")), "npm ci → postinstall prisma generate");
  try {
    const sharp = (await import("sharp")).default;
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).webp().toBuffer();
    add("sharp (yerel ikili)", true, `${process.platform}-${process.arch}`);
  } catch {
    add("sharp (yerel ikili)", false, "yüklenemedi — hedef mimaride npm ci");
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${r.ok ? "✓" : r.level === "warn" ? "!" : "✗"} ${r.name.padEnd(width)}  ${r.detail}`);
  const failed = rows.filter((r) => !r.ok && r.level === "core");
  console.log(`\nAPP_ENV=${appEnv} · çekirdek hata: ${failed.length} · uyarı: ${rows.filter((r) => !r.ok && r.level === "warn").length}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error("deploy:check çalışmadı:", e instanceof Error ? e.name : "hata");
  process.exitCode = 1;
});

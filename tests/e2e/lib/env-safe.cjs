// Test araçları için ortam güvenliği (Sprint 21).
//  1. @prisma/client yüklenirken .env'i süreç ortamına yazar (NODE_ENV=development dahil) → üst süreçten başlatılan
//     `next build` / sunucular yanlış profille çalışır (Sprint 20'de prerender'ı bozdu). `loadPrismaClient()` yüklemeden
//     önceki ortamı korur ve sızan anahtarları geri alır.
//  2. `assertSafeTestDatabase()` — testler ÜRETİM veritabanına asla bağlanmaz: APP_ENV=production, ya da hedef host
//     PRODUCTION_DB_HOSTS listesindeyse (virgüllü, host adları) süreç durur. Host yalnızca maskeli yazılır.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");

function loadPrismaClient() {
  const before = new Set(Object.keys(process.env));
  const mod = require("@prisma/client");
  scrubEnv(before);
  return { PrismaClient: mod.PrismaClient, Prisma: mod.Prisma, envBefore: before };
}

function scrubEnv(before) {
  for (const k of Object.keys(process.env)) if (!before.has(k)) delete process.env[k];
}

function dotenvValues() {
  try {
    return require("dotenv").parse(fs.readFileSync(path.join(ROOT, ".env")));
  } catch {
    return {};
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const mask = (host) => (host.length <= 8 ? "***" : `${host.slice(0, 4)}…${host.slice(-6)}`);

/** @param {Record<string,string|undefined>} env */
function classifyTestTarget(env) {
  const url = env.DIRECT_URL || env.DATABASE_URL || "";
  const host = hostOf(url);
  const prodHosts = (env.PRODUCTION_DB_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if ((env.APP_ENV || "").trim() === "production") return { safe: false, reason: "APP_ENV=production", host: mask(host) };
  if (host && prodHosts.includes(host)) return { safe: false, reason: "veritabanı host'u PRODUCTION_DB_HOSTS listesinde", host: mask(host) };
  return { safe: true, reason: "", host: mask(host) };
}

function assertSafeTestDatabase(env = { ...dotenvValues(), ...process.env }) {
  const r = classifyTestTarget(env);
  if (!r.safe) {
    console.error(`REDDEDİLDİ: testler üretim veritabanında çalışmaz (${r.reason}; host ${r.host}).`);
    process.exit(2);
  }
  return r;
}

module.exports = { ROOT, loadPrismaClient, scrubEnv, dotenvValues, classifyTestTarget, assertSafeTestDatabase };

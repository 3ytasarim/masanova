#!/usr/bin/env node
/**
 * Migration baseline denetimi (Sprint 21) — ASLA reset / drop / shadow kullanmaz. Ayrıntı: docs/migration-baseline.md
 *
 *   npm run db:baseline:check                → salt-okur: klasör denetimi + hedef DB geçmişi + şema farkı → DURUM
 *   npm run db:baseline:mark                 → yalnızca DURUM = BASELINE_NEEDED iken, açık onayla, her migration'ı
 *                                              `prisma migrate resolve --applied` ile "uygulandı" işaretler (DDL çalıştırmaz)
 *
 * Durumlar:
 *   FRESH            → boş veritabanı: `npm run db:deploy` (prisma migrate deploy) tüm migration'ları uygular
 *   IN_SYNC          → geçmiş var, hepsi uygulanmış, şema eşleşiyor
 *   PENDING          → geçmiş var, uygulanmamış migration(lar) var → `npm run db:deploy`
 *   BASELINE_NEEDED  → geçmiş YOK ama şema schema.prisma ile BİREBİR eşleşiyor → baseline işaretlemesi
 *   AMBIGUOUS        → geçmiş yok + şema farklı, başarısız / bilinmeyen migration, sıralama hatası … → REDDEDİLİR (çıkış 1)
 *
 * Hedef: DIRECT_URL (yoksa DATABASE_URL). Host yalnızca maskeli yazılır; kimlik bilgisi asla.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { loadPrismaClient, dotenvValues } = require("../tests/e2e/lib/env-safe.cjs");
const env = { ...dotenvValues(), ...process.env };
const mode = process.argv[2] ?? "check";
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");
const NAME = /^\d{14}_[a-z0-9_]+$/;
const DANGEROUS = /\b(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE\b|DROP\s+COLUMN)/i;
const prismaCli = require.resolve("prisma/build/index.js");

const url = env.DIRECT_URL || env.DATABASE_URL;
const mask = (u) => {
  try {
    const h = new URL(u).hostname;
    return h.length <= 10 ? "***" : `${h.slice(0, 5)}…${h.slice(-10)}`;
  } catch {
    return "(ayrıştırılamadı)";
  }
};
const problems = [];

// 1) Klasör denetimi
const dirs = fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const sorted = [...dirs].sort();
if (JSON.stringify(dirs) !== JSON.stringify(sorted)) problems.push("migration klasörleri sıralı listelenmiyor");
const stamps = new Set();
for (const d of sorted) {
  if (!NAME.test(d)) problems.push(`geçersiz ad: ${d}`);
  const stamp = d.slice(0, 14);
  if (stamps.has(stamp)) problems.push(`yinelenen zaman damgası: ${stamp}`);
  stamps.add(stamp);
  const file = path.join(MIGRATIONS, d, "migration.sql");
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) problems.push(`migration.sql eksik / boş: ${d}`);
  else if (DANGEROUS.test(fs.readFileSync(file, "utf8"))) problems.push(`yıkıcı SQL içeriyor (gözden geçirin): ${d}`);
}
if (!fs.existsSync(path.join(MIGRATIONS, "migration_lock.toml"))) problems.push("migration_lock.toml yok");
console.log(`Migration klasörleri: ${sorted.length} (ilk ${sorted[0]}, son ${sorted.at(-1)})`);
if (!url) {
  console.error("DIRECT_URL / DATABASE_URL yok.");
  process.exit(1);
}
console.log(`Hedef: ${mask(url)}  (APP_ENV=${env.APP_ENV || "-"})`);

// 2) Şema farkı (salt-okur: canlı şema → schema.prisma; shadow YOK)
const diff = spawnSync(process.execPath, [prismaCli, "migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
const schemaMatches = diff.status === 0;
if (diff.status !== 0 && diff.status !== 2) problems.push("şema farkı hesaplanamadı (bağlantı?)");

// 3) Geçmiş
const { PrismaClient } = loadPrismaClient();
const db = new PrismaClient({ datasourceUrl: url });
let history = null;
let hasTables = false;
try {
  const t = await db.$queryRaw`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS h, to_regclass('public.tenants') IS NOT NULL AS t`;
  hasTables = t[0].t;
  if (t[0].h) history = await db.$queryRaw`SELECT migration_name AS name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at`;
} catch {
  problems.push("veritabanına bağlanılamadı");
}

let state = "AMBIGUOUS";
const applied = new Set((history ?? []).filter((h) => h.finished && !h.rolled_back).map((h) => h.name));
if (problems.length) state = "AMBIGUOUS";
else if (!history && !hasTables) state = "FRESH";
else if (!history && hasTables) state = schemaMatches ? "BASELINE_NEEDED" : "AMBIGUOUS";
else {
  const failed = history.filter((h) => !h.finished && !h.rolled_back).map((h) => h.name);
  const unknown = [...applied].filter((n) => !sorted.includes(n));
  if (failed.length) problems.push(`yarım kalmış migration: ${failed.join(", ")}`);
  if (unknown.length) problems.push(`yerelde olmayan uygulanmış migration: ${unknown.join(", ")}`);
  const pending = sorted.filter((n) => !applied.has(n));
  if (!failed.length && !unknown.length) state = pending.length ? "PENDING" : schemaMatches ? "IN_SYNC" : "AMBIGUOUS";
  if (state === "AMBIGUOUS" && !pending.length && !schemaMatches) problems.push("geçmiş tam ama şema schema.prisma'dan farklı (elle değişiklik?)");
  if (pending.length) console.log(`Uygulanmamış: ${pending.join(", ")}`);
}
if (!history && hasTables && !schemaMatches) problems.push("geçmiş yok VE şema farklı — önce farkı inceleyin (npm run db:diff)");

console.log(`Geçmiş tablosu: ${history ? `${history.length} kayıt` : "YOK"} · tablo var: ${hasTables} · şema eşleşiyor: ${schemaMatches}`);
console.log(`DURUM: ${state}`);
for (const p of problems) console.log(`  ✗ ${p}`);
const next = { FRESH: "npm run db:deploy", IN_SYNC: "işlem gerekmez", PENDING: "geri yükleme noktası alın → npm run db:deploy", BASELINE_NEEDED: "geri yükleme noktası alın → npm run db:baseline:mark (açık onayla)", AMBIGUOUS: "DUR — docs/migration-baseline.md › Belirsiz durum" };
console.log(`Sonraki adım: ${next[state]}`);

if (mode === "mark") {
  const confirm = env.MASANOVA_BASELINE_CONFIRM;
  const target = env.MASANOVA_BASELINE_TARGET;
  if (state !== "BASELINE_NEEDED") {
    console.error("İşaretleme yalnızca BASELINE_NEEDED durumunda yapılır.");
    await db.$disconnect();
    process.exit(1);
  }
  if (confirm !== "I_HAVE_A_RESTORE_POINT" || target !== mask(url)) {
    console.error(`Onay eksik: MASANOVA_BASELINE_CONFIRM=I_HAVE_A_RESTORE_POINT ve MASANOVA_BASELINE_TARGET="${mask(url)}" gerekli.`);
    await db.$disconnect();
    process.exit(1);
  }
  await db.$disconnect();
  for (const name of sorted) {
    const r = spawnSync(process.execPath, [prismaCli, "migrate", "resolve", "--applied", name], { cwd: ROOT, stdio: "inherit", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });
    if (r.status !== 0) {
      console.error(`İşaretleme durdu: ${name}`);
      process.exit(1);
    }
  }
  console.log(`${sorted.length} migration "uygulandı" olarak işaretlendi (DDL çalıştırılmadı). Doğrulama: npm run db:baseline:check → IN_SYNC`);
  process.exit(0);
}
await db.$disconnect();
process.exit(state === "AMBIGUOUS" ? 1 : 0);

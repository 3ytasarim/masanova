#!/usr/bin/env node
/**
 * GÜVENLİ migration SQL üretimi — shadow veritabanı KULLANMAZ (salt-okur karşılaştırma: canlı şema → schema.prisma).
 *   npm run db:diff            → bekleyen değişikliğin SQL'i (stdout)
 * Çıktıyı prisma/migrations/<tarih>_<ad>/migration.sql olarak kaydedip `npx prisma db execute --url "$DIRECT_URL" --file …`
 * ya da (geçmiş tablosu kurulmuşsa) `npm run db:deploy` ile uygulayın.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import "dotenv/config";

const require = createRequire(import.meta.url);

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL / DATABASE_URL yok.");
  process.exit(1);
}
// Kabuk KULLANILMAZ: bağlantı dizesindeki "&" (sorgu parametreleri) Windows cmd'de komut ayırıcıdır.
const prismaCli = require.resolve("prisma/build/index.js");
const res = spawnSync(process.execPath, [prismaCli, "migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { stdio: ["ignore", "inherit", "inherit"] });
process.exit(res.status ?? 1);

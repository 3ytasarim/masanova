import "dotenv/config";
import { createRequire } from "node:module";

/**
 * Entegrasyon / yük testleri: .env yüklenir, ardından hedef veritabanı denetlenir — APP_ENV=production ya da host
 * PRODUCTION_DB_HOSTS listesindeyse koşu DURUR (testler kiracı oluşturup siler; üretimde asla çalışmamalı).
 */
const { assertSafeTestDatabase } = createRequire(import.meta.url)("../e2e/lib/env-safe.cjs") as { assertSafeTestDatabase: () => void };
assertSafeTestDatabase();

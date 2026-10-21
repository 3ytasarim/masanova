import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

/**
 * Entegrasyon testleri: gerçek PostgreSQL (DATABASE_URL) üzerinde çalışır.
 * Her test kendi benzersiz kiracılarını oluşturur ve sonunda siler; mevcut veriye dokunmaz.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/support/load-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

/**
 * Yük testleri (isteğe bağlı, normal test paketine dahil DEĞİL): gerçek PostgreSQL (Neon) + sahte Redis.
 *   npm run load:db
 * Geçici kiracı oluşturur ve sonunda siler; üretim verisine dokunmaz.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/load/**/*.load.test.ts"],
    setupFiles: ["tests/support/load-env.ts"],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

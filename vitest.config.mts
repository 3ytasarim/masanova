import path from "node:path";
import { defineConfig } from "vitest/config";

/** Birim testleri: veritabanı gerektirmez, her zaman çalışır (npm test). */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" Next.js dışında import edildiğinde hata fırlatır; testlerde etkisiz modülle değiştirilir.
      "server-only": path.resolve(import.meta.dirname, "tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});

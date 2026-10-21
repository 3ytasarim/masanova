import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

/**
 * GERÇEK sağlayıcı duman testi (isteğe bağlı, ücretli API kullanır). Yalnızca elle: AI_SMOKE=1 npm run test:ai-smoke
 * Otomatik test / build buna bağlı DEĞİLDİR. Az sayıda kısa istek yapar (5 dilde TTS + STT gidiş-dönüş + 1 sohbet).
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/smoke/**/*.test.ts"],
    setupFiles: ["tests/support/load-env.ts"],
    testTimeout: 90_000,
  },
});

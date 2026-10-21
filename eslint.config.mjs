import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    // Kiracı kapsamı (TenantScope / PlatformScope) yalnızca güvenilir sunucu bağlamından üretilebilir.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/tenant/**", "src/lib/auth/guards.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/tenant/scope",
              importNames: ["createTenantScope", "createPlatformScope"],
              message: "Kapsam yalnızca requireTenant() / requireTenantUser() / requireSuperAdmin() ile alınır.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tarayıcı test paketleri: Node CommonJS betikleri (Puppeteer) — require() bu dosyalarda doğal modül biçimidir.
    files: ["tests/e2e/**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "tmp/**"]),
]);

export default eslintConfig;

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mocksAllowed, releaseId, resolveAppEnv } from "@/lib/runtime-profile";
import { isMultiProcess, startupChecks } from "@/lib/startup-checks";

/** Sprint 21 — üretim hazırlığı: profil, açılış denetimleri, mock sağlayıcı güvenliği, test hedef güvenliği. */
const ROOT = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const envSafe = require("../e2e/lib/env-safe.cjs") as {
  classifyTestTarget: (env: Record<string, string | undefined>) => { safe: boolean; reason: string; host: string };
};

const base = { QR_TOKEN_SECRET: "x".repeat(40), NEXT_PUBLIC_ROOT_DOMAIN: "masanovai.com", UPLOAD_ROOT: "/var/lib/masanova/uploads", QR_ENTRY_ORIGIN: "https://go.masanovai.com" };

describe("çalışma zamanı profili (APP_ENV ayrı, NODE_ENV standart)", () => {
  it("APP_ENV öncelikli; yoksa NODE_ENV'den türetilir", () => {
    expect(resolveAppEnv({ NODE_ENV: "production" })).toBe("production");
    expect(resolveAppEnv({ NODE_ENV: "production", APP_ENV: "staging" })).toBe("staging");
    expect(resolveAppEnv({ NODE_ENV: "test" })).toBe("test");
    expect(resolveAppEnv({ NODE_ENV: "development" })).toBe("development");
    expect(resolveAppEnv({ NODE_ENV: "production", APP_ENV: "bogus" })).toBe("production");
  });
  it("mock sağlayıcılar yalnızca production DIŞINDA", () => {
    expect(mocksAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(mocksAllowed({ NODE_ENV: "production", APP_ENV: "staging" })).toBe(true);
    expect(mocksAllowed({ NODE_ENV: "production", APP_ENV: "test" })).toBe(true);
  });
  it("sürüm kimliği kısa ve temizlenmiş (sır değil)", () => {
    expect(releaseId({ GIT_SHA: "0123456789abcdef0123456789abcdef01234567" })).toBe("0123456789ab");
    expect(releaseId({ RELEASE_ID: "v0.20.0-baseline" })).toBe("v0.20.0-baseline");
    expect(releaseId({ RELEASE_ID: "a b<script>" })).toBe("abscript");
    expect(releaseId({})).toBeNull();
  });
});

describe("üretim açılış denetimleri", () => {
  it("üretimde eksiksiz yapılandırma: fatal yok; gerçek ödeme / AI yokluğu uyarıdır", () => {
    const r = startupChecks({ env: { ...base, NODE_ENV: "production" }, uploadWritable: true });
    expect(r.fatal).toEqual([]);
    expect(r.warnings.some((w) => w.startsWith("PAYMENT_PROVIDER"))).toBe(true);
  });
  it("çekirdek hatalar üretimde süreci durdurur: QR sırrı, kök alan, UPLOAD_ROOT (yok / göreli / yazılamaz)", () => {
    const p = (env: Record<string, string | undefined>, w: boolean | null = true) => startupChecks({ env: { NODE_ENV: "production", ...env }, uploadWritable: w }).fatal;
    expect(p({ ...base, QR_TOKEN_SECRET: "short" })).toHaveLength(1);
    expect(p({ ...base, NEXT_PUBLIC_ROOT_DOMAIN: "not a domain" })).toHaveLength(1);
    expect(p({ ...base, UPLOAD_ROOT: "" })[0]).toMatch(/UPLOAD_ROOT/);
    expect(p({ ...base, UPLOAD_ROOT: "storage/uploads" })[0]).toMatch(/mutlak/);
    expect(p(base, false)[0]).toMatch(/yazılamıyor/);
  });
  it("küme (PM2 cluster / çoklu örnek) + Redis yok → üretimde fatal; tek süreç sorun değil", () => {
    expect(isMultiProcess({ exec_mode: "cluster_mode" })).toBe(true);
    expect(isMultiProcess({ instances: "4" })).toBe(true);
    expect(isMultiProcess({ instances: "1" })).toBe(false);
    expect(startupChecks({ env: { ...base, NODE_ENV: "production", exec_mode: "cluster_mode" }, uploadWritable: true }).fatal[0]).toMatch(/REDIS_URL/);
    expect(startupChecks({ env: { ...base, NODE_ENV: "production", exec_mode: "cluster_mode", REDIS_URL: "redis://r:6379" }, uploadWritable: true }).fatal).toEqual([]);
  });
  it("üretimde mock sağlayıcı ayarı yok sayılır ve uyarılır; test / staging profilinde aynı bulgular yalnızca uyarı", () => {
    const r = startupChecks({ env: { ...base, NODE_ENV: "production", AI_PROVIDER: "mock", PAYMENT_PROVIDER: "mock" }, uploadWritable: true });
    expect(r.warnings.filter((w) => w.includes('"mock" üretimde YOK SAYILDI'))).toHaveLength(2);
    const t = startupChecks({ env: { NODE_ENV: "production", APP_ENV: "test" }, uploadWritable: null });
    expect(t.fatal).toEqual([]);
    expect(t.warnings.length).toBeGreaterThan(0);
  });
});

describe("mock sağlayıcı güvenliği (sağlayıcı fabrikaları)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  const load = async (env: Record<string, string>) => {
    vi.resetModules();
    for (const [k, v] of Object.entries({ DATABASE_URL: "postgresql://u:p@h/db", DIRECT_URL: "postgresql://u:p@h/db", QR_TOKEN_SECRET: "x".repeat(40), ...env })) vi.stubEnv(k, v);
    return { pay: await import("@/server/payments/providers"), ai: await import("@/server/services/ai/config") };
  };
  it("APP_ENV=production: PAYMENT_PROVIDER=mock → sağlayıcı YOK (/odeme/mock 404, online ödeme kapalı); AI mock → AI yok", async () => {
    const { pay, ai } = await load({ NODE_ENV: "production", APP_ENV: "production", PAYMENT_PROVIDER: "mock", AI_PROVIDER: "mock", VOICE_STT_PROVIDER: "mock", VOICE_TTS_PROVIDER: "mock" });
    expect(pay.getPaymentProvider()).toBeNull();
    expect(pay.providerStatus()).toEqual({ configured: false, name: null, test: false });
    expect(ai.getProviders()).toEqual({ ai: null, stt: null, tts: null });
  });
  it("APP_ENV=staging / test: mock sağlayıcı açıkça izinli", async () => {
    const { pay, ai } = await load({ NODE_ENV: "production", APP_ENV: "staging", PAYMENT_PROVIDER: "mock", AI_PROVIDER: "mock" });
    expect(pay.getPaymentProvider()?.name).toBe("mock");
    expect(ai.getProviders().ai).not.toBeNull();
  });
});

describe("test hedef güvenliği ve NODE_ENV sızıntısı", () => {
  it("testler APP_ENV=production ya da PRODUCTION_DB_HOSTS host'una karşı REDDEDİLİR; host maskelenir", () => {
    expect(envSafe.classifyTestTarget({ DIRECT_URL: "postgresql://u:p@ep-dev-123.neon.tech/db" })).toMatchObject({ safe: true });
    const r = envSafe.classifyTestTarget({ DIRECT_URL: "postgresql://u:p@ep-prod-999.neon.tech/db", PRODUCTION_DB_HOSTS: "ep-prod-999.neon.tech" });
    expect(r.safe).toBe(false);
    expect(r.host).not.toContain("prod-999");
    expect(envSafe.classifyTestTarget({ APP_ENV: "production", DIRECT_URL: "postgresql://u:p@x/db" }).safe).toBe(false);
  });
  it("test araçları üst sürecin ortamını (NODE_ENV) DEĞİŞTİRMEZ: @prisma/client yüklemesi sızıntısı geri alınır", () => {
    const script = `const s=require(${JSON.stringify(path.join(ROOT, "tests/e2e/lib/env-safe.cjs"))});delete process.env.NODE_ENV;s.loadPrismaClient();process.stdout.write(String(process.env.NODE_ENV));`;
    const childEnv: Record<string, string | undefined> = { ...process.env };
    delete childEnv.NODE_ENV;
    const out = spawnSync(process.execPath, ["-e", script], { cwd: ROOT, encoding: "utf8", env: childEnv as NodeJS.ProcessEnv });
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("undefined");
  });
  it("regresyon koşucusu next build'i NODE_ENV=production ile, sunucuları APP_ENV=test ile başlatır", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(path.join(ROOT, "scripts/regression.mjs"), "utf8");
    expect(src).toMatch(/next build[^\n]*NODE_ENV: "production"/);
    expect(src).toContain('APP_ENV: "test"');
    expect(src).toContain("loadPrismaClient()");
    expect(src).not.toMatch(/dotenv["']\)\.config\(/);
  });
});

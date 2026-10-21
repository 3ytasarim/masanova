/**
 * Çalışma zamanı profili (Sprint 21). NODE_ENV standart kalır (development / test / production — Next ve araçlar
 * bunu bekler); dağıtım ortamı AYRI değişkenle ifade edilir:
 *
 *   APP_ENV = development | test | staging | production
 *   Boşsa NODE_ENV'den türetilir (production → production). Yani `next start` varsayılan olarak ÜRETİM profilidir;
 *   test / demo sunucuları APP_ENV=test / staging ile açıkça işaretlenir.
 *
 * Kural: "mock" sağlayıcılar (AI, ses, ödeme, iletişim doğrulaması) yalnızca production DIŞINDA çalışır. Üretimde mock
 * ayarı YOK SAYILIR (özellik kapalı kalır) ve açılışta uyarı loglanır — gerçek görünümlü sahte ödeme / AI sızamaz.
 */
export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

type EnvLike = Record<string, string | undefined>;

export function resolveAppEnv(env: EnvLike = process.env): AppEnv {
  const v = env.APP_ENV?.trim();
  if (v && (APP_ENVS as readonly string[]).includes(v)) return v as AppEnv;
  return env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
}

/** Mock sağlayıcılara izin var mı (yalnızca production dışı). */
export function mocksAllowed(env: EnvLike = process.env): boolean {
  return resolveAppEnv(env) !== "production";
}

/** Health'te gösterilebilecek kısa, sır olmayan sürüm kimliği (RELEASE_ID ya da GIT_SHA'nın ilk 12 karakteri). */
export function releaseId(env: EnvLike = process.env): string | null {
  const raw = (env.RELEASE_ID || env.GIT_SHA || "").trim();
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  if (!safe) return null;
  return /^[0-9a-f]{13,}$/i.test(safe) ? safe.slice(0, 12) : safe;
}

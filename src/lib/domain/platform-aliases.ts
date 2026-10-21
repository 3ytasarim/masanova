import { normalizeHost } from "@/lib/domain/normalize-domain";
import { resolveAppEnv } from "@/lib/runtime-profile";

/**
 * Ek platform host'ları — YALNIZCA production DIŞI (development / test / staging). Örn. geçici bir Cloudflare Quick
 * Tunnel adresini pazarlama sitesi + /giris + /panel + /admin olarak sunmak için:
 *   PLATFORM_HOST_ALIASES=ornek-adres.trycloudflare.com[,ikinci.ornek.test]
 * Üretimde (APP_ENV=production) bu değişken YOK SAYILIR: platform yalnızca NEXT_PUBLIC_ROOT_DOMAIN (+ www / app).
 * Listedeki host kiracı alan adı olarak çözülmez (platform önceliklidir) — kiracı QR menüsü için kiracı alan adı kullanılır.
 */
export function parsePlatformHostAliases(env: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  if (resolveAppEnv(env) === "production") return new Set();
  const hosts = (env.PLATFORM_HOST_ALIASES ?? "")
    .split(",")
    .map((h) => normalizeHost(h.trim()))
    .filter((h): h is string => !!h);
  return new Set(hosts);
}

/** Süreç ömrü boyunca sabit (sunucu başlatılırken okunur). */
export const PLATFORM_HOST_ALIASES: ReadonlySet<string> = parsePlatformHostAliases();

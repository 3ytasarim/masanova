/**
 * Yalnızca platform alan adında sunulan yollar. Kiracı alan adından gelen istekler platforma yönlendirilir
 * (proxy.ts → /site/platform → mutlak yönlendirme). Oturum çerezleri böylece tek origin'de kalır.
 */
export const PLATFORM_ONLY_PREFIXES = ["/admin", "/panel", "/giris", "/kasa"] as const;

export function isPlatformOnlyPath(pathname: string): boolean {
  return PLATFORM_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Kiracı host'undan platforma yönlendirmenin iç rewrite hedefi. */
export const PLATFORM_REDIRECT_ROUTE = "/site/platform";

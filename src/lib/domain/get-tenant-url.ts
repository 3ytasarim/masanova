import { PLATFORM_ORIGIN } from "@/lib/domain/get-platform-url";
import { ROOT_HOSTNAME, ROOT_PORT } from "@/lib/domain/root-domain";

/**
 * Kiracı alan adları ve adresleri — tüm hostname/URL üretimi buradan geçer.
 */

/** Kiracının platform alt alan adı: buildSubdomainHostname("beyoglu") → "beyoglu.masanovai.com" (yerelde "beyoglu.localhost"). */
export function buildSubdomainHostname(label: string): string {
  return `${label}.${ROOT_HOSTNAME}`;
}

/** Hostname kök alanın alt alanı mı (platform alt alan adı)? */
export function isPlatformSubdomain(hostname: string): boolean {
  return hostname.endsWith(`.${ROOT_HOSTNAME}`);
}

/**
 * Kiracı alan adının tarayıcıda açılacak adresi. Protokol platformla aynıdır; port yalnızca platform
 * alt alanlarında (yerel geliştirme: demo.localhost:3000) eklenir — özel alan adları standart portta yayınlanır.
 */
export function getTenantUrl(hostname: string, path = "/"): string {
  const protocol = new URL(PLATFORM_ORIGIN).protocol;
  const port = ROOT_PORT && isPlatformSubdomain(hostname) ? `:${ROOT_PORT}` : "";
  return new URL(path, `${protocol}//${hostname}${port}`).toString();
}

/** Ekranda gösterim için protokolsüz adres: "beyoglu.masanovai.com" / "beyoglu.localhost:3000". */
export function formatTenantAddress(hostname: string): string {
  const port = ROOT_PORT && isPlatformSubdomain(hostname) ? `:${ROOT_PORT}` : "";
  return `${hostname}${port}`;
}

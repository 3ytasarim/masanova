/**
 * Alan adı normalizasyonu — saf fonksiyonlar. Host başlığı, form girdisi ve veritabanı kayıtları aynı biçime
 * getirilir; TenantDomain.hostname her zaman bu fonksiyonun çıktısıdır.
 */

/** Platformun kendisi için ayrılmış, hiçbir kiracıya verilemeyecek alt alan adları. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www", "app", "admin", "api", "panel", "auth", "login", "giris", "dashboard", "billing",
  "static", "cdn", "assets", "img", "media", "mail", "smtp", "imap", "pop", "mx", "ns1", "ns2",
  "status", "docs", "blog", "help", "support", "destek", "dev", "staging", "test",
  "masanova", "masanovai", "root", "system", "sistem", "yonetim", "superadmin", "site", "platform",
  // Kararlı QR giriş adresi için ayrılmış (QR_ENTRY_ORIGIN, ör. go.masanovai.com).
  "go", "qr", "q",
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Tek bir DNS etiketi (alt alan adı parçası) geçerli mi? */
export function isValidDnsLabel(label: string): boolean {
  return LABEL.test(label);
}

/**
 * Host başlığını karşılaştırılabilir biçime getirir: küçük harf, portsuz, sonda nokta yok.
 * Geçersiz / şüpheli değerlerde null döner (asla istisna fırlatmaz).
 *
 *   "Demo.LocalHost:3000" → "demo.localhost"
 *   "menu.restoran.com."  → "menu.restoran.com"
 *   "[::1]:3000"          → "[::1]"
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Virgüllü listelerde (ör. x-forwarded-host) yalnızca ilk değer anlamlıdır.
  let host = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!host || host.length > 260) return null;

  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) return null;
    const literal = host.slice(0, end + 1);
    return /^\[[0-9a-f:.]+\]$/.test(literal) ? literal : null;
  }

  const colon = host.indexOf(":");
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port)) return null;
    host = host.slice(0, colon);
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host || host.length > 253) return null;

  const labels = host.split(".");
  if (!labels.every((label) => LABEL.test(label))) return null;
  return host;
}

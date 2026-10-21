/**
 * Hostname normalizasyonu ve sınıflandırması — saf fonksiyonlar (veritabanı yok, yan etki yok).
 * Normalizasyon src/lib/domain/normalize-domain.ts'tedir; burada yalnızca kök alana göre sınıflandırma yapılır.
 * Hem proxy.ts (her istek) hem sunucu bağlamı hem de testler aynı kuralları kullanır: tek doğruluk kaynağı.
 */
import { RESERVED_SUBDOMAINS, normalizeHost } from "@/lib/domain/normalize-domain";

/** Kök alan adıyla aynı davranan alt alan adları (www.masanovai.com → pazarlama sitesi). */
const PLATFORM_ALIASES: ReadonlySet<string> = new Set(["www", "app"]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const NO_ALIASES: ReadonlySet<string> = new Set();

export type HostClassification =
  /** Pazarlama sitesi, /admin, /panel, /giris — kiracıya bağlı değil. */
  | { kind: "platform"; hostname: string }
  /** Kök alanın tek seviyeli alt alanı: demo.masanovai.com */
  | { kind: "subdomain"; hostname: string; label: string }
  /** Kök alan dışında bir alan adı: menu.restoran.com */
  | { kind: "custom"; hostname: string }
  /** Asla kiracıya çözümlenmemesi gereken host (geçersiz, ayrılmış, çok seviyeli alt alan). */
  | { kind: "invalid"; hostname: string | null; reason: "malformed" | "reserved" | "nested_subdomain" };

/**
 * Normalize edilmiş host'u kök alan adına göre sınıflandırır.
 * @param rootHostname normalizeHost(NEXT_PUBLIC_ROOT_DOMAIN) — ör. "masanovai.com" ya da "localhost"
 */
export function classifyHost(rawHost: string | null | undefined, rootHostname: string, platformAliases: ReadonlySet<string> = NO_ALIASES): HostClassification {
  const hostname = normalizeHost(rawHost);
  if (!hostname) return { kind: "invalid", hostname: null, reason: "malformed" };
  // Açıkça yapılandırılmış ek platform host'u (yalnızca production dışı; bkz. platform-aliases.ts).
  if (platformAliases.has(hostname)) return { kind: "platform", hostname };

  if (hostname === rootHostname || hostname.startsWith("[") || IPV4.test(hostname)) {
    return { kind: "platform", hostname };
  }

  const suffix = `.${rootHostname}`;
  if (hostname.endsWith(suffix)) {
    const label = hostname.slice(0, -suffix.length);
    if (label.includes(".")) return { kind: "invalid", hostname, reason: "nested_subdomain" };
    if (PLATFORM_ALIASES.has(label)) return { kind: "platform", hostname };
    if (RESERVED_SUBDOMAINS.has(label)) return { kind: "invalid", hostname, reason: "reserved" };
    return { kind: "subdomain", hostname, label };
  }

  return { kind: "custom", hostname };
}


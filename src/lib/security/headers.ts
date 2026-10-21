/**
 * Güvenlik başlıkları (next.config.ts tarafından tüm yanıtlara uygulanır).
 *
 * CSP: Next.js App Router hydration için satır içi betik ürettiğinden script-src şimdilik 'unsafe-inline' içerir.
 * Nonce tabanlı sıkı CSP (proxy.ts içinde nonce üretimi), analitik ve ödeme sağlayıcıları netleştiğinde
 * devreye alınacak — bkz. docs/architecture.md › Güvenlik.
 */
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Sesli asistan yanıtı: sunucudan alınan ses blob URL'siyle oynatılır (harici medya kaynağı yok).
  "media-src 'self' blob:",
  `connect-src 'self' https://api.openai.com${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

export const noindexHeaders = [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }];

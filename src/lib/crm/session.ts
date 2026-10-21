import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Müşteri kimlik oturumu — tarayıcıya yalnızca 256 bit opak belirteç (httpOnly çerez) gider; sunucuda SHA-256 özeti.
 * localStorage'daki bir müşteri kimliğine ASLA güvenilmez. Oturum masa QR bağlamından BAĞIMSIZDIR ve masa işlemlerini
 * tek başına yetkilendirmez (her sipariş yine geçerli masa belirteci ister).
 */
export const CUSTOMER_COOKIE = "mn_customer";
export const CUSTOMER_SESSION_DAYS = 180;

export function newCustomerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCustomerToken(token: string): string {
  return createHash("sha256").update(`masanova:customer-session:v1:${token}`).digest("hex");
}

/** Biçim denetimi (43 karakter base64url) — geçersiz çerez veritabanına sorgu yaptırmaz. */
export function isWellFormedToken(token: string | null | undefined): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function sessionExpiry(now: Date = new Date(), days = CUSTOMER_SESSION_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

export function isSessionActive(s: { expiresAt: Date; revokedAt: Date | null }, now: Date = new Date()): boolean {
  return !s.revokedAt && s.expiresAt.getTime() > now.getTime();
}

/** Müşteriye açık kimlik (iç kimlik dışarı verilmez). */
export function newCustomerPublicId(): string {
  return randomBytes(16).toString("base64url");
}

/** Doğrulama kodu özeti (sır ile) + sabit zamanlı karşılaştırma. Kod LOGLANMAZ. */
export function hashVerificationCode(code: string, secret: string, verificationId: string): string {
  return createHash("sha256").update(`${secret}|masanova:otp:v1|${verificationId}|${code}`).digest("hex");
}

export function codeMatches(code: string, expectedHash: string, secret: string, verificationId: string): boolean {
  const a = Buffer.from(hashVerificationCode(code, secret, verificationId), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newVerificationCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export const VERIFICATION_TTL_MS = 10 * 60_000;
export const VERIFICATION_MAX_ATTEMPTS = 5;

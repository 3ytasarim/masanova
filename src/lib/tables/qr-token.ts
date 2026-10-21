import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Masa QR token'ları — üretim, özet ve doğrulama (saf; sır parametre olarak gelir, test edilebilir).
 *
 * Mimari:
 *   nonce     = 16 bayt CSPRNG (base64url)                      → veritabanında saklanır (tek başına işe yaramaz)
 *   token     = HMAC-SHA256(QR_TOKEN_SECRET, "v1:" + nonce)[0..16] → 128 bit, base64url, 22 karakter (URL'de)
 *   tokenHash = SHA-256(token) (hex)                              → veritabanında benzersiz arama anahtarı
 *
 * - Public adres yalnızca token'ı taşır: /t/<token>. Masa numarası, masa/şube/kiracı kimliği URL'de yoktur.
 * - Gelen token önce biçim olarak süzülür, sonra özeti alınıp tek indeksli sorguyla aranır.
 * - Veritabanı sızıntısı tek başına geçerli adres üretmeye yetmez (sır gerekir). Yetkili kullanıcı aynı QR'ı
 *   yeniden indirebilir: token nonce + sırdan yeniden türetilir ve saklanan özetle karşılaştırılır.
 */

export const QR_TOKEN_BYTES = 16;
/** 16 bayt base64url = 22 karakter (dolgu yok). */
export const QR_TOKEN_LENGTH = 22;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DERIVATION_CONTEXT = "masanova.table-qr.v1:";

export type IssuedQrToken = { token: string; nonce: string; tokenHash: string };

export function isWellFormedQrToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function hashQrToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function deriveQrToken(secret: string, nonce: string): string {
  if (secret.length < 32) throw new Error("QR_TOKEN_SECRET en az 32 karakter olmalı.");
  return createHmac("sha256", secret).update(DERIVATION_CONTEXT + nonce, "utf8").digest().subarray(0, QR_TOKEN_BYTES).toString("base64url");
}

/** Yeni token: rastgele nonce → türetilmiş token → özet. Düz token yalnızca çağırana döner, saklanmaz. */
export function issueQrToken(secret: string): IssuedQrToken {
  const nonce = randomBytes(QR_TOKEN_BYTES).toString("base64url");
  const token = deriveQrToken(secret, nonce);
  return { token, nonce, tokenHash: hashQrToken(token) };
}

/**
 * Saklanan nonce'tan token'ı yeniden türetir; özet eşleşmezse (ör. sır değiştirildi) null döner — yanlış
 * QR basılmasın diye çağıran "QR'ı yenileyin" demelidir.
 */
export function rederiveQrToken(secret: string, nonce: string, expectedHash: string): string | null {
  const token = deriveQrToken(secret, nonce);
  const actual = Buffer.from(hashQrToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return token;
}

/** Public QR yolu. Alan adı kiracının birincil alan adından gelir (bkz. getTenantUrl). */
export function qrTokenPath(token: string): string {
  return `/t/${token}`;
}

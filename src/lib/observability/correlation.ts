/**
 * İstek ilişkilendirme kimliği (correlation ID). Proxy her isteğe `x-request-id` ekler (gelen değer geçerliyse korunur,
 * aksi halde yeni üretilir) ve yanıta da yazar. Böylece "QR → sipariş → mutfak olayı" zinciri loglarda izlenebilir.
 * Kimlik rastgeledir; kiracı / masa / oturum bilgisi TAŞIMAZ. Edge ve Node'da çalışır (Web Crypto).
 */
export const CORRELATION_HEADER = "x-request-id";

const PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidCorrelationId(value: string | null | undefined): value is string {
  return !!value && PATTERN.test(value);
}

export function newCorrelationId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Gelen başlık geçerliyse onu, değilse yenisini döner (dışarıdan gelen değer log enjeksiyonu yapamaz). */
export function correlationIdFrom(headers: { get(name: string): string | null }): string {
  const incoming = headers.get(CORRELATION_HEADER);
  return isValidCorrelationId(incoming) ? incoming : newCorrelationId();
}

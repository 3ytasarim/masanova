import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Rezervasyon politikası (işletme ayarı) + yönetim belirteci yardımcıları.
 */
export type ReservationPolicy = {
  enabled: boolean;
  publicBookingEnabled: boolean;
  autoConfirm: boolean;
  defaultDurationMinutes: number;
  slotIntervalMinutes: number;
  minAdvanceMinutes: number;
  maxAdvanceDays: number;
  minPartySize: number;
  maxPartySize: number;
  bufferMinutes: number;
  cancellationCutoffMinutes: number;
  noShowGraceMinutes: number;
};

export const DEFAULT_POLICY: ReservationPolicy = {
  enabled: false,
  publicBookingEnabled: false,
  autoConfirm: true,
  defaultDurationMinutes: 90,
  slotIntervalMinutes: 30,
  minAdvanceMinutes: 60,
  maxAdvanceDays: 60,
  minPartySize: 1,
  maxPartySize: 8,
  bufferMinutes: 0,
  cancellationCutoffMinutes: 60,
  noShowGraceMinutes: 15,
};

export const SLOT_INTERVALS = [10, 15, 20, 30, 60] as const;

export type PolicyViolation = "party_too_small" | "party_too_large" | "too_soon" | "too_far" | "in_past";

/**
 * Zaman penceresi + kişi sayısı. Personel "zorla" (override) seçerse sahip / müdür bu kuralları aşabilir; masa
 * çakışmasını ASLA aşamaz (veritabanı kısıtı).
 */
export function policyViolation(policy: ReservationPolicy, input: { startsAt: Date; partySize: number; now: Date; channel: "public" | "staff" }): PolicyViolation | null {
  const t = input.startsAt.getTime();
  const now = input.now.getTime();
  if (input.partySize < policy.minPartySize) return "party_too_small";
  if (input.channel === "public" && input.partySize > policy.maxPartySize) return "party_too_large";
  if (t < now - 5 * 60_000) return "in_past";
  if (input.channel === "public" && t < now + policy.minAdvanceMinutes * 60_000) return "too_soon";
  if (t > now + policy.maxAdvanceDays * 86_400_000) return "too_far";
  return null;
}

// ─── Yönetim belirteci ───────────────────────────────────────────────────────

/** Belirteç = HMAC(sır, nonce) — ham değer saklanmaz ama yeniden türetilebilir (aynı istek tekrarında aynı bağlantı). */
export function deriveManageToken(secret: string, nonce: string): string {
  return createHmac("sha256", secret).update(`masanova.reservation-manage.v1:${nonce}`, "utf8").digest().subarray(0, 32).toString("base64url");
}

export function hashManageToken(token: string): string {
  return createHash("sha256").update(`masanova:reservation-token:v1:${token}`, "utf8").digest("hex");
}

export function newManageNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function newReservationPublicId(): string {
  return randomBytes(16).toString("base64url");
}

/** 256 bit belirteç biçimi (43 karakter base64url). Biçimsiz değer veritabanına sorgu yaptırmaz. */
export function isManageTokenFormat(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Aynı anahtar + aynı içerik = aynı rezervasyon; farklı içerik = ret. */
export function reservationRequestHash(input: { branchId: string; startsAt: string; partySize: number; guestName: string; phone: string | null; email: string | null; areaId: string | null; request: string | null }): string {
  return createHash("sha256").update(JSON.stringify([input.branchId, input.startsAt, input.partySize, input.guestName, input.phone, input.email, input.areaId, input.request])).digest("hex");
}

export function hashIdempotency(key: string): string {
  return createHash("sha256").update(`masanova:reservation-idem:v1:${key}`, "utf8").digest("hex");
}

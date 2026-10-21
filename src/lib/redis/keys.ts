import { createHash } from "node:crypto";

/**
 * Redis anahtar / kanal adları (saf — testlerde doğrudan sınanır). Kurallar:
 *  - Her ad `mn:<namespace>:` önekiyle başlar → aynı Redis'i paylaşan ortamlar (staging / prod / test koşusu) karışmaz.
 *  - Hız sınırı öznesi (IP, e-posta, masa kimliği…) Redis'e HAM yazılmaz: SHA-256 özeti kullanılır (Redis dökümünde
 *    kişisel veri yok, anahtar uzunluğu sabit, ":" enjeksiyonu imkânsız).
 *  - Gerçek zamanlı kanallar YALNIZCA sunucunun bildiği biçimlerden biri olabilir (beyaz liste); tarayıcı kanal adı
 *    seçemez, gönderemez. Kanal adındaki iç kimlikler Redis dışına (tarayıcıya) çıkmaz.
 */
export const KEY_PREFIX = "mn";

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function redisNamespace(raw: string | undefined | null): string {
  const value = (raw ?? "").trim().toLowerCase();
  return NAMESPACE_PATTERN.test(value) ? value : "default";
}

export function hashSubject(subject: string): string {
  return createHash("sha256").update(`masanova.rl.v1:${subject}`).digest("hex").slice(0, 32);
}

const POLICY_PATTERN = /^[a-z][a-z0-9.]{0,47}$/;

export function rateLimitKey(namespace: string, policy: string, subject: string): string {
  if (!POLICY_PATTERN.test(policy)) throw new Error("invalid_policy_name");
  return `${KEY_PREFIX}:${namespace}:rl:${policy}:${hashSubject(subject)}`;
}

/** Sunucunun ürettiği kanal biçimleri (bkz. src/server/realtime/bus.ts). Kimlikler cuid / base64url karakterleri. */
const CHANNEL_PATTERN = /^(?:tenant:[A-Za-z0-9_-]{1,64}:orders|order:[A-Za-z0-9_-]{1,64}|table:[A-Za-z0-9_-]{1,64})$/;

export function isRealtimeChannel(channel: string): boolean {
  return CHANNEL_PATTERN.test(channel);
}

export function realtimeRedisChannel(namespace: string, channel: string): string {
  if (!isRealtimeChannel(channel)) throw new Error("invalid_realtime_channel");
  return `${KEY_PREFIX}:${namespace}:rt:${channel}`;
}

/** Redis'ten gelen kanal adını uygulama kanalına çevir; başka ad alanı / biçim → null (yok sayılır). */
export function parseRealtimeRedisChannel(namespace: string, redisChannel: string): string | null {
  const prefix = `${KEY_PREFIX}:${namespace}:rt:`;
  if (!redisChannel.startsWith(prefix)) return null;
  const channel = redisChannel.slice(prefix.length);
  return isRealtimeChannel(channel) ? channel : null;
}

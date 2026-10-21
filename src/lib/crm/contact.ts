/**
 * Müşteri iletişim bilgisi — sunucu tarafı normalizasyon ve maskeleme (tarayıcı biçimine güvenilmez).
 * Telefon: E.164 (+905321234567). Türkiye yerel biçimleri (0532…, 532…) +90'a çevrilir; diğer ülkeler "+" / "00" ile.
 * E-posta: kırpılır, küçük harfe çevrilir (Unicode yerel parça normalizasyonu / alias birleştirme YAPILMAZ).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[\s().\-/]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^\+\d+$/.test(s)) return s.length >= 9 && s.length <= 16 ? s : null;
  if (!/^\d+$/.test(s)) return null;
  if (s.length === 11 && s.startsWith("05")) return `+90${s.slice(1)}`;
  if (s.length === 10 && s.startsWith("5")) return `+90${s}`;
  if (s.length === 12 && s.startsWith("90")) return `+${s}`;
  return null;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s.length > 254 || !EMAIL.test(s)) return null;
  return s;
}

/** "+905391234525" → "0539 *** ** 25" (liste / destek modu); yabancı numara → "+44 *** 25". */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (phone.startsWith("+90") && digits.length === 12) return `0${digits.slice(2, 5)} *** ** ${digits.slice(-2)}`;
  if (digits.length < 6) return "***";
  return `+${digits.slice(0, 2)} *** ${digits.slice(-2)}`;
}

/** "ayse.yilmaz@mail.com" → "a***@mail.com". */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

/** Gösterim adı: ad soyad → yoksa "Misafir · <public kısa kod>". İletişim bilgisi ASLA ad yerine kullanılmaz. */
export function displayName(c: { firstName: string | null; lastName: string | null; publicId: string }): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || `Misafir · ${c.publicId.slice(0, 6)}`;
}

/** Yalnızca harf / boşluk / kesme / tire; en fazla 60. Boş → null. */
export function cleanName(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > 60 || !/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(s)) return null;
  return s;
}

/**
 * Kupon kodu: kırpılır, büyük harfe çevrilir, boşluk / tire varyasyonları tek biçime iner. Yalnızca A–Z, 0–9, "-" ve "_"
 * (3–24). Büyük / küçük harf duyarsız. Türkçe harfler ASCII karşılığına çevrilir (i̇/ı → I, ş → S…) — müşteri "yaz10"
 * da "YAZ10" da yazsa aynı kod. Kod kiracı içinde çözülür; kiracıyı TANIMLAMAZ.
 */
const TR: Record<string, string> = { ç: "C", Ç: "C", ğ: "G", Ğ: "G", ı: "I", İ: "I", i: "I", ö: "O", Ö: "O", ş: "S", Ş: "S", ü: "U", Ü: "U" };
export const COUPON_CODE_RE = /^[A-Z0-9_-]{3,24}$/;

export function normalizeCouponCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const s = raw
    .trim()
    .replace(/[çÇğĞıİiöÖşŞüÜ]/g, (c) => TR[c] ?? c)
    .toUpperCase()
    .replace(/\s+/g, "");
  return COUPON_CODE_RE.test(s) ? s : null;
}

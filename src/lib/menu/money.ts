/**
 * Para: TÜM tutarlar tamsayı alt birimdir (kuruş/cent). 89,90 TRY = 8990.
 * Kayan nokta aritmetiği yapılmaz; ondalık metin yalnızca giriş/gösterim sınırında dönüştürülür.
 * (Desteklenen para birimlerinin hepsi 2 ondalıklı varsayılır — TRY/EUR/USD/GBP; JPY gibi 0 ondalıklılar
 * eklendiğinde ölçek para birimine göre okunacak.)
 */
export const MAX_PRICE_MINOR = 100_000_000; // 1.000.000,00

/**
 * Kullanıcı girdisini kuruşa çevirir: "89", "89,9", "89,90", "89.90", " 1250 " → tamsayı.
 * Binlik ayırıcı kabul edilmez (belirsizlik: "1.250" = 1,25 mi 1250 mi?). Geçersizse null.
 */
export function parsePriceToMinor(input: string): number | null {
  const value = input.trim().replace(/\s/g, "");
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + fraction;
  return Number.isSafeInteger(minor) && minor <= MAX_PRICE_MINOR ? minor : null;
}

/** Form alanında gösterim: 8990 → "89,90" (Intl kullanılmaz; sunucu ve tarayıcıda aynı çıktı). */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Görüntüleme: 8990, "TRY" → "₺89,90" (yerel biçim). Yalnızca sunucu bileşenlerinde / metin üretiminde kullanın. */
export function formatMoney(minor: number, currency: string, locale = "tr-TR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

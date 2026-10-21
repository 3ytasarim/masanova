/**
 * Çeviri seçimi (yedekli): istenen dil → kiracının varsayılan dili (ana satır) .
 * Ana satır (Product.name vb.) varsayılan dilin içeriğidir; varsayılan dil için ayrıca çeviri satırı tutulmaz.
 * Boş/yalnızca boşluk çeviriler yok sayılır (yarım kalmış çeviri menüde boş görünmesin).
 */
export type TranslationRow = { locale: string } & Record<string, unknown>;

export function pickTranslated<T extends Record<string, string | null | undefined>>(
  base: T,
  translations: readonly TranslationRow[],
  locale: string,
  defaultLocale: string,
): { values: T; locale: string; fallback: boolean } {
  if (locale === defaultLocale) return { values: base, locale: defaultLocale, fallback: false };
  const row = translations.find((t) => t.locale === locale);
  if (!row) return { values: base, locale: defaultLocale, fallback: true };

  const values = { ...base };
  let usedAny = false;
  for (const key of Object.keys(base) as (keyof T)[]) {
    const candidate = row[key as string];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      values[key] = candidate as T[keyof T];
      usedAny = true;
    }
  }
  return { values, locale: usedAny ? locale : defaultLocale, fallback: !usedAny };
}

/** Ad alanı için kısa yol (sistem alerjen/etiket kayıtları gibi yalnızca adı olan varlıklar). */
export function translatedName(
  name: string,
  translations: readonly { locale: string; name: string }[],
  locale: string,
  defaultLocale: string,
): string {
  const exact = translations.find((t) => t.locale === locale)?.name?.trim();
  if (exact) return exact;
  const fallback = translations.find((t) => t.locale === defaultLocale)?.name?.trim();
  return fallback || name;
}

/** Bir dil için çevirisi eksik mi? (Ad alanı boşsa eksik sayılır.) */
export function isTranslationMissing(translations: readonly { locale: string; name: string | null }[], locale: string): boolean {
  const row = translations.find((t) => t.locale === locale);
  return !row || !row.name || row.name.trim() === "";
}

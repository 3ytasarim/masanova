/**
 * Yerelleştirme değerlerinin doğrulama kaynakları — çalışma zamanının Intl verisinden (elle liste tutulmaz).
 */
const supported = (key: "timeZone" | "currency"): readonly string[] => {
  try {
    return Intl.supportedValuesOf(key);
  } catch {
    return [];
  }
};

export const TIME_ZONES: readonly string[] = supported("timeZone");
export const CURRENCIES: readonly string[] = supported("currency");
const TIME_ZONE_SET = new Set(TIME_ZONES);
const CURRENCY_SET = new Set(CURRENCIES);

/** Uygulamanın desteklediği arayüz/menü dilleri (BCP 47). Yeni dil eklendiğinde buraya eklenir. */
export const LOCALES = ["tr", "en", "de", "ru", "ar", "fr", "es", "it", "nl", "fa", "az", "ka", "uk"] as const;

export function isValidTimeZone(value: string): boolean {
  // Etc/UTC gibi takma adlar supportedValuesOf'ta olmayabilir; DateTimeFormat yedek kontrolü.
  if (TIME_ZONE_SET.has(value)) return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export function isValidCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value) && (CURRENCY_SET.size === 0 || CURRENCY_SET.has(value));
}

export function isValidLocale(value: string): boolean {
  return (LOCALES as readonly string[]).includes(value);
}

const regionNames = new Intl.DisplayNames(["tr"], { type: "region" });
const ISO_REGIONS = "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BG BH BR BY CA CH CL CN CO CY CZ DE DK DZ EE EG ES FI FR GB GE GR HR HU ID IE IL IN IQ IR IS IT JO JP KG KR KW KZ LB LT LU LV LY MA MD ME MK MT MX NL NO NZ OM PH PK PL PS PT QA RO RS RU SA SE SG SI SK SY TH TM TN TR UA US UZ XK".split(" ");

/** Ülke seçenekleri: ISO 3166-1 alpha-2 kod + Türkçe ad, ada göre sıralı. */
export const COUNTRIES: readonly { code: string; name: string }[] = ISO_REGIONS.map((code) => ({
  code,
  name: regionNames.of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name, "tr"));

const COUNTRY_SET = new Set(ISO_REGIONS);

export function isValidCountry(value: string): boolean {
  return COUNTRY_SET.has(value);
}

export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Form seçenek listeleri. Sunucuda üretilip istemci bileşenlerine prop olarak verilir: Node ve tarayıcının
 * ICU verisi farklı olabildiğinden (saat dilimi/para birimi listesi, ülke adları, sıralama) istemcide yeniden
 * hesaplamak hydration uyumsuzluğu yaratır.
 */
export type LocaleOptions = {
  timeZones: readonly string[];
  currencies: readonly string[];
  countries: readonly { code: string; name: string }[];
};

export function getLocaleOptions(): LocaleOptions {
  return { timeZones: TIME_ZONES, currencies: CURRENCIES, countries: COUNTRIES };
}

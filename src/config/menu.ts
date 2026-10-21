/**
 * Menü dil yapılandırması. Ana satırlar (Product.name vb.) kiracının varsayılan dilindeki kanonik içeriktir;
 * diğer diller çeviri tablolarındadır. Yeni bir menü dili eklemek = bu listeye eklemek (şema değişmez).
 */
export const MENU_LOCALES = ["tr", "en", "de", "ar"] as const;
export type MenuLocale = (typeof MENU_LOCALES)[number];

export const MENU_LOCALE_LABELS: Record<string, string> = {
  tr: "Türkçe",
  en: "English",
  de: "Deutsch",
  ar: "العربية",
};

/** Sağdan sola yazılan diller — çeviri editörü ve gelecekteki public menü `dir="rtl"` kullanır. */
const RTL_LOCALES: ReadonlySet<string> = new Set(["ar", "fa", "he", "ur"]);

export function isRtlLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale);
}

export function textDirection(locale: string): "rtl" | "ltr" {
  return isRtlLocale(locale) ? "rtl" : "ltr";
}

/** Kiracının düzenlenebilir menü dilleri: varsayılan dil + desteklenen menü dilleri (tekrarsız). */
export function menuLocalesFor(defaultLocale: string): string[] {
  return [defaultLocale, ...MENU_LOCALES.filter((l) => l !== defaultLocale)];
}

/** Çeviri girilebilecek diller (varsayılan dil hariç — onun içeriği ana satırdadır). */
export function translatableLocales(defaultLocale: string): string[] {
  return menuLocalesFor(defaultLocale).filter((l) => l !== defaultLocale);
}

export function isMenuLocale(value: string): value is MenuLocale {
  return (MENU_LOCALES as readonly string[]).includes(value);
}

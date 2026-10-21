import { MENU_LOCALES, isMenuLocale, type MenuLocale } from "@/config/menu";

/**
 * Public menü arayüz metinleri (tr/en/de/ar). Menü İÇERİĞİ çeviri tablolarından gelir; burada yalnızca arayüz.
 * Arapça metinler örnek çeviridir — yayından önce anadili Arapça olan biri tarafından gözden geçirilmeli.
 * Alerjen/diyet ifadeleri bilinçli olarak tıbbi garanti vermez ("işletmenin beyanına göre").
 */
export type PublicStrings = {
  welcome: string;
  table: string;
  searchLabel: string;
  searchPlaceholder: string;
  clearSearch: string;
  popular: string;
  categories: string;
  filters: string;
  filtersTitle: string;
  dietaryHeading: string;
  allergenHeading: string;
  declaredNote: string;
  clearFilters: string;
  showResults: (n: number) => string;
  results: (n: number) => string;
  noResults: string;
  noResultsHint: string;
  emptyMenu: string;
  emptyMenuHint: string;
  soldOut: string;
  featured: string;
  /** Varyantlı ürünün en düşük fiyatı: "₺50,00'dan başlayan" / "from ₺50.00". */
  startingAt: (price: string) => string;
  prep: (minutes: number) => string;
  variants: string;
  modifiers: string;
  required: string;
  optional: string;
  rule: (min: number, max: number) => string;
  ingredients: string;
  allergens: string;
  allergenNone: string;
  allergenUnknown: string;
  dietary: string;
  nutrition: string;
  perServing: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  allergenNotice: string;
  viewOnly: string;
  close: string;
  details: (name: string) => string;
  language: string;
  poweredBy: string;
  /** Yazılım üreticisi satırı (imzanın altında). */
  madeBy: string;
  preview: string;
};

/**
 * Türkçe ayrılma hâli eki (-den/-dan/-ten/-tan) fiyatın okunuşundaki son sayıya göre: "₺50,00" → "sıfır" → 'dan.
 */
export function turkishAblative(price: string): string {
  const digit = [...price].reverse().find((c) => c >= "0" && c <= "9");
  const suffix: Record<string, string> = { "0": "dan", "1": "den", "2": "den", "3": "ten", "4": "ten", "5": "ten", "6": "dan", "7": "den", "8": "den", "9": "dan" };
  return `'${suffix[digit ?? "0"]}`;
}

const tr: PublicStrings = {
  welcome: "Hoş geldiniz",
  table: "Masa",
  searchLabel: "Menüde ara",
  searchPlaceholder: "Menüde ara",
  clearSearch: "Aramayı temizle",
  popular: "Popüler",
  categories: "Kategoriler",
  filters: "Filtreler",
  filtersTitle: "Tercihlerinize göre filtreleyin",
  dietaryHeading: "Beslenme tercihi",
  allergenHeading: "İçermesin",
  declaredNote: "Restoranın belirttiği bilgilere göre. Alerjen bilgisi girilmemiş ürünler “içermesin” filtresinde gösterilmez.",
  clearFilters: "Temizle",
  showResults: (n) => `${n} ürünü göster`,
  results: (n) => `${n} sonuç`,
  noResults: "Sonuç bulunamadı",
  noResultsHint: "Farklı bir kelime deneyin ya da filtreleri temizleyin.",
  emptyMenu: "Menü hazırlanıyor",
  emptyMenuHint: "Bu şubenin menüsü henüz yayınlanmadı. Lütfen personelden yardım isteyin.",
  soldOut: "Tükendi",
  featured: "Öne çıkan",
  startingAt: (price) => `${price}${turkishAblative(price)} başlayan`,
  prep: (m) => `~${m} dk`,
  variants: "Seçenekler",
  modifiers: "Ekstralar",
  required: "Zorunlu",
  optional: "İsteğe bağlı",
  rule: (min, max) => (min === max ? `${min} seçim` : min > 0 ? `En az ${min}, en fazla ${max}` : `En fazla ${max}`),
  ingredients: "İçindekiler",
  allergens: "Alerjenler",
  allergenNone: "İşletme bu ürün için alerjen beyan etmedi.",
  allergenUnknown: "Alerjen bilgisi girilmemiş. Lütfen personele danışın.",
  dietary: "Beslenme",
  nutrition: "Besin değerleri",
  perServing: "Porsiyon başına, işletme beyanı",
  calories: "Enerji",
  protein: "Protein",
  carbs: "Karbonhidrat",
  fat: "Yağ",
  allergenNotice: "Alerjen ve içerik bilgileri işletme tarafından sağlanmaktadır. Çapraz bulaşma riski için işletme personeline danışınız.",
  viewOnly: "Seçenekleri inceleyebilirsiniz; sipariş için lütfen personele başvurun.",
  close: "Kapat",
  details: (name) => `${name} — ayrıntılar`,
  language: "Dil",
  poweredBy: "MasaNova AI altyapısıyla",
  madeBy: "Bu yazılım 3Y Tasarım & Yazılım Hizmetleri ürünüdür.",
  preview: "Önizleme",
};

const en: PublicStrings = {
  welcome: "Welcome",
  table: "Table",
  searchLabel: "Search the menu",
  searchPlaceholder: "Search the menu",
  clearSearch: "Clear search",
  popular: "Popular",
  categories: "Categories",
  filters: "Filters",
  filtersTitle: "Filter by your preferences",
  dietaryHeading: "Dietary preference",
  allergenHeading: "Without",
  declaredNote: "Based on information provided by the restaurant. Items without allergen information are hidden by “without” filters.",
  clearFilters: "Clear",
  showResults: (n) => `Show ${n} items`,
  results: (n) => `${n} results`,
  noResults: "No results",
  noResultsHint: "Try another word or clear the filters.",
  emptyMenu: "Menu coming soon",
  emptyMenuHint: "This branch's menu has not been published yet. Please ask the staff.",
  soldOut: "Sold out",
  featured: "Featured",
  startingAt: (price) => `from ${price}`,
  prep: (m) => `~${m} min`,
  variants: "Options",
  modifiers: "Extras",
  required: "Required",
  optional: "Optional",
  rule: (min, max) => (min === max ? `Choose ${min}` : min > 0 ? `Choose ${min}–${max}` : `Up to ${max}`),
  ingredients: "Ingredients",
  allergens: "Allergens",
  allergenNone: "The restaurant declared no allergens for this item.",
  allergenUnknown: "Allergen information not provided. Please ask the staff.",
  dietary: "Dietary",
  nutrition: "Nutrition",
  perServing: "Per serving, as declared by the restaurant",
  calories: "Energy",
  protein: "Protein",
  carbs: "Carbohydrates",
  fat: "Fat",
  allergenNotice: "Allergen and ingredient information is provided by the restaurant. Please ask the staff about cross-contamination risks.",
  viewOnly: "You can browse the options; please ask the staff to order.",
  close: "Close",
  details: (name) => `${name} — details`,
  language: "Language",
  poweredBy: "Powered by MasaNova AI",
  madeBy: "This software is a product of 3Y Tasarım & Yazılım Hizmetleri.",
  preview: "Preview",
};

const de: PublicStrings = {
  welcome: "Willkommen",
  table: "Tisch",
  searchLabel: "Speisekarte durchsuchen",
  searchPlaceholder: "Speisekarte durchsuchen",
  clearSearch: "Suche löschen",
  popular: "Beliebt",
  categories: "Kategorien",
  filters: "Filter",
  filtersTitle: "Nach Ihren Vorlieben filtern",
  dietaryHeading: "Ernährung",
  allergenHeading: "Ohne",
  declaredNote: "Laut Angaben des Restaurants. Gerichte ohne Allergenangaben werden bei „Ohne“-Filtern ausgeblendet.",
  clearFilters: "Zurücksetzen",
  showResults: (n) => `${n} Gerichte anzeigen`,
  results: (n) => `${n} Ergebnisse`,
  noResults: "Keine Ergebnisse",
  noResultsHint: "Versuchen Sie ein anderes Wort oder setzen Sie die Filter zurück.",
  emptyMenu: "Speisekarte folgt",
  emptyMenuHint: "Die Speisekarte dieser Filiale ist noch nicht veröffentlicht. Bitte wenden Sie sich an das Personal.",
  soldOut: "Ausverkauft",
  featured: "Empfohlen",
  startingAt: (price) => `ab ${price}`,
  prep: (m) => `~${m} Min.`,
  variants: "Varianten",
  modifiers: "Extras",
  required: "Pflicht",
  optional: "Optional",
  rule: (min, max) => (min === max ? `${min} wählen` : min > 0 ? `${min}–${max} wählen` : `Bis zu ${max}`),
  ingredients: "Zutaten",
  allergens: "Allergene",
  allergenNone: "Das Restaurant hat für dieses Gericht keine Allergene angegeben.",
  allergenUnknown: "Keine Allergenangaben. Bitte fragen Sie das Personal.",
  dietary: "Ernährung",
  nutrition: "Nährwerte",
  perServing: "Pro Portion, laut Restaurant",
  calories: "Energie",
  protein: "Eiweiß",
  carbs: "Kohlenhydrate",
  fat: "Fett",
  allergenNotice: "Allergen- und Zutatenangaben stammen vom Restaurant. Bitte fragen Sie das Personal nach Kreuzkontaminationsrisiken.",
  viewOnly: "Sie können die Optionen ansehen; bitte bestellen Sie beim Personal.",
  close: "Schließen",
  details: (name) => `${name} — Details`,
  language: "Sprache",
  poweredBy: "Mit MasaNova AI",
  madeBy: "Diese Software ist ein Produkt von 3Y Tasarım & Yazılım Hizmetleri.",
  preview: "Vorschau",
};

const ar: PublicStrings = {
  welcome: "أهلاً وسهلاً",
  table: "طاولة",
  searchLabel: "ابحث في القائمة",
  searchPlaceholder: "ابحث في القائمة",
  clearSearch: "مسح البحث",
  popular: "الأكثر طلباً",
  categories: "الأقسام",
  filters: "التصفية",
  filtersTitle: "صفِّ حسب تفضيلاتك",
  dietaryHeading: "النظام الغذائي",
  allergenHeading: "بدون",
  declaredNote: "وفقاً للمعلومات التي قدّمها المطعم. تُخفى الأطباق التي لا تتوفر لها معلومات عن مسببات الحساسية عند استخدام فلتر «بدون».",
  clearFilters: "مسح",
  showResults: (n) => `عرض ${n} أطباق`,
  results: (n) => `${n} نتيجة`,
  noResults: "لا توجد نتائج",
  noResultsHint: "جرّب كلمة أخرى أو امسح عوامل التصفية.",
  emptyMenu: "القائمة قيد الإعداد",
  emptyMenuHint: "لم تُنشر قائمة هذا الفرع بعد. يرجى سؤال الموظفين.",
  soldOut: "نفد",
  featured: "مميز",
  startingAt: (price) => `ابتداءً من ${price}`,
  prep: (m) => `~${m} دقيقة`,
  variants: "الخيارات",
  modifiers: "الإضافات",
  required: "إلزامي",
  optional: "اختياري",
  rule: (min, max) => (min === max ? `اختر ${min}` : min > 0 ? `اختر من ${min} إلى ${max}` : `حتى ${max}`),
  ingredients: "المكونات",
  allergens: "مسببات الحساسية",
  allergenNone: "لم يصرّح المطعم بوجود مسببات حساسية في هذا الطبق.",
  allergenUnknown: "لا تتوفر معلومات عن مسببات الحساسية. يرجى سؤال الموظفين.",
  dietary: "النظام الغذائي",
  nutrition: "القيم الغذائية",
  perServing: "لكل حصة، حسب تصريح المطعم",
  calories: "الطاقة",
  protein: "البروتين",
  carbs: "الكربوهيدرات",
  fat: "الدهون",
  allergenNotice: "معلومات مسببات الحساسية والمكونات مقدّمة من المطعم. يرجى استشارة الموظفين بشأن خطر التلوث المتبادل.",
  viewOnly: "يمكنك تصفح الخيارات؛ للطلب يرجى التوجه إلى الموظفين.",
  close: "إغلاق",
  details: (name) => `${name} — التفاصيل`,
  language: "اللغة",
  poweredBy: "بدعم من MasaNova AI",
  madeBy: "هذا البرنامج من منتجات 3Y Tasarım & Yazılım Hizmetleri.",
  preview: "معاينة",
};

const STRINGS: Record<MenuLocale, PublicStrings> = { tr, en, de, ar };

export function publicStrings(locale: string): PublicStrings {
  return isMenuLocale(locale) ? STRINGS[locale] : tr;
}

/** Dil göstergesi: TR / EN / DE / AR */
export const LOCALE_BADGES: Record<MenuLocale, string> = { tr: "TR", en: "EN", de: "DE", ar: "AR" };

export const PUBLIC_LOCALE_COOKIE = "mn_dil";
export const PUBLIC_LOCALE_PARAM = "dil";

/**
 * Görüntüleme dili: URL (?dil=) → cihazda hatırlanan tercih (çerez, yalnızca dil kodu) → kiracının varsayılan dili.
 * Yönlendirme yapılmaz; desteklenmeyen değerler sessizce yok sayılır.
 */
export function pickPublicLocale(input: { query?: string | null; cookie?: string | null; tenantDefault: string }): MenuLocale {
  for (const candidate of [input.query, input.cookie, input.tenantDefault]) {
    if (candidate && isMenuLocale(candidate)) return candidate;
  }
  return MENU_LOCALES[0];
}

/**
 * Para birimi biçimi için BCP 47 etiketi. Arapça arayüzde fiyatlar işletmenin kasası/fişiyle aynı görünsün diye
 * Türk biçimiyle (₺380,00, Latin rakam) gösterilir; "ar" ICU verisi ortama göre "TRY 380.00" üretebiliyor.
 */
export const NUMBER_LOCALES: Record<MenuLocale, string> = { tr: "tr-TR", en: "en-GB", de: "de-DE", ar: "tr-TR" };

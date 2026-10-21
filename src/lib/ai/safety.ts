import { AI_LIMITS } from "@/lib/ai/limits";
import type { AiLanguage } from "@/lib/voice/language-detection";

/**
 * Güvenlik yardımcıları (saf). Model yanıtı ve kullanıcı girdisi için savunma katmanları. Asıl güvenlik araç katmanındadır
 * (kiracı kapsamı sunucuda, ürünler güvenilir menü görünümünden); bunlar ek koruma ve deterministik yönlendirmedir.
 */
export const USER_TEXT_MAX = AI_LIMITS.maxUserTextChars;
export const ASSISTANT_TEXT_MAX = 900;
export const CUSTOM_INSTRUCTIONS_MAX = 300;

/** Düz metin: kontrol / yön işaretleri atılır, boşluk sadeleşir, uzunluk sınırlanır. */
export function sanitizeUserText(value: string, max: number = USER_TEXT_MAX): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const INJECTION =
  /(system ?prompt|sistem ?prompt|talimatların[ıi]|instructions?\b.*(show|reveal|print)|ignore (all|previous|the) (rules|instructions)|kuralları (unut|yok say)|forget (the |your )?rules|regeln vergessen|забудь (правила|инструкции)|تجاهل التعليمات|api ?key|api anahtar|secret|şifre|password|developer mode|jailbreak|başka (bir )?restoran|other restaurant|another restaurant|anderes restaurant|друго(й|го) ресторан|مطعم آخر|tenant ?id|veritaban[ıi]|database)/i;

/** İstem enjeksiyonu / sır isteği / kiracılar arası istek. (Araçlar ayrıca kiracı dışına zaten erişemez.) */
export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}

const OUT_OF_SCOPE =
  /\b(python|javascript|typescript|java|c\+\+|sql|kod yaz|write (some )?code|programm|program yaz|ödev|homework|essay|makale yaz|translate this|hava durumu|weather|wetter|погода|الطقس|haber|news|nachrichten|новости|borsa|stock|bitcoin|kripto|crypto|şiir yaz|poem|gedicht|стих|سياسة|politik|politics|siyaset)/i;

/** Restoran dışı konu (genel amaçlı asistan değiliz). */
export function looksOutOfScope(text: string): boolean {
  return OUT_OF_SCOPE.test(text);
}

const ABSOLUTE_SAFETY =
  /(kesinlikle güvenli|tamamen güvenli|%\s?100 güvenli|hiç risk yok|alerjen içermez kesin|completely safe|100\s?% safe|definitely safe|guaranteed safe|absolutely safe|garantiert sicher|völlig sicher|absolut sicher|абсолютно безопас|полностью безопас|آمن تماما|آمن تمامًا|مضمون)/i;
const SALES_CLAIM = /(en çok satan|en çok tercih edilen|best[- ]?sell(er|ing)|most popular|meistverkauft|am beliebtesten|самый продаваемый|самое популярное|الأكثر مبيعا|الأكثر مبيعًا)/i;

export const ALLERGEN_CAUTION: Record<AiLanguage, string> = {
  tr: "Alerjen konusunda kesin güvence veremem; restoranın belirttiği bilgilere göre yanıt veriyorum. Çapraz bulaşma riski için lütfen personele danışın.",
  en: "I can't guarantee allergen safety; I'm answering based on the information the restaurant has provided. Please check with the staff about cross-contamination.",
  de: "Ich kann keine Allergen-Sicherheit garantieren; ich antworte anhand der Angaben des Restaurants. Bitte fragen Sie das Personal wegen möglicher Kreuzkontamination.",
  ar: "لا يمكنني ضمان خلو الطعام من مسببات الحساسية؛ أجيب وفق المعلومات التي قدمها المطعم. يرجى سؤال الموظفين عن خطر التلوث المتبادل.",
  ru: "Я не могу гарантировать отсутствие аллергенов; отвечаю по данным ресторана. Пожалуйста, уточните у персонала риск перекрёстного загрязнения.",
};

export const FEATURED_PHRASE: Record<AiLanguage, string> = {
  tr: "restoranın öne çıkardığı",
  en: "featured by the restaurant",
  de: "vom Restaurant empfohlen",
  ar: "من الأطباق المميزة لدى المطعم",
  ru: "рекомендуемое рестораном",
};

/**
 * Model yanıt koruması: mutlak alerjen güvencesi → temkinli ifade eklenir; satış verisi olmadan "en çok satan" iddiası →
 * "restoranın öne çıkardığı" ile değiştirilir; uzunluk sınırlanır (ses için kısa).
 */
export function guardAssistantText(text: string, language: AiLanguage): string {
  let out = text.replace(/\s+\n/g, "\n").trim();
  if (SALES_CLAIM.test(out)) out = out.replace(new RegExp(SALES_CLAIM.source, "gi"), FEATURED_PHRASE[language]);
  if (ABSOLUTE_SAFETY.test(out)) out = `${out.replace(new RegExp(ABSOLUTE_SAFETY.source, "gi"), "…")} ${ALLERGEN_CAUTION[language]}`;
  if (out.length > ASSISTANT_TEXT_MAX) out = `${out.slice(0, ASSISTANT_TEXT_MAX - 1).replace(/\s+\S*$/, "")}…`;
  return out;
}

/** İşletme özel talimatı: düşük güvenli tercih — uzunluk sınırı + platform kurallarını çiğneyen ifadeler atılır. */
export function sanitizeCustomInstructions(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = sanitizeUserText(value, CUSTOM_INSTRUCTIONS_MAX);
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => !ABSOLUTE_SAFETY.test(s) && !looksLikeInjection(s) && !/(güvenli|alerj|allerg|safe|sicher|безопас|аллерг|آمن|حساسية|sipariş(i)? gönder|submit|place order)/i.test(s));
  const joined = sentences.join(" ").trim();
  return joined || null;
}

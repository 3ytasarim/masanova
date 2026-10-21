/**
 * Konuşma dili algılama — deterministik, modelden bağımsız (test edilebilir, sağlayıcı değişse de aynı davranır).
 *
 * Sıra:
 *  1. Açık dil değiştirme: bir dil adı ("English", "Almanca", "по-русски", "بالعربية"…) + değiştirme ipucu
 *     ("konuşur musun", "continue", "bitte", "давайте"…) ya da çok kısa ifade → güven 0.98, açık geçiş.
 *  2. Alfabe: Arapça / Kiril harf oranı → ar / ru (0.95).
 *  3. Latin: Türkçe / İngilizce / Almanca sık kelime + özel harf puanı → oransal güven.
 * Kural: güven ESİĞİN altındaysa mevcut dil korunur (hızlı dil sıçraması yok). Orta güvende `uncertain` → asistan kısa bir
 * netleştirme sorusu sorabilir.
 */
export const AI_LANGUAGES = ["tr", "en", "de", "ar", "ru"] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];

export function isAiLanguage(value: unknown): value is AiLanguage {
  return typeof value === "string" && (AI_LANGUAGES as readonly string[]).includes(value);
}

export type LanguageDetection = {
  language: AiLanguage;
  /** 0–1 */
  confidence: number;
  /** Kullanıcı açıkça "X dilinde devam edelim" dedi. */
  explicitSwitch: boolean;
  /** Mevcut dilden farklı bir dile ORTA güvenle işaret ediyor (netleştirme sorulabilir). */
  uncertain: boolean;
  /** Algılanan aday (eşik altında kalsa da) — netleştirme sorusu için. */
  candidate: AiLanguage | null;
};

export const SWITCH_CONFIDENCE = 0.75;
export const UNCERTAIN_CONFIDENCE = 0.5;

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR").normalize("NFC").replace(/[“”"'’`´]/g, " ").replace(/\s+/g, " ").trim();
}

/** Dil adları (5 dilde) — açık geçiş için. */
const LANGUAGE_NAMES: Record<AiLanguage, RegExp> = {
  tr: /\b(türkçe|turkce|turkish|türkisch|turkisch)\b|турецк|التركية|بالتركية/u,
  en: /\b(english|ingilizce|i̇ngilizce|englisch)\b|английск|الإنجليزية|الانجليزية|بالإنجليزية|بالانجليزية/u,
  de: /\b(deutsch|german|almanca|alman)\b|немецк|الألمانية|بالألمانية/u,
  ar: /\b(arabic|arapça|arapca|arabisch)\b|арабск|العربية|بالعربية|عربي/u,
  ru: /\b(russian|rusça|rusca|russisch)\b|русск|по-русски|الروسية|بالروسية/u,
};

/** Dil değiştirme ipuçları (herhangi bir dilde). */
const SWITCH_CUES =
  /\b(speak|speaking|continue|switch|please|in|talk|devam|konuş|konus|bilir misin|biliyor musun|edelim|lütfen|sprechen|sprichst|weiter|bitte|auf|reden)\b|говорите|говоришь|давайте|продолж|пожалуйста|по-|تحدث|تتحدث|هل|من فضلك|نكمل|تكلم/u;

const STOPWORDS: Record<"tr" | "en" | "de", readonly string[]> = {
  tr: ["ve", "bir", "bu", "ne", "var", "mı", "mi", "mu", "mü", "için", "ile", "çok", "de", "da", "bana", "musun", "misin", "önerir", "öner", "kişiyiz", "iki", "olmayan", "içinde", "lira", "ekle", "istiyorum", "nedir", "hangi", "hangisi", "lütfen", "tamam", "evet", "hayır", "biraz", "şey", "acı", "tatlı", "sepette", "sipariş", "garson", "hesap", "getirir", "misiniz", "olarak"],
  en: ["the", "a", "an", "is", "are", "what", "do", "you", "can", "could", "with", "and", "for", "something", "recommend", "please", "have", "how", "much", "in", "of", "is", "there", "any", "me", "i", "we", "our", "would", "like", "add", "cart", "bill", "water", "waiter", "chicken", "spicy", "budget", "people", "us", "three", "two", "some", "which", "cheapest"],
  de: ["der", "die", "das", "und", "ist", "ich", "wir", "sie", "nicht", "mit", "für", "ein", "eine", "einen", "haben", "möchten", "bitte", "was", "gibt", "es", "können", "empfehlen", "zwei", "personen", "unter", "bleiben", "etwas", "hähnchen", "scharf", "rechnung", "wasser", "kellner", "noch", "auch", "wie", "viel", "ohne", "zum", "zur"],
};

function scriptRatio(text: string): { arabic: number; cyrillic: number; latin: number } {
  let arabic = 0;
  let cyrillic = 0;
  let latin = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0750 && c <= 0x077f) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) arabic++;
    else if (c >= 0x0400 && c <= 0x04ff) cyrillic++;
    else if (/\p{L}/u.test(ch)) latin++;
  }
  const total = arabic + cyrillic + latin || 1;
  return { arabic: arabic / total, cyrillic: cyrillic / total, latin: latin / total };
}

export function detectLanguage(rawText: string, current: AiLanguage): LanguageDetection {
  const text = normalize(rawText);
  const keep = (confidence = 0, candidate: AiLanguage | null = null, uncertain = false): LanguageDetection => ({ language: current, confidence, explicitSwitch: false, uncertain, candidate });
  if (!text) return keep();

  // 1) Açık geçiş
  const words = text.split(" ").filter(Boolean);
  const named = AI_LANGUAGES.filter((l) => LANGUAGE_NAMES[l].test(text));
  if (named.length === 1 && (SWITCH_CUES.test(text) || words.length <= 4)) {
    return { language: named[0]!, confidence: 0.98, explicitSwitch: true, uncertain: false, candidate: named[0]! };
  }

  // 2) Alfabe
  const ratio = scriptRatio(text);
  if (ratio.arabic >= 0.4) return { language: "ar", confidence: 0.95, explicitSwitch: false, uncertain: false, candidate: "ar" };
  if (ratio.cyrillic >= 0.4) return { language: "ru", confidence: 0.95, explicitSwitch: false, uncertain: false, candidate: "ru" };

  // 3) Latin: sık kelime + özel harfler
  const scores = { tr: 0, en: 0, de: 0 };
  for (const w of words) {
    const bare = w.replace(/[^\p{L}]/gu, "");
    for (const lang of ["tr", "en", "de"] as const) if (STOPWORDS[lang].includes(bare)) scores[lang] += 1;
  }
  scores.tr += (text.match(/[ğışİ]/g)?.length ?? 0) * 1.5 + (text.match(/[çöü]/g)?.length ?? 0) * 0.4;
  scores.de += (text.match(/[äß]/g)?.length ?? 0) * 1.5 + (text.match(/[öü]/g)?.length ?? 0) * 0.4;
  const ranked = (Object.entries(scores) as ["tr" | "en" | "de", number][]).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0]!;
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  if (bestScore < 2 || total === 0) return keep(0, bestScore > 0 ? best : null); // çok kısa / kanıt yok
  const confidence = Math.min(0.97, bestScore / total);
  if (best === current) return { language: current, confidence, explicitSwitch: false, uncertain: false, candidate: best };
  if (confidence >= SWITCH_CONFIDENCE) return { language: best, confidence, explicitSwitch: false, uncertain: false, candidate: best };
  return keep(confidence, best, confidence >= UNCERTAIN_CONFIDENCE);
}

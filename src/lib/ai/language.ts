import { AI_LANGUAGES, detectLanguage, isAiLanguage, type AiLanguage, type LanguageDetection } from "@/lib/voice/language-detection";

export { AI_LANGUAGES, isAiLanguage, type AiLanguage };

/**
 * Konuşma dili durumu. Konuşma dili menü (arayüz) dilinden BAĞIMSIZDIR: asistan İngilizce konuşurken menü Türkçe
 * kalabilir; menü dili yalnızca müşteri seçerse değişir.
 */
export const AI_LANGUAGE_LABELS: Record<AiLanguage, string> = { tr: "Türkçe", en: "English", de: "Deutsch", ar: "العربية", ru: "Русский" };

/** BCP-47 (Intl / speech) karşılıkları. */
export const AI_LANGUAGE_TAGS: Record<AiLanguage, string> = { tr: "tr-TR", en: "en-GB", de: "de-DE", ar: "ar", ru: "ru-RU" };

export function aiDirection(language: AiLanguage): "rtl" | "ltr" {
  return language === "ar" ? "rtl" : "ltr";
}

/** Dil değişince BİR kez söylenen kısa onay. */
export const LANGUAGE_ACKNOWLEDGEMENTS: Record<AiLanguage, string> = {
  tr: "Tabii, Türkçe devam edebiliriz.",
  en: "Of course. We can continue in English.",
  de: "Natürlich, wir können auf Deutsch weitermachen.",
  ar: "بالتأكيد، يمكننا المتابعة بالعربية.",
  ru: "Конечно, давайте продолжим по-русски.",
};

/** Belirsiz algılamada kısa netleştirme (mevcut dilde sorulur). */
export function clarificationQuestion(current: AiLanguage, candidate: AiLanguage): string {
  const names: Record<AiLanguage, Record<AiLanguage, string>> = {
    tr: { tr: "Türkçe", en: "İngilizce", de: "Almanca", ar: "Arapça", ru: "Rusça" },
    en: { tr: "Turkish", en: "English", de: "German", ar: "Arabic", ru: "Russian" },
    de: { tr: "Türkisch", en: "Englisch", de: "Deutsch", ar: "Arabisch", ru: "Russisch" },
    ar: { tr: "التركية", en: "الإنجليزية", de: "الألمانية", ar: "العربية", ru: "الروسية" },
    ru: { tr: "турецком", en: "английском", de: "немецком", ar: "арабском", ru: "русском" },
  };
  const n = names[current];
  switch (current) {
    case "tr":
      return `${n[current]} mi ${n[candidate]} mi devam edelim?`;
    case "en":
      return `Shall we continue in ${n[current]} or ${n[candidate]}?`;
    case "de":
      return `Sollen wir auf ${n[current]} oder ${n[candidate]} weitermachen?`;
    case "ar":
      return `هل نكمل باللغة ${n[current]} أم ${n[candidate]}؟`;
    case "ru":
      return `Продолжим на ${n[current]} или на ${n[candidate]}?`;
  }
}

export type LanguageDecision = {
  language: AiLanguage;
  switched: boolean;
  /** Onay cümlesi (yalnızca geçişte, bir kez). */
  acknowledgement: string | null;
  /** Netleştirme sorusu (belirsiz algılamada; dil değişmez). */
  clarification: string | null;
  detection: LanguageDetection;
};

/** Konuşma dilini güncelle: güven yeterliyse geçiş + tek seferlik onay; belirsizse mevcut dil + netleştirme. */
export function decideLanguage(utterance: string, current: AiLanguage): LanguageDecision {
  const detection = detectLanguage(utterance, current);
  const switched = detection.language !== current;
  return {
    language: detection.language,
    switched,
    acknowledgement: switched ? LANGUAGE_ACKNOWLEDGEMENTS[detection.language] : null,
    clarification: !switched && detection.uncertain && detection.candidate && detection.candidate !== current ? clarificationQuestion(current, detection.candidate) : null,
    detection,
  };
}

/** Başlangıç dili: işletme ayarı → işletme varsayılan dili → tr. */
export function initialLanguage(settingsLanguage: string | null | undefined, tenantDefault: string | null | undefined): AiLanguage {
  if (isAiLanguage(settingsLanguage)) return settingsLanguage;
  if (isAiLanguage(tenantDefault)) return tenantDefault;
  return "tr";
}

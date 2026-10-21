import type { AiLanguage } from "@/lib/voice/language-detection";

/** Menüdeki "AI ile Konuş" düğmesi — ayrı küçük modül (tüm asistan metinleri ana pakete girmesin; panel tembel yüklenir). */
export const AI_CTA: Record<AiLanguage, string> = {
  tr: "AI ile Konuş",
  en: "Talk to AI",
  de: "Mit KI sprechen",
  ar: "تحدث مع الذكاء الاصطناعي",
  ru: "Поговорить с ИИ",
};

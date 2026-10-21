import "server-only";
import { getServerEnv } from "@/lib/env";
import type { AiProvider } from "@/lib/ai/provider";
import type { AiLanguage } from "@/lib/voice/language-detection";
import type { SttProvider, TtsProvider } from "@/lib/voice/provider";
import { createOpenAiProvider, createOpenAiStt, createOpenAiTts } from "@/server/services/ai/providers/openai";
import { createRuleBasedProvider, createMockStt, createMockTts } from "@/server/services/ai/providers/mock";
import { mocksAllowed } from "@/lib/runtime-profile";

/**
 * Sağlayıcı kayıt defteri — ortam değişkenlerinden (YALNIZCA sunucu). Anahtarlar hiçbir yanıta / loga / tarayıcıya gitmez.
 * Sağlayıcı yoksa null → asistan "yapılandırılmamış" (müşteriye gösterilmez).
 */
export type ProviderSet = { ai: AiProvider | null; stt: SttProvider | null; tts: TtsProvider | null };

const DEFAULT_VOICES: Record<AiLanguage, string> = { tr: "coral", en: "alloy", de: "sage", ar: "shimmer", ru: "nova" };

let cached: ProviderSet | null = null;

export function getProviders(): ProviderSet {
  if (cached) return cached;
  const env = getServerEnv();
  // Sprint 21: "mock" yalnızca APP_ENV ≠ production (üretimde yok sayılır → AI kapalı, açılışta uyarı).
  const mock = mocksAllowed();
  const aiKey = env.AI_API_KEY || "";
  const ai =
    env.AI_PROVIDER === "openai" && aiKey ? createOpenAiProvider({ apiKey: aiKey, model: env.AI_MODEL || "gpt-4.1-mini" }) : env.AI_PROVIDER === "mock" && mock ? createRuleBasedProvider() : null;
  const sttKey = env.VOICE_STT_API_KEY || aiKey;
  const stt =
    env.VOICE_STT_PROVIDER === "openai" && sttKey ? createOpenAiStt({ apiKey: sttKey, model: env.VOICE_STT_MODEL || "gpt-4o-mini-transcribe" }) : env.VOICE_STT_PROVIDER === "mock" && mock ? createMockStt() : null;
  const ttsKey = env.VOICE_TTS_API_KEY || aiKey;
  const tts =
    env.VOICE_TTS_PROVIDER === "openai" && ttsKey ? createOpenAiTts({ apiKey: ttsKey, model: env.VOICE_TTS_MODEL || "gpt-4o-mini-tts" }) : env.VOICE_TTS_PROVIDER === "mock" && mock ? createMockTts() : null;
  cached = { ai, stt, tts };
  return cached;
}

export function voiceFor(language: AiLanguage): string {
  const env = getServerEnv();
  const configured = { tr: env.VOICE_TTS_VOICE_TR, en: env.VOICE_TTS_VOICE_EN, de: env.VOICE_TTS_VOICE_DE, ar: env.VOICE_TTS_VOICE_AR, ru: env.VOICE_TTS_VOICE_RU }[language];
  return configured || DEFAULT_VOICES[language];
}

/** Testler için (sağlayıcı ayarlarını değiştirdikten sonra). */
export function resetProvidersForTests(set?: ProviderSet): void {
  cached = set ?? null;
}

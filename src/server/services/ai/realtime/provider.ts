import "server-only";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "@/lib/ai/provider";
import type { AiLanguage } from "@/lib/voice/language-detection";
import type { SttProvider, TtsProvider } from "@/lib/voice/provider";
import { getServerEnv } from "@/lib/env";
import { getProviders, voiceFor } from "@/server/services/ai/config";

/**
 * Canlı ses sağlayıcı soyutlaması. Arayüz kavramları: connect / sendAudio + commitTurn (transcribe) / response (respond,
 * metin deltaları) / audio delta (speak, cümle başına) / interrupt / disconnect. Sağlayıcıya özgü olaylar burada kalır;
 * tarayıcıya yalnızca MasaNova akış olayları (src/lib/ai/realtime.ts) gider.
 *
 * Sprint 10 uygulaması: "cascade" — STT → AKAN metin (araç çağrıları sunucuda) → cümle başına güvenlik → cümle başına
 * TTS. Bu yol, sesten-sese modellerin aksine her cümle seslendirilmeden ÖNCE güvenlik korumasını uygular, dil kararını
 * deterministik tutar ve sağlayıcı anahtarı tarayıcıya hiç gitmez (geçici anahtar / tarayıcı-doğrudan bağlantı gerekmez).
 * OpenAI ya da mock bileşenlerinden kurulur; ileride sesten-sese bir sağlayıcı aynı arayüzü uygulayabilir.
 */
export interface RealtimeVoiceSession {
  readonly provider: string;
  readonly signal: AbortSignal;
  transcribe(input: { audio: Uint8Array; mimeType: string; languageHint: AiLanguage }): Promise<{ text: string; durationMs: number | null; confidence: number | null }>;
  respond(request: Omit<AiCompletionRequest, "signal">, onTextDelta: (delta: string) => void): Promise<AiCompletionResult>;
  speak(text: string, language: AiLanguage, signal?: AbortSignal): Promise<{ audio: Uint8Array; mimeType: string }>;
  /** Devam eden sağlayıcı isteklerini iptal et (araya girme). */
  interrupt(): void;
  disconnect(): void;
  /** Yalnızca mock: test kancaları (bağlantı kopması / sağlayıcı yok benzetimi). Gerçek sağlayıcıda null. */
  testHook(transcript: string): { drop: boolean; down: boolean } | null;
}

export interface RealtimeVoiceProvider {
  readonly name: string;
  connect(parent?: AbortSignal): RealtimeVoiceSession;
}

const STYLE = "Warm, professional, concise hospitality tone, like an attentive restaurant waiter. Natural pace. Not robotic, not overly enthusiastic.";

export function createCascadeRealtimeProvider(parts: { ai: AiProvider; stt: SttProvider; tts: TtsProvider | null; testHooks: boolean }): RealtimeVoiceProvider {
  return {
    name: `cascade:${parts.ai.name}`,
    connect(parent) {
      const controller = new AbortController();
      const onParentAbort = () => controller.abort();
      parent?.addEventListener("abort", onParentAbort, { once: true });
      const signal = controller.signal;
      return {
        provider: parts.ai.name,
        signal,
        async transcribe({ audio, mimeType, languageHint }) {
          const r = await parts.stt.transcribe({ audio, mimeType, languageHint, signal });
          return { text: r.text, durationMs: r.durationMs, confidence: r.confidence ?? null };
        },
        async respond(request, onTextDelta) {
          const req = { ...request, signal };
          if (parts.ai.stream) return parts.ai.stream(req, onTextDelta);
          const result = await parts.ai.complete(req);
          onTextDelta(result.text);
          return result;
        },
        async speak(text, language, extra) {
          if (!parts.tts) throw new Error("tts_unavailable");
          return parts.tts.synthesize({ text, language, voice: voiceFor(language), style: STYLE, signal: extra ? AbortSignal.any([signal, extra]) : signal });
        },
        interrupt() {
          controller.abort();
        },
        disconnect() {
          parent?.removeEventListener("abort", onParentAbort);
          controller.abort();
        },
        testHook(transcript) {
          if (!parts.testHooks) return null;
          return { drop: /#drop\b/i.test(transcript), down: /#down\b/i.test(transcript) };
        },
      };
    },
  };
}

/**
 * Etkin canlı sağlayıcı: AI + STT yapılandırılmışsa cascade; VOICE_REALTIME=off ise kapalı (istemci bas-konuşa düşer).
 * Test kancaları YALNIZCA mock sağlayıcıda etkindir.
 */
export function getRealtimeProvider(): RealtimeVoiceProvider | null {
  if (getServerEnv().VOICE_REALTIME === "off") return null;
  const { ai, stt, tts } = getProviders();
  if (!ai || !stt) return null;
  return createCascadeRealtimeProvider({ ai, stt, tts, testHooks: ai.name === "mock" && stt.name === "mock" });
}

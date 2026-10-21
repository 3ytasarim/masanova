import "server-only";
import { AI_LIMITS } from "@/lib/ai/limits";
import { isAcceptedAudioType, MAX_AUDIO_BYTES, MAX_UTTERANCE_MS } from "@/lib/voice/session";
import type { AiLanguage } from "@/lib/voice/language-detection";
import { getProviders, voiceFor } from "@/server/services/ai/config";
import { recordUsage } from "@/server/services/ai/usage.service";

/**
 * Konuşma → metin ve metin → konuşma sarmalayıcıları: sınırlar, süre ölçümü, kullanım kaydı.
 * HAM SES SAKLANMAZ: istek belleğindeki bayt dizisi STT'ye gönderilir ve atılır (diske / veritabanına / loga yazılmaz).
 */
export type SttOutcome = { ok: true; text: string; durationMs: number; confidence: number | null } | { ok: false; error: "audio_invalid" | "audio_too_long" | "stt_failed" };

export async function transcribe(input: { tenantId: string; conversationId: string; audio: Uint8Array; mimeType: string; clientDurationMs: number | null; languageHint: AiLanguage;
  /** Canlı yol: STT çağrısı gerçek-zamanlı oturum üzerinden (iptal sinyaliyle) yapılır; doğrulama + kullanım kaydı aynı kalır. */
  via?: (args: { audio: Uint8Array; mimeType: string; languageHint: AiLanguage }) => Promise<{ text: string; durationMs: number | null; confidence?: number | null }>;
}): Promise<SttOutcome> {
  const stt = getProviders().stt;
  if (!stt) return { ok: false, error: "stt_failed" };
  if (!isAcceptedAudioType(input.mimeType) || input.audio.byteLength < 10) return { ok: false, error: "audio_invalid" };
  if (input.audio.byteLength > MAX_AUDIO_BYTES || (input.clientDurationMs ?? 0) > MAX_UTTERANCE_MS + 1500) return { ok: false, error: "audio_too_long" };
  const started = Date.now();
  try {
    const args = { audio: input.audio, mimeType: input.mimeType, languageHint: input.languageHint };
    const result = input.via ? await input.via(args) : await stt.transcribe(args);
    const durationMs = result.durationMs ?? input.clientDurationMs ?? 0;
    if (durationMs > MAX_UTTERANCE_MS + 1500) return { ok: false, error: "audio_too_long" };
    await recordUsage({ tenantId: input.tenantId, conversationId: input.conversationId, kind: "STT", provider: stt.name, model: stt.model, sttMs: durationMs, latencyMs: Date.now() - started, success: !!result.text });
    return result.text ? { ok: true, text: result.text, durationMs, confidence: result.confidence ?? null } : { ok: false, error: "stt_failed" };
  } catch (error) {
    await recordUsage({ tenantId: input.tenantId, conversationId: input.conversationId, kind: "STT", provider: stt.name, model: stt.model, latencyMs: Date.now() - started, success: false, errorCode: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
    return { ok: false, error: "stt_failed" };
  }
}

const STYLE = "Warm, professional, concise hospitality tone, like an attentive restaurant waiter. Not robotic, not overly enthusiastic.";

export async function synthesize(input: { tenantId: string; conversationId: string; text: string; language: AiLanguage }): Promise<{ ok: true; audio: Uint8Array; mimeType: string } | { ok: false }> {
  const tts = getProviders().tts;
  if (!tts) return { ok: false };
  const started = Date.now();
  try {
    const result = await tts.synthesize({ text: input.text.slice(0, AI_LIMITS.maxTtsCharacters), language: input.language, voice: voiceFor(input.language), style: STYLE });
    await recordUsage({ tenantId: input.tenantId, conversationId: input.conversationId, kind: "TTS", provider: tts.name, model: tts.model, ttsCharacters: input.text.length, latencyMs: Date.now() - started });
    return { ok: true, ...result };
  } catch (error) {
    await recordUsage({ tenantId: input.tenantId, conversationId: input.conversationId, kind: "TTS", provider: tts.name, model: tts.model, latencyMs: Date.now() - started, success: false, errorCode: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
    return { ok: false };
  }
}

export function ttsAvailable(): boolean {
  return !!getProviders().tts;
}

export function sttAvailable(): boolean {
  return !!getProviders().stt;
}

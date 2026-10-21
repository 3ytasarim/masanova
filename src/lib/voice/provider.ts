import type { AiLanguage } from "@/lib/voice/language-detection";

/**
 * Ses sağlayıcı arayüzleri (STT / TTS). Sağlayıcıya özgü kod yalnızca src/server/services/ai/providers/* içinde.
 * Ham ses kalıcı SAKLANMAZ: istek belleğinde STT'ye gönderilir ve atılır.
 */
export interface SttProvider {
  readonly name: string;
  readonly model: string;
  transcribe(input: { audio: Uint8Array; mimeType: string; languageHint: AiLanguage | null; signal?: AbortSignal }): Promise<{ text: string; durationMs: number | null; /** 0–1; sağlayıcı vermiyorsa null. */ confidence?: number | null }>;
}

export interface TtsProvider {
  readonly name: string;
  readonly model: string;
  synthesize(input: { text: string; language: AiLanguage; voice: string; style: string; signal?: AbortSignal }): Promise<{ audio: Uint8Array; mimeType: string }>;
}

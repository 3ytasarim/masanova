import { AI_LIMITS } from "@/lib/ai/limits";
/**
 * Sesli asistan durum makinesi (saf; istemci bileşeni useReducer ile kullanır).
 *
 *   READY ──tap mic──▶ LISTENING ──stop / sessizlik──▶ THINKING ──yanıt──▶ SPEAKING ──bitti──▶ READY
 *                                                       └─ (ses kapalı / TTS yok) ─▶ READY
 *   SPEAKING ──tap mic (araya girme)──▶ LISTENING   ·   her durum ──hata──▶ ERROR ──tap / reset──▶ READY
 *   CLOSE: her durumdan READY (mikrofon ve oynatma durdurulur).
 * Sürekli açık mikrofon yok: her dokunuş tek bir ifade dinler.
 */
export type VoiceState = "READY" | "LISTENING" | "THINKING" | "SPEAKING" | "ERROR";

export type VoiceEvent =
  | { type: "START_LISTENING" }
  | { type: "STOP_LISTENING" }
  | { type: "SUBMIT_TEXT" }
  | { type: "RESPONSE"; willSpeak: boolean }
  | { type: "SPEECH_ENDED" }
  | { type: "INTERRUPT" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" }
  | { type: "CLOSE" };

export type VoiceMachine = { state: VoiceState; error: string | null };

export const INITIAL_VOICE: VoiceMachine = { state: "READY", error: null };

export function voiceReducer(m: VoiceMachine, e: VoiceEvent): VoiceMachine {
  switch (e.type) {
    case "START_LISTENING":
      return m.state === "THINKING" ? m : { state: "LISTENING", error: null };
    case "INTERRUPT":
      return m.state === "SPEAKING" ? { state: "LISTENING", error: null } : m;
    case "STOP_LISTENING":
      return m.state === "LISTENING" ? { state: "THINKING", error: null } : m;
    case "SUBMIT_TEXT":
      return m.state === "THINKING" ? m : { state: "THINKING", error: null };
    case "RESPONSE":
      return m.state === "THINKING" ? { state: e.willSpeak ? "SPEAKING" : "READY", error: null } : m;
    case "SPEECH_ENDED":
      return m.state === "SPEAKING" ? { state: "READY", error: null } : m;
    case "ERROR":
      return { state: "ERROR", error: e.message };
    case "RESET":
    case "CLOSE":
      return INITIAL_VOICE;
  }
}

/** Ses kaydı sınırları (istemci + sunucu). */
export const MAX_UTTERANCE_MS = AI_LIMITS.maxAudioSeconds * 1000;
export const MAX_AUDIO_BYTES = AI_LIMITS.maxAudioBytes;
export const ACCEPTED_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"] as const;

export function isAcceptedAudioType(mime: string): boolean {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return (ACCEPTED_AUDIO_TYPES as readonly string[]).includes(base);
}

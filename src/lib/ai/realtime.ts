import type { AiLanguage } from "@/lib/voice/language-detection";
import type { ActionCard, ProductCard, RecommendationBundle } from "@/lib/ai/types";

/**
 * Canlı sesli tur — MasaNova'nın kendi akış sözleşmesi (NDJSON, satır başına bir olay). Sağlayıcıya özgü olay biçimleri
 * (OpenAI vb.) bu sınırı GEÇMEZ; arayüz yalnızca bu tipleri bilir.
 *
 * Sıra: accepted → transcript → (language) → text.delta* / audio.chunk* → actions → done
 * Güvenlik: text.delta ve audio.chunk yalnızca güvenlik korumasından geçmiş TAM cümlelerdir; yapılandırılmış eylem
 * kartları (actions) yalnızca tur tamamlanıp sunucuda doğrulandıktan sonra, tek seferde gelir. Kesilen turun kartı gelmez.
 */
export type LiveTurnEvent =
  | { t: "accepted"; turn: string; attempt: number }
  | { t: "transcript"; text: string; confidence: number | null }
  | { t: "language"; language: AiLanguage; direction: "ltr" | "rtl"; acknowledged: boolean }
  | { t: "text"; seq: number; text: string }
  | { t: "audio"; seq: number; mime: string; data: string }
  | { t: "actions"; messageId: string; actions: ActionCard[]; products: ProductCard[]; recommendation: RecommendationBundle | null }
  | { t: "done"; messageId: string; text: string; language: AiLanguage; replayed: boolean; metrics: TurnMetrics }
  | { t: "error"; code: LiveErrorCode; retryable: boolean };

export type LiveErrorCode =
  | "context_invalid"
  | "feature_disabled"
  | "conversation_invalid"
  | "rate_limited"
  | "turn_limit"
  | "audio_invalid"
  | "audio_too_long"
  | "too_long"
  | "stt_failed"
  | "in_progress"
  | "provider_unavailable"
  | "shutting_down"
  | "ai_failed";

/** Sunucu tarafında ölçülen gecikmeler (QA için; SLA değildir). */
export type TurnMetrics = {
  /** İstek alındı → konuşma metni hazır. */
  sttMs: number | null;
  /** Metin hazır → ilk yanıt parçası. */
  firstTextMs: number | null;
  /** Metin hazır → ilk ses parçası. */
  firstAudioMs: number | null;
  /** İstek → tur bitti. */
  totalMs: number;
};

/** Tur kimliği: istemci üretir (opak, 16 bayt base64url); yeniden deneme / yeniden bağlanmada AYNI kimlik gider. */
export const TURN_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function parseLiveEvent(line: string): LiveTurnEvent | null {
  try {
    const v = JSON.parse(line) as { t?: unknown };
    return v && typeof v === "object" && typeof v.t === "string" ? (v as LiveTurnEvent) : null;
  } catch {
    return null;
  }
}

/** Akış gövdesinden satır satır olay okuyucu (yarım satırları tamponlar). */
export class NdjsonDecoder {
  private buffer = "";
  push(chunk: string): LiveTurnEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.map((l) => l.trim()).filter(Boolean).map(parseLiveEvent).filter((e): e is LiveTurnEvent => !!e);
  }
}

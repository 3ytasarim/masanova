import type { AiLanguage } from "@/lib/voice/language-detection";
import type { AiToolName } from "@/lib/ai/tools";

/**
 * AI akıl yürütme / araç orkestrasyonu sağlayıcı arayüzü. Sağlayıcı araç çağrısını İSTER; çalıştırma her zaman sunucunun
 * `executeTool` geri çağrısındadır (argüman doğrulama + kiracı kapsamı orada). Sağlayıcı hiçbir veriyi doğrudan yazamaz.
 */
export type AiChatMessage = { role: "user" | "assistant"; content: string };

export type AiToolDefinition = { name: AiToolName; description: string; parameters: Record<string, unknown> };

export type AiCompletionRequest = {
  system: string;
  history: AiChatMessage[];
  utterance: string;
  language: AiLanguage;
  tools: AiToolDefinition[];
  /** Sunucu tarafı araç yürütücüsü — sonucu JSON-uyumlu nesne döner (müşteri-güvenli DTO). */
  executeTool: (name: AiToolName, args: unknown) => Promise<unknown>;
  signal?: AbortSignal;
  /** Deterministik ipuçları (sunucu): ifade yalnızca önceki öneriye kısıt ekliyor ("Birimiz vegan"). */
  hints?: { constraintFollowUp?: boolean };
};

export type AiCompletionResult = { text: string; inputTokens: number; outputTokens: number; toolCalls: number };

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
  /**
   * İsteğe bağlı akış: aynı araç döngüsü, son yanıt metni parça parça `onTextDelta` ile gelir (Sprint 10 canlı ses).
   * Araç çağrıları akıtılmaz; yalnızca düz metin. Desteklemeyen sağlayıcıda canlı katman `complete` sonucunu böler.
   */
  stream?(request: AiCompletionRequest, onTextDelta: (delta: string) => void): Promise<AiCompletionResult>;
}

/** Araç döngüsü üst sınırı (sonsuz araç çağrısı / maliyet koruması). */
export const MAX_TOOL_ROUNDS = 4;

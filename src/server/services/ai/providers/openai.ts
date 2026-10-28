import "server-only";
import { AI_LIMITS } from "@/lib/ai/limits";
import { MAX_TOOL_ROUNDS, type AiCompletionRequest, type AiCompletionResult, type AiProvider } from "@/lib/ai/provider";
import { isAiToolName } from "@/lib/ai/tools";
import type { AiLanguage } from "@/lib/voice/language-detection";
import type { SttProvider, TtsProvider } from "@/lib/voice/provider";

/**
 * OpenAI adaptörü (REST, SDK yok — sunucu paketinde kalır, tarayıcıya hiçbir şey gitmez).
 *   AI : /v1/chat/completions (araç çağrısı döngüsü, en fazla MAX_TOOL_ROUNDS tur; isteğe bağlı SSE akışı)
 *   STT: /v1/audio/transcriptions (logprobs → güven puanı)   TTS: /v1/audio/speech (cümle başına)
 * Tüm çağrılar AbortSignal'ı izler: kesintide sağlayıcı isteği iptal edilir. Hata mesajları anahtar / gövde İÇERMEZ.
 */
const BASE = "https://api.openai.com/v1";

class ProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Tek sağlayıcı isteği. Zaman aşımı ve çağıranın iptal sinyali İSTEĞİN TAMAMINI kapsar (başlıklar + akan gövde):
 * birleşik sinyal gövde okunurken de etkindir — takılan akış ya da kesilen tur arkada yetim istek BIRAKMAZ.
 */
async function call(path: string, apiKey: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) }, signal: combined });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ProviderError(`http_${res.status}`);
    }
    return res;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(signal?.aborted ? "aborted" : timeout.aborted ? "timeout" : "network");
  }
}

export { ProviderError };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage = { role: "system" | "user"; content: string } | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] } | { role: "tool"; tool_call_id: string; content: string };

/** SSE gövdesinden "data:" satırları. */
async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) yield trimmed.slice(5).trim();
    }
  }
}

async function runChat(config: { apiKey: string; model: string }, request: AiCompletionRequest, onTextDelta?: (delta: string) => void): Promise<AiCompletionResult> {
  const messages: ChatMessage[] = [{ role: "system", content: request.system }, ...request.history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: request.utterance }];
  const tools = request.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const body = { model: config.model, messages, tools, tool_choice: round === MAX_TOOL_ROUNDS ? "none" : "auto", temperature: 0.3, max_tokens: AI_LIMITS.maxResponseTokens, ...(onTextDelta ? { stream: true, stream_options: { include_usage: true } } : {}) };
    const res = await call("/chat/completions", config.apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, AI_LIMITS.timeouts.chatMs, request.signal);
    let content = "";
    let calls: ToolCall[] = [];
    if (onTextDelta) {
      const partial = new Map<number, ToolCall>();
      for await (const data of sseData(res)) {
        if (data === "[DONE]") break;
        const chunk = JSON.parse(data) as {
          choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        };
        if (chunk.usage) {
          inputTokens += chunk.usage.prompt_tokens ?? 0;
          outputTokens += chunk.usage.completion_tokens ?? 0;
        }
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          // Araç çağrısı başlamadıysa düz metin akıtılır (araç argümanları asla akıtılmaz).
          if (!partial.size) onTextDelta(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const cur = partial.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, type: "function", function: { name: "", arguments: "" } };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.function.name += tc.function.name;
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
          partial.set(tc.index, cur);
        }
      }
      calls = [...partial.values()];
    } else {
      const json = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      inputTokens += json.usage?.prompt_tokens ?? 0;
      outputTokens += json.usage?.completion_tokens ?? 0;
      const message = json.choices?.[0]?.message;
      if (!message) throw new ProviderError("empty");
      content = message.content ?? "";
      calls = message.tool_calls ?? [];
    }
    if (!calls.length) return { text: content.trim(), inputTokens, outputTokens, toolCalls };
    messages.push({ role: "assistant", content: content || null, tool_calls: calls });
    for (const c of calls) {
      toolCalls += 1;
      let args: unknown = {};
      try {
        args = JSON.parse(c.function.arguments || "{}");
      } catch {
        args = null;
      }
      // Bilinmeyen araç adı çalıştırılmaz (sipariş gönderme aracı zaten tanımlı değil).
      const result = isAiToolName(c.function.name) ? await request.executeTool(c.function.name, args) : { ok: false, error: "unknown_tool" };
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  throw new ProviderError("tool_loop");
}

/**
 * Tek seferlik JSON yanıtı (araç yok, akış yok) — menü çevirisi gibi toplu işler. Sohbet yanıt sınırı (kısa sesli yanıt)
 * burada geçerli değil; çağıran maxTokens verir. Yanıt JSON değilse ProviderError("bad_json").
 */
export async function openAiJson(
  config: { apiKey: string; model: string },
  req: { system: string; user: string; maxTokens: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<{ data: unknown; inputTokens: number; outputTokens: number }> {
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    temperature: 0.2,
    max_tokens: req.maxTokens,
    response_format: { type: "json_object" },
  };
  const res = await call("/chat/completions", config.apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, req.timeoutMs ?? 60_000, req.signal);
  const json = (await res.json()) as { choices?: { message?: { content?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  try {
    return { data: JSON.parse(json.choices?.[0]?.message?.content ?? ""), inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 };
  } catch {
    throw new ProviderError("bad_json");
  }
}

export function createOpenAiProvider(config: { apiKey: string; model: string }): AiProvider {
  return {
    name: "openai",
    model: config.model,
    complete: (request) => runChat(config, request),
    stream: (request, onTextDelta) => runChat(config, request, onTextDelta),
  };
}

export function createOpenAiStt(config: { apiKey: string; model: string }): SttProvider {
  return {
    name: "openai",
    model: config.model,
    async transcribe({ audio, mimeType, languageHint, signal }) {
      const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : mimeType.includes("wav") ? "wav" : "webm";
      const form = new FormData();
      form.append("file", new Blob([audio as BlobPart], { type: mimeType.split(";")[0] }), `utterance.${ext}`);
      form.append("model", config.model);
      form.append("response_format", "json");
      // Güven puanı için token olasılıkları (gpt-4o(-mini)-transcribe destekler).
      form.append("include[]", "logprobs");
      // Dil ipucu verilmez: müşteri dil değiştirebilir; algılama metin üzerinde deterministik yapılır.
      void languageHint;
      const res = await call("/audio/transcriptions", config.apiKey, { method: "POST", body: form }, AI_LIMITS.timeouts.sttMs, signal);
      const json = (await res.json()) as { text?: string; duration?: number; logprobs?: { logprob?: number }[] };
      return { text: (json.text ?? "").trim(), durationMs: typeof json.duration === "number" ? Math.round(json.duration * 1000) : null, confidence: confidenceFromLogprobs(json.logprobs) };
    },
  };
}

/** Ortalama token log-olasılığından 0–1 güven (yoksa null). */
export function confidenceFromLogprobs(logprobs: { logprob?: number }[] | undefined): number | null {
  const values = (logprobs ?? []).map((l) => l.logprob).filter((v): v is number => typeof v === "number");
  if (!values.length) return null;
  return Math.exp(values.reduce((a, b) => a + b, 0) / values.length);
}

const LANGUAGE_NAMES: Record<AiLanguage, string> = { tr: "Turkish", en: "English", de: "German", ar: "Arabic", ru: "Russian" };

export function createOpenAiTts(config: { apiKey: string; model: string }): TtsProvider {
  return {
    name: "openai",
    model: config.model,
    async synthesize({ text, language, voice, style, signal }) {
      const res = await call(
        "/audio/speech",
        config.apiKey,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: config.model, voice, input: text, response_format: "mp3", instructions: `Speak natural, native ${LANGUAGE_NAMES[language]}. ${style}` }) },
        AI_LIMITS.timeouts.ttsMs,
        signal,
      );
      return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg" };
    },
  };
}

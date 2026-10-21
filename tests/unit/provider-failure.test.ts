import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeView } from "../support/fake-menu";

// Zaman aşımı testi gerçek zamanla çalışsın diye kısa sınırlar (AbortSignal.timeout sahte zamanlayıcıyla sürülemez).
vi.mock("@/lib/ai/limits", async (importOriginal) => {
  const actual = await importOriginal<{ AI_LIMITS: { timeouts: object } }>();
  return { AI_LIMITS: { ...actual.AI_LIMITS, timeouts: { ...actual.AI_LIMITS.timeouts, chatMs: 300, sttMs: 300, ttsMs: 300 } } };
});
vi.mock("@/lib/db/prisma", () => ({ prisma: { tableServiceRequest: { findFirst: vi.fn(async () => null) }, order: { findMany: vi.fn(async () => []) } } }));

const { createOpenAiProvider, createOpenAiStt, createOpenAiTts, ProviderError } = await import("@/server/services/ai/providers/openai");
const { AI_LIMITS } = await import("@/lib/ai/limits");

/**
 * Sprint 11 — gerçek sağlayıcı HATA yolu (ücretli istek yok): ağ hatası, HTTP hatası (ör. geçersiz model → 404), zaman
 * aşımı ve iptal. Zaman aşımı / iptal yukarı akış isteğinin sinyalini GERÇEKTEN iptal eder (yetim istek yok) — akan
 * gövde okunurken de.
 */
const req = { system: "s", history: [], utterance: "Merhaba", language: "tr" as const, tools: [], executeTool: async () => ({ ok: true }) as never };
const key = "test-key-not-real"; // secret-scan:allow

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI sağlayıcı hata yolu (taklit ağ)", () => {
  it("ağ hatası → ProviderError(network); HTTP 404 (geçersiz model) → ProviderError(http_404); anahtar hata mesajında yok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    const ai = createOpenAiProvider({ apiKey: key, model: "gpt-x" });
    await expect(ai.complete(req)).rejects.toMatchObject({ message: "network" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "The model does not exist" } }), { status: 404 })));
    const bad = createOpenAiProvider({ apiKey: key, model: "no-such-model" });
    const error = await bad.complete(req).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe("http_404");
    expect(String(error)).not.toContain(key);
  });

  it("zaman aşımı: yanıt gelmezse yukarı akış isteği İPTAL edilir (AI_LIMITS.timeouts.chatMs)", async () => {
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        upstreamSignal = init.signal ?? undefined;
        return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }),
    );
    const ai = createOpenAiProvider({ apiKey: key, model: "gpt-x" });
    const started = Date.now();
    const error = await ai.complete(req).catch((e: unknown) => e);
    expect(Date.now() - started).toBeGreaterThanOrEqual(AI_LIMITS.timeouts.chatMs - 20);
    expect((error as Error).message).toBe("timeout");
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("akan gövde takılırsa çağıranın iptali gövde okumasını da keser (canlı tur zaman aşımı / araya girme)", async () => {
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        upstreamSignal = init.signal ?? undefined;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Merhaba "}}]}\n\n'));
            init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }),
    );
    const controller = new AbortController();
    const ai = createOpenAiProvider({ apiKey: key, model: "gpt-x" });
    const deltas: string[] = [];
    const pending = ai.stream!({ ...req, signal: controller.signal }, (d) => {
      deltas.push(d);
      controller.abort();
    }).catch((e: unknown) => e);
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(deltas).toEqual(["Merhaba "]);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("STT / TTS hata yolu da ProviderError (menü / sepet akışını etkilemez — yalnızca AI kullanılamaz)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(createOpenAiStt({ apiKey: key, model: "m" }).transcribe({ audio: new Uint8Array(100), mimeType: "audio/wav", languageHint: "tr" })).rejects.toMatchObject({ message: "http_500" });
    await expect(createOpenAiTts({ apiKey: key, model: "m" }).synthesize({ text: "Merhaba", language: "tr", voice: "alloy", style: "" })).rejects.toMatchObject({ message: "http_500" });
    void fakeView;
  });
});

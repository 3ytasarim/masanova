import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fakeView } from "../support/fake-menu";

/**
 * GERÇEK OpenAI sağlayıcı duman testi — yalnızca AI_SMOKE=1 ve anahtar varsa çalışır (aksi halde atlanır).
 * Maliyet sınırlı: 5 kısa TTS + 5 STT + 1 sohbet turu. Üretilen sesler tmp/ai-smoke/ altına yazılır (elle dinlemek için;
 * depoya girmez). Anahtar hiçbir çıktıya yazılmaz.
 */
const enabled = process.env.AI_SMOKE === "1" && !!(process.env.AI_API_KEY || process.env.VOICE_TTS_API_KEY);
const PHRASES = {
  tr: "Merhaba, mercimek çorbasının içinde ne var?",
  en: "Hello, can you recommend something with chicken?",
  de: "Hallo, wir sind zwei Personen und möchten unter tausend Lira bleiben.",
  ar: "مرحبا، هل يمكنك أن تقترح طبقا خفيفا؟",
  ru: "Здравствуйте, позовите, пожалуйста, официанта.",
} as const;

describe.skipIf(!enabled)("gerçek sağlayıcı duman testi (OpenAI)", () => {
  it("TTS → STT gidiş-dönüş 5 dilde; sohbet araç çağrısı", async () => {
    const { createOpenAiProvider, createOpenAiStt, createOpenAiTts } = await import("@/server/services/ai/providers/openai");
    const { detectLanguage } = await import("@/lib/voice/language-detection");
    const { createToolExecutor } = await import("@/server/services/ai/tools.service");
    const { toolDefinitions } = await import("@/lib/ai/tools");
    const { buildSystemPrompt } = await import("@/lib/ai/prompts");
    const key = process.env.AI_API_KEY || process.env.VOICE_TTS_API_KEY || "";
    const tts = createOpenAiTts({ apiKey: process.env.VOICE_TTS_API_KEY || key, model: process.env.VOICE_TTS_MODEL || "gpt-4o-mini-tts" });
    const stt = createOpenAiStt({ apiKey: process.env.VOICE_STT_API_KEY || key, model: process.env.VOICE_STT_MODEL || "gpt-4o-mini-transcribe" });
    const out = path.resolve(import.meta.dirname, "../../tmp/ai-smoke");
    mkdirSync(out, { recursive: true });
    const voices = { tr: "coral", en: "alloy", de: "sage", ar: "shimmer", ru: "nova" } as const;
    for (const [lang, text] of Object.entries(PHRASES) as [keyof typeof PHRASES, string][]) {
      const audio = await tts.synthesize({ text, language: lang, voice: voices[lang], style: "Warm, concise hospitality tone." });
      writeFileSync(path.join(out, `${lang}.mp3`), audio.audio);
      const heard = await stt.transcribe({ audio: audio.audio, mimeType: "audio/mpeg", languageHint: null });
      const detected = detectLanguage(heard.text, lang === "tr" ? "en" : "tr");
      console.info(`[smoke] ${lang}: "${heard.text}" → ${detected.language}`);
      expect(heard.text.length).toBeGreaterThan(5);
      expect(detected.language).toBe(lang);
    }
    if (process.env.AI_API_KEY) {
      const ai = createOpenAiProvider({ apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL || "gpt-4.1-mini" });
      const exec = createToolExecutor({
        order: { tenantId: "smoke", branchId: "smoke", tableId: "smoke", tokenId: "smoke", branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" },
        view: fakeView(),
        numberLocale: "tr-TR",
        settings: { allowRecommendations: true, allowCartActions: true, allowServiceActions: false },
        cart: [],
        recentOrders: [],
      });
      const res = await ai.complete({
        system: buildSystemPrompt({ restaurantName: "Smoke", branchName: null, tableName: "Masa 1", assistantName: "Asistan", tone: "WARM", customInstructions: null, language: "tr", currency: "TRY", menuDigest: "Çorbalar, Ana Yemekler, Burgerler, Tatlılar, İçecekler" }),
        history: [],
        utterance: "Mercimek çorbasında ne var? Kısaca söyle.",
        language: "tr",
        tools: toolDefinitions(["searchMenu", "getProductDetails"]),
        executeTool: (n, a) => exec.execute(n, a),
      });
      console.info(`[smoke] chat: ${res.text} (tools: ${res.toolCalls}, tokens: ${res.inputTokens}/${res.outputTokens})`);
      expect(res.toolCalls).toBeGreaterThan(0);
      expect(res.text.toLocaleLowerCase("tr-TR")).toContain("mercimek");
    }
  });
});

describe.skipIf(!enabled || !process.env.AI_API_KEY)("gerçek sağlayıcı duman testi — canlı (cascade) akış", () => {
  it("akan metin + cümle başına ses; araya girme isteği iptal eder; STT güven puanı", async () => {
    const { createOpenAiProvider, createOpenAiStt, createOpenAiTts } = await import("@/server/services/ai/providers/openai");
    const { createCascadeRealtimeProvider } = await import("@/server/services/ai/realtime/provider");
    const { SentenceBuffer } = await import("@/lib/ai/stream-text");
    const key = process.env.AI_API_KEY!;
    const ai = createOpenAiProvider({ apiKey: key, model: process.env.AI_MODEL || "gpt-4.1-mini" });
    const stt = createOpenAiStt({ apiKey: process.env.VOICE_STT_API_KEY || key, model: process.env.VOICE_STT_MODEL || "gpt-4o-mini-transcribe" });
    const tts = createOpenAiTts({ apiKey: process.env.VOICE_TTS_API_KEY || key, model: process.env.VOICE_TTS_MODEL || "gpt-4o-mini-tts" });
    const provider = createCascadeRealtimeProvider({ ai, stt, tts, testHooks: false });
    const session = provider.connect();
    const started = Date.now();
    let firstDelta: number | null = null;
    const buffer = new SentenceBuffer();
    const sentences: string[] = [];
    const res = await session.respond(
      { system: "Sen bir restoran asistanısın. Kısa ve sıcak konuş; en fazla iki cümle.", history: [], utterance: "Merhaba, bugün hafif bir şey yemek istiyorum.", language: "tr", tools: [], executeTool: async () => ({ ok: true }) as never },
      (d) => {
        firstDelta ??= Date.now() - started;
        sentences.push(...buffer.push(d));
      },
    );
    const tail = buffer.flush();
    if (tail) sentences.push(tail);
    const t0 = Date.now();
    const audio = await session.speak(sentences[0]!, "tr");
    console.info(`[smoke-live] ilk metin ${firstDelta} ms, ilk cümle sesi ${Date.now() - t0} ms, cümle=${sentences.length}`);
    expect(res.text.length).toBeGreaterThan(5);
    expect(audio.audio.byteLength).toBeGreaterThan(1000);
    const heard = await session.transcribe({ audio: audio.audio, mimeType: audio.mimeType, languageHint: "tr" });
    console.info(`[smoke-live] STT güven: ${heard.confidence}`);
    expect(heard.text.length).toBeGreaterThan(3);
    // Araya girme: devam eden istek iptal edilir
    const s2 = provider.connect();
    const pending = s2.respond({ system: "Uzun anlat.", history: [], utterance: "Bize menüyü ayrıntılı anlat.", language: "tr", tools: [], executeTool: async () => ({ ok: true }) as never }, () => s2.interrupt());
    await expect(pending).rejects.toThrow();
    session.disconnect();
  });
});

describe.skipIf(!enabled || !process.env.AI_API_KEY)("gerçek sağlayıcı duman testi — güvenli eylem kartı ve hata yolu", () => {
  it("'İki ayran ekle' → yalnızca onay KARTI (değişiklik yok); geçersiz model → kontrollü hata", async () => {
    const { createOpenAiProvider } = await import("@/server/services/ai/providers/openai");
    const { createToolExecutor } = await import("@/server/services/ai/tools.service");
    const { toolDefinitions } = await import("@/lib/ai/tools");
    const { buildSystemPrompt } = await import("@/lib/ai/prompts");
    const key = process.env.AI_API_KEY!;
    const ai = createOpenAiProvider({ apiKey: key, model: process.env.AI_MODEL || "gpt-4.1-mini" });
    const exec = createToolExecutor({
      order: { tenantId: "smoke", branchId: "smoke", tableId: "smoke", tokenId: "smoke", branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" },
      view: fakeView(),
      numberLocale: "tr-TR",
      settings: { allowRecommendations: true, allowCartActions: true, allowServiceActions: false },
      cart: [],
      recentOrders: [],
    });
    const started = Date.now();
    const res = await ai.complete({
      system: buildSystemPrompt({ restaurantName: "Smoke", branchName: null, tableName: "Masa 1", assistantName: "Asistan", tone: "WARM", customInstructions: null, language: "tr", currency: "TRY", menuDigest: "Çorbalar, Ana Yemekler, Burgerler, Tatlılar, İçecekler" }),
      history: [],
      utterance: "Bir mercimek çorbası ekle.",
      language: "tr",
      tools: toolDefinitions(["searchMenu", "getProductDetails", "prepareCartAddition"]),
      executeTool: (n, a) => exec.execute(n, a),
    });
    console.info(`[smoke-card] ${Date.now() - started} ms, kartlar: ${exec.collector.actions.map((a) => a.kind).join(",") || "yok"}`);
    expect(res.toolCalls).toBeGreaterThan(0);
    expect(exec.collector.actions.every((a) => ["cart_add", "configure", "open_cart"].includes(a.kind))).toBe(true);
    const broken = createOpenAiProvider({ apiKey: key, model: "masanova-no-such-model" });
    await expect(broken.complete({ system: "x", history: [], utterance: "x", language: "tr", tools: [], executeTool: async () => ({ ok: true }) as never })).rejects.toThrow(/http_4\d\d/);
  });
});

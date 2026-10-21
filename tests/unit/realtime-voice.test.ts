import { describe, expect, it, vi } from "vitest";
import { fakeView } from "../support/fake-menu";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/server/services/ai/config", async (importOriginal) => ({ ...(await importOriginal<object>()), voiceFor: () => "test-voice" }));

const { liveReducer, INITIAL_LIVE, MIC_ACTIVE, liveStatusKey } = await import("@/lib/voice/live-session");
const { VoiceActivityDetector, rmsOf } = await import("@/lib/voice/vad");
const { VAD_CONFIG, SESSION_LIMITS, TRANSCRIPT_CONFIDENCE_MIN } = await import("@/lib/voice/config");
const { UtteranceCollector } = await import("@/lib/voice/pcm-capture");
const { AudioPlaybackQueue } = await import("@/lib/voice/audio-queue");
const { encodeWav, resample, toBase64 } = await import("@/lib/voice/wav");
const { newTurnKey, streamLiveTurn } = await import("@/lib/voice/live-client");
const { SentenceBuffer, splitSentences } = await import("@/lib/ai/stream-text");
const { updateContext, EMPTY_CONTEXT, parseContext, contextSummary } = await import("@/lib/ai/conversation-context");
const { decideLanguage } = await import("@/lib/ai/language");
const { NdjsonDecoder, TURN_KEY_PATTERN, parseLiveEvent } = await import("@/lib/ai/realtime");
const { summarizeVoice, formatRate } = await import("@/lib/ai/usage");
const { flattenMenu } = await import("@/lib/ai/menu-match");
const { recommend } = await import("@/lib/ai/recommendation");
const { liveStrings } = await import("@/lib/ai/i18n");
const { createRuleBasedProvider, createMockStt, createMockTts } = await import("@/server/services/ai/providers/mock");
const { createCascadeRealtimeProvider } = await import("@/server/services/ai/realtime/provider");
const { confidenceFromLogprobs } = await import("@/server/services/ai/providers/openai");

/** Sprint 10 — canlı ses: durum makinesi, VAD, araya girme, ses kuyruğu, akış, dil kararlılığı, bağlam, ölçüm. */

describe("canlı durum makinesi", () => {
  type Ev = Parameters<typeof liveReducer>[1];
  const run = (...events: Ev[]) => events.reduce(liveReducer, INITIAL_LIVE);

  it("tam döngü: başlat → dinle → konuş → düşün → yanıtla → dinle", () => {
    let m = run({ type: "START" });
    expect(m.state).toBe("CONNECTING");
    m = liveReducer(m, { type: "CONNECTED" });
    expect(m.state).toBe("LISTENING");
    m = liveReducer(m, { type: "SPEECH_START" });
    expect(m.state).toBe("USER_SPEAKING");
    m = liveReducer(m, { type: "SPEECH_END" });
    expect(m.state).toBe("THINKING");
    m = liveReducer(m, { type: "AUDIO_STARTED" });
    expect(m.state).toBe("ASSISTANT_SPEAKING");
    m = liveReducer(m, { type: "TURN_DONE", speaking: true });
    expect(m.state).toBe("ASSISTANT_SPEAKING"); // ses sürerken tur bitişi durumu değiştirmez
    m = liveReducer(m, { type: "AUDIO_DONE" });
    expect(m.state).toBe("LISTENING");
  });

  it("araya girme: konuşurken ve düşünürken; sayaç artar", () => {
    const speaking = run({ type: "START" }, { type: "CONNECTED" }, { type: "SPEECH_START" }, { type: "SPEECH_END" }, { type: "AUDIO_STARTED" });
    const m = liveReducer(speaking, { type: "BARGE_IN" });
    expect(m.state).toBe("INTERRUPTING");
    expect(m.interruptions).toBe(1);
    const after = liveReducer(liveReducer(m, { type: "INTERRUPTED" }), { type: "SPEECH_START" });
    expect(after.state).toBe("USER_SPEAKING");
    const thinking = run({ type: "START" }, { type: "CONNECTED" }, { type: "SPEECH_START" }, { type: "SPEECH_END" }, { type: "BARGE_IN" });
    expect(thinking.state).toBe("INTERRUPTING");
    // Dinlerken araya girme anlamsız → değişmez
    expect(run({ type: "START" }, { type: "CONNECTED" }, { type: "BARGE_IN" }).state).toBe("LISTENING");
  });

  it("yeniden bağlanma ve yedek", () => {
    const thinking = run({ type: "START" }, { type: "CONNECTED" }, { type: "TEXT_SUBMITTED" });
    const lost = liveReducer(thinking, { type: "STREAM_LOST" });
    expect(lost.state).toBe("RECONNECTING");
    expect(lost.reconnects).toBe(1);
    expect(liveReducer(lost, { type: "RETRYING" }).state).toBe("THINKING");
    expect(liveReducer(lost, { type: "TURN_DONE", speaking: false }).state).toBe("LISTENING");
    const fb = liveReducer(thinking, { type: "FALLBACK", message: "x" });
    expect(fb.state).toBe("FALLBACK");
    expect(fb.message).toBe("x");
    expect(liveReducer(run({ type: "START" }), { type: "CONNECT_FAILED", fallback: false, message: "mic" }).state).toBe("ERROR");
  });

  it("mikrofon yalnızca etkin durumlarda; bitir her durumdan ENDED; yeniden başlatılabilir", () => {
    for (const s of ["IDLE", "ENDED", "FALLBACK", "ERROR", "CONNECTING", "READY"] as const) expect(MIC_ACTIVE.includes(s)).toBe(false);
    const ended = run({ type: "START" }, { type: "CONNECTED" }, { type: "END" });
    expect(ended.state).toBe("ENDED");
    expect(liveReducer(ended, { type: "START" }).state).toBe("CONNECTING");
    expect(liveReducer(run({ type: "START" }, { type: "CONNECTED" }), { type: "PAUSE" }).state).toBe("READY");
    expect(liveStatusKey("THINKING")).toBe("understanding");
    expect(liveStatusKey("ASSISTANT_SPEAKING")).toBe("speaking");
  });
});

describe("VAD / tur algılama", () => {
  const frames = (vad: InstanceType<typeof VoiceActivityDetector>, rms: number, ms: number) => {
    const events: string[] = [];
    for (let t = 0; t < ms; t += VAD_CONFIG.frameMs) {
      const e = vad.push(rms);
      if (e) events.push(e);
    }
    return events;
  };

  it("konuşma başlangıcı en az minSpeechMs; tek karelik tıkırtı sayılmaz", () => {
    const vad = new VoiceActivityDetector();
    expect(vad.push(0.3)).toBeNull(); // tabak sesi
    expect(frames(vad, 0.002, 200)).toEqual([]);
    expect(frames(vad, 0.1, VAD_CONFIG.minSpeechMs)).toEqual(["speech_start"]);
    expect(frames(vad, 0.1, 400)).toEqual([]);
    expect(frames(vad, 0.002, VAD_CONFIG.silenceMs)).toEqual(["speech_end"]);
  });

  it("gürültü tabanı uyarlanır: sürekli uğultu eşiği yükseltir, uğultu konuşma sayılmaz", () => {
    const vad = new VoiceActivityDetector();
    const before = vad.threshold();
    frames(vad, 0.011, 3000); // restoran uğultusu (başta eşiğin hemen altında)
    expect(vad.threshold()).toBeGreaterThan(before);
    expect(frames(vad, 0.02, 2000)).toEqual([]); // uğultunun biraz üstü: hâlâ konuşma değil
    expect(frames(vad, 0.15, 400)).toContain("speech_start");
  });

  it("araya girme modu daha yüksek eşik + daha uzun süre ister (yankı yanlış kesmesin)", () => {
    const vad = new VoiceActivityDetector(VAD_CONFIG, 0.006);
    vad.mode = "barge-in";
    expect(vad.threshold()).toBeGreaterThan(new VoiceActivityDetector(VAD_CONFIG, 0.006).threshold());
    expect(frames(vad, 0.025, VAD_CONFIG.minSpeechMs + 20)).toEqual([]); // hoparlör sızıntısı
    vad.reset();
    expect(frames(vad, 0.2, VAD_CONFIG.bargeInMs)).toEqual(["speech_start"]);
  });

  it("tek ifade üst sınırı", () => {
    const vad = new VoiceActivityDetector();
    // sınırda ifade kapanır; ses sürerse yeni ifade başlar (kayıp yok)
    expect(frames(vad, 0.2, VAD_CONFIG.maxUtteranceMs + 400).slice(0, 2)).toEqual(["speech_start", "max_reached"]);
  });

  it("ön tampon: konuşma başlamadan önceki ~300 ms kayda girer; sonra sıfırlanır", () => {
    const c = new UtteranceCollector(60);
    const f = (v: number) => new Float32Array(4).fill(v);
    for (let i = 1; i <= 5; i++) c.push(f(i), 20);
    c.start();
    c.push(f(9), 20);
    const out = c.finish();
    expect([...out].filter((_, i) => i % 4 === 0)).toEqual([3, 4, 5, 9]);
    expect(c.active).toBe(false);
    expect(rmsOf(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it("WAV 16 kHz, base64", () => {
    const pcm = resample(new Float32Array(4800).fill(0.1), 48000, 16000);
    expect(pcm.length).toBe(1600);
    const wav = encodeWav(pcm, 16000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(wav.byteLength).toBe(44 + 3200);
    expect(Buffer.from(toBase64(wav), "base64").equals(Buffer.from(wav))).toBe(true);
  });
});

describe("ses kuyruğu ve nesil sayacı", () => {
  function fakeCtx() {
    const started: { id: number; when: number }[] = [];
    const sources: { id: number; stopped: boolean; end: () => void }[] = [];
    let id = 0;
    const ctx = {
      currentTime: 0,
      destination: {},
      async decodeAudioData(data: ArrayBuffer) {
        return { duration: data.byteLength / 10 };
      },
      createBufferSource() {
        const me = { id: ++id, stopped: false, end: () => undefined as void };
        const src = {
          buffer: null as unknown,
          onended: null as (() => void) | null,
          connect: () => undefined,
          start: (when?: number) => started.push({ id: me.id, when: when ?? 0 }),
          stop: () => {
            me.stopped = true;
          },
        };
        me.end = () => src.onended?.();
        sources.push(me);
        return src;
      },
    };
    return { ctx, started, sources };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("parçalar sırayla ve boşluksuz çalınır; akış bitince onIdle", async () => {
    const { ctx, started, sources } = fakeCtx();
    const onStart = vi.fn();
    const onIdle = vi.fn();
    const q = new AudioPlaybackQueue(ctx, { onStart, onIdle });
    const gen = q.begin();
    q.enqueue(new ArrayBuffer(20), gen); // 2 sn
    q.enqueue(new ArrayBuffer(10), gen); // 1 sn
    q.end(gen);
    await flush();
    expect(started).toEqual([
      { id: 1, when: 0 },
      { id: 2, when: 2 },
    ]);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onIdle).not.toHaveBeenCalled();
    sources[0]!.end();
    sources[1]!.end();
    expect(onIdle).toHaveBeenCalledWith(3000);
  });

  it("araya girme: anında durur, eski neslin geç gelen parçası ÇALMAZ, çalınan süre döner", async () => {
    const { ctx, started, sources } = fakeCtx();
    const onIdle = vi.fn();
    const q = new AudioPlaybackQueue(ctx, { onIdle });
    const gen = q.begin();
    q.enqueue(new ArrayBuffer(30), gen);
    await flush();
    ctx.currentTime = 1.2;
    const played = q.cancel();
    expect(played).toBe(1200);
    expect(sources[0]!.stopped).toBe(true);
    q.enqueue(new ArrayBuffer(10), gen); // eski nesil
    q.end(gen);
    await flush();
    expect(started).toHaveLength(1);
    expect(onIdle).not.toHaveBeenCalled();
    expect(q.busy).toBe(false);
    // yeni nesil çalışır
    const next = q.begin();
    q.enqueue(new ArrayBuffer(10), next);
    await flush();
    expect(started).toHaveLength(2);
  });
});

describe("akan metin", () => {
  it("cümle sınırında verir, kısa parçayı ve kısaltmayı birleştirir, sayıyı bölmez", () => {
    const b = new SentenceBuffer();
    expect(b.push("Merhaba! Size ")).toEqual([]);
    expect(b.push("iki seçenek önerebilirim. Izgara köfte ₺380,")).toEqual(["Merhaba! Size iki seçenek önerebilirim."]);
    expect(b.push("00 tutuyor, örn. salata vb. de var. ")).toEqual(["Izgara köfte ₺380,00 tutuyor, örn. salata vb. de var."]);
    expect(b.flush()).toBeNull();
    expect(splitSentences("Tamam. Sepete eklemek için karttaki düğmeye dokunun. Başka bir şey?")).toEqual(["Tamam. Sepete eklemek için karttaki düğmeye dokunun.", "Başka bir şey?"]);
  });

  it("NDJSON: yarım satır tamponlanır, bozuk satır atılır; tur anahtarı biçimi", () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"t":"text","seq":0,"text":"A')).toEqual([]);
    expect(d.push('b."}\nnot json\n{"t":"done"')).toEqual([{ t: "text", seq: 0, text: "Ab." }]);
    expect(d.push("}\n")).toHaveLength(1);
    expect(parseLiveEvent("[]")).toBeNull();
    const key = newTurnKey();
    expect(TURN_KEY_PATTERN.test(key)).toBe(true);
    expect(newTurnKey()).not.toBe(key);
  });
});

describe("canlı istemci akışı (yeniden bağlanma kararı)", () => {
  const body = (lines: string[], cut = false) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(new TextEncoder().encode(`${l}\n`));
        if (cut) c.error(new Error("net"));
        else c.close();
      },
    });
  const call = async (res: Response | Error, signal = new AbortController().signal) => {
    const events: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => (res instanceof Error ? Promise.reject(res) : res)));
    const outcome = await streamLiveTurn({ url: "/x", proof: "p", body: {}, signal, onEvent: (e) => events.push(e) });
    vi.unstubAllGlobals();
    return { outcome, events };
  };

  it("done → tamam; done gelmeden kopma → lost (aynı anahtarla yeniden); sunucu hatası → error", async () => {
    expect((await call(new Response(body(['{"t":"accepted","turn":"k","attempt":1}', '{"t":"done","messageId":"m"}'])))).outcome).toEqual({ kind: "done" });
    expect((await call(new Response(body(['{"t":"text","seq":0,"text":"x"}'], true)))).outcome).toEqual({ kind: "lost" });
    expect((await call(new Response(body(['{"t":"text","seq":0,"text":"x"}'])))).outcome).toEqual({ kind: "lost" });
    expect((await call(new Error("offline"))).outcome).toEqual({ kind: "lost" });
    expect((await call(new Response(body(['{"t":"error","code":"in_progress","retryable":true}'])))).outcome).toEqual({ kind: "error", code: "in_progress", retryable: true });
    expect((await call(new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }))).outcome).toEqual({ kind: "error", code: "rate_limited", retryable: true });
    // Vekil arkasında arka uç yeniden başlıyor (Nginx 502/503/504) → geçici: aynı turla yeniden bağlan (Sprint 11)
    for (const status of [502, 503, 504]) expect((await call(new Response("bad gateway", { status }))).outcome).toEqual({ kind: "lost" });
    const aborted = new AbortController();
    aborted.abort();
    expect((await call(new Error("abort"), aborted.signal)).outcome).toEqual({ kind: "aborted" });
  });
});

describe("dil kararlılığı (karışık dil)", () => {
  it.each(["Bir chicken burger önerir misin?", "Bana bir cheeseburger ve cola ver", "Vegan bir şey var mı?", "OK, teşekkürler"])("'%s' Türkçe kalır", (text) => {
    const d = decideLanguage(text, "tr");
    expect(d.language).toBe("tr");
    expect(d.switched).toBe(false);
  });
  it("açık geçiş bir kez onaylanır; sonraki ifade aynı dilde kalır", () => {
    const first = decideLanguage("Can we continue in English?", "tr");
    expect(first.switched).toBe(true);
    expect(decideLanguage("What do you recommend?", "en").switched).toBe(false);
    expect(decideLanguage("Bir chicken burger önerir misin?", "en").language).not.toBe("ar");
  });
  it("canlı arayüz metinleri 5 dilde", () => {
    for (const l of ["tr", "en", "de", "ar", "ru"] as const) {
      const s = liveStrings(l);
      expect(s.start && s.end && s.interrupt && s.fallback && s.micUnavailable).toBeTruthy();
    }
    expect(liveStrings("tr").micUnavailable).toBe("Mikrofona erişilemedi. Yazarak devam edebilirsiniz.");
    expect(liveStrings("tr").fallback).toBe("Sesli bağlantı kurulamadı. Bas-konuş moduna geçildi.");
    expect(liveStrings("tr").unavailable).toBe("Asistan şu anda yanıt veremiyor.");
  });
});

describe("konuşma bağlamı (öneri kısıtları kesintide korunur)", () => {
  it("3 kişi, biri vegan, 1500 TL → kesinti → 'Acı da olmasın' öneriyi yeniler", () => {
    const a = updateContext(EMPTY_CONTEXT, "3 kişiyiz, birimiz vegan, 1500 lirayı geçmeyelim");
    expect(a.context).toMatchObject({ guests: 3, budgetMinor: 150000, diets: [{ tag: "vegan", guests: 1 }], lastIntent: "recommend" });
    expect(a.constraintOnly).toBe(false);
    const b = updateContext(a.context, "Acı da olmasın");
    expect(b.context.spicy).toBe("avoid");
    expect(b.context.guests).toBe(3);
    expect(b.context.diets).toHaveLength(1);
    expect(b.constraintOnly).toBe(true);
    expect(contextSummary(b.context)).toMatch(/3/);
    expect(parseContext(JSON.parse(JSON.stringify(b.context)))).toEqual(b.context);
    expect(parseContext("bozuk")).toEqual(EMPTY_CONTEXT);
  });

  it("öneri yokken kısıt cümlesi öneri tetiklemez", () => {
    expect(updateContext(EMPTY_CONTEXT, "Birimiz vegan").constraintOnly).toBe(false);
  });

  it("diyet misafiri yalnızca açık etiketli ana yemek alır; yoksa karşılanmadı bildirilir (uydurma yok)", () => {
    const products = flattenMenu(fakeView());
    const r = recommend(products, { guests: 3, budgetMinor: 150000, dietGuests: [{ tag: "vegan", guests: 1 }], spicy: "avoid" });
    expect(r.unmetDiets).toEqual(["vegan"]);
    expect(r.totalMinor).toBeLessThanOrEqual(150000);
    const v = recommend(products, { guests: 2, dietGuests: [{ tag: "vegetarian", guests: 1 }] });
    expect(v.unmetDiets).toEqual([]);
    expect(v.dietPicks).toEqual([{ tag: "vegetarian", product: "mercimek-corbasi" }]);
  });
});

describe("gerçek-zamanlı sağlayıcı sözleşmesi (mock)", () => {
  const make = (testHooks = true) => createCascadeRealtimeProvider({ ai: createRuleBasedProvider(), stt: createMockStt(), tts: createMockTts(), testHooks });

  it("STT güven puanı; düşük güven eşiğin altında", async () => {
    const s = make().connect();
    const ok = await s.transcribe({ audio: new TextEncoder().encode("MOCK-STT:Menüde ne var?"), mimeType: "audio/wav", languageHint: "tr" });
    expect(ok.text).toBe("Menüde ne var?");
    expect(ok.confidence!).toBeGreaterThan(TRANSCRIPT_CONFIDENCE_MIN);
    const low = await s.transcribe({ audio: new TextEncoder().encode("MOCK-STT-LOW:mmh şey"), mimeType: "audio/wav", languageHint: "tr" });
    expect(low.confidence!).toBeLessThan(TRANSCRIPT_CONFIDENCE_MIN);
    expect(confidenceFromLogprobs([{ logprob: Math.log(0.9) }, { logprob: Math.log(0.9) }])).toBeCloseTo(0.9);
    expect(confidenceFromLogprobs([])).toBeNull();
  });

  it("metin parça parça akar; araya girme sağlayıcı isteğini iptal eder", async () => {
    const provider = make();
    const s = provider.connect();
    const deltas: string[] = [];
    const req = { system: "", history: [], utterance: "Merhaba", language: "tr" as const, tools: [], executeTool: async () => ({ ok: true }) as never };
    const r = await s.respond(req, (d) => deltas.push(d));
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(r.text);
    const s2 = provider.connect();
    const p = s2.respond(req, () => s2.interrupt());
    await expect(p).rejects.toThrow();
    expect(s2.signal.aborted).toBe(true);
    const audio = await s.speak("Merhaba, hoş geldiniz.", "tr");
    expect(audio.mimeType).toBe("audio/wav");
  });

  it("test kancaları yalnızca mock modunda", () => {
    expect(make(true).connect().testHook("x #drop")).toEqual({ drop: true, down: false });
    expect(make(false).connect().testHook("x #drop")).toBeNull();
  });

  it("üst sinyal iptal edilince oturum da kapanır", () => {
    const parent = new AbortController();
    const s = make().connect(parent.signal);
    parent.abort();
    expect(s.signal.aborted).toBe(true);
  });
});

describe("kullanım ve gecikme ölçümü", () => {
  it("oturum, dakika, kesinti, yeniden bağlanma, yedek ve sağlayıcı hata oranı", () => {
    const base = { audioInMs: 0, audioOutMs: 0, interrupted: false, errorCode: null, firstAudioMs: null, totalMs: null, attempts: 1 } as const;
    const s = summarizeVoice([
      { ...base, conversationId: "a", mode: "REALTIME", status: "COMPLETED", audioInMs: 30_000, audioOutMs: 30_000, firstAudioMs: 800, totalMs: 2000 },
      { ...base, conversationId: "a", mode: "REALTIME", status: "INTERRUPTED", interrupted: true, attempts: 2, firstAudioMs: 1200, totalMs: 3000 },
      { ...base, conversationId: "b", mode: "FALLBACK", status: "COMPLETED", audioInMs: 6000 },
      { ...base, conversationId: "b", mode: "REALTIME", status: "FAILED", errorCode: "provider_unavailable" },
    ]);
    expect(s).toMatchObject({ sessions: 2, turns: 4, liveTurns: 3, fallbackTurns: 1, interruptions: 1, reconnects: 1, audioInSeconds: 36, audioOutSeconds: 30, voiceMinutes: 1.1, avgFirstAudioMs: 1000, avgTurnMs: 2500 });
    expect(s.fallbackRate).toBe(0.25);
    expect(s.providerErrorRate).toBe(0.25);
    expect(formatRate(0.25)).toBe("%25");
    expect(summarizeVoice([]).fallbackRate).toBe(0);
  });

  it("oturum sınırları merkezi yapılandırmada", () => {
    expect(SESSION_LIMITS.maxConsecutiveFailures).toBe(2);
    expect(SESSION_LIMITS.idleTimeoutMs).toBeGreaterThanOrEqual(30_000);
    expect(SESSION_LIMITS.maxSessionMs).toBeLessThanOrEqual(15 * 60_000);
  });
});

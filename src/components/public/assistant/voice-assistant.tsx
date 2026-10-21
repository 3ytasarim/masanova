"use client";

import { AudioLines, Keyboard, Loader2, Mic, Square, Volume2, VolumeX, X, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { assistantStrings, liveStrings } from "@/lib/ai/i18n";
import { aiDirection, AI_LANGUAGE_LABELS, type AiLanguage } from "@/lib/ai/language";
import type { ActionCard, AssistantReply, AssistantTurnResponse, CartLinePayload, ConversationSummary, RecommendationBundle } from "@/lib/ai/types";
import { cn } from "@/lib/utils/cn";
import { INITIAL_VOICE, voiceReducer } from "@/lib/voice/session";
import { MicrophoneError, startRecording, type RecorderHandle } from "@/lib/voice/speech-input";
import { createSpeechPlayer } from "@/lib/voice/speech-output";
import { liveStatusKey } from "@/lib/voice/live-session";
import { toBase64 } from "@/lib/voice/wav";
import { LiveControls } from "@/components/public/assistant/live-controls";
import { useLiveVoice, type PendingInput } from "@/components/public/assistant/use-live-voice";
import { submitServiceRequestAction } from "@/server/actions/service-request.actions";
import type { CustomerServiceRequestView } from "@/server/services/service-requests/customer-request.service";

type Message = { id: string; role: "user" | "assistant"; text: string; language: AiLanguage; reply?: AssistantReply; turnKey?: string; parts?: string[]; stale?: boolean };
type CardState = Record<string, { done: boolean; note: string }>;

export type VoiceAssistantProps = {
  open: boolean;
  onClose: () => void;
  token: string;
  /** Kanıt anahtarı (masa kapsamı) — aynı tarayıcıda konuşmayı sürdürmek için. */
  scope: string;
  uiLocale: string;
  menuLocales: string[];
  cart: { key: string; selection: { product: string; variant: string | null; modifiers: { group: string; modifier: string }[]; quantity: number; note: string | null } }[];
  recentOrders: string[];
  onAddLines: (lines: CartLinePayload[]) => void;
  onChangeLine: (key: string, quantity: number) => void;
  onOpenProduct: (product: string) => void;
  onOpenCart: () => void;
  onPrepareRecommendation: (bundle: RecommendationBundle) => number;
  onServiceResult: (request: CustomerServiceRequestView) => void;
};

const PROOF_PREFIX = "mn_ai:";
const MUTE_KEY = "mn_ai_muted";
const MUTE_EVENT = "mn-ai-muted";

function readStore(storage: "local" | "session", key: string): string | null {
  try {
    return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function writeStore(storage: "local" | "session", key: string, value: string | null) {
  try {
    const s = storage === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* gizli mod */
  }
}
const subscribeMute = (cb: () => void) => {
  window.addEventListener(MUTE_EVENT, cb);
  return () => window.removeEventListener(MUTE_EVENT, cb);
};

/**
 * Sesli asistan paneli (tembel yüklenir — AI kapalı işletmeler bu kodu indirmez).
 * Bas-konuş: mikrofona dokun → tek ifade → yanıt → (ses açıksa) seslendirme. Konuşurken mikrofona dokunmak sesi keser
 * ve dinlemeye geçer. Kapatınca mikrofon ve ses DURUR; konuşma aynı tarayıcıda sürdürülebilir (kanıt yerel depoda).
 * Eylem kartları hiçbir şeyi kendiliğinden yapmaz: yalnızca müşterinin dokunuşu mevcut sepet / servis mantığını çalıştırır.
 */
export default function VoiceAssistant(props: VoiceAssistantProps) {
  const { open, onClose, token, scope } = props;
  const [machine, dispatch] = useReducer(voiceReducer, INITIAL_VOICE);
  const [language, setLanguage] = useState<AiLanguage>("tr");
  const [assistantName, setAssistantName] = useState("MasaNova AI");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  // Panel yalnızca ilk açılışta bağlanır (mount) → başlangıç durumu "yükleniyor".
  const [loaded, setLoaded] = useState<"loading" | "ready" | "disabled">("loading");
  const sessionStarted = useRef(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [cards, setCards] = useState<CardState>({});
  const [realtime, setRealtime] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [respondingTurn, setRespondingTurn] = useState<string | null>(null);
  const staleTurns = useRef(new Set<string>());
  const muted = useSyncExternalStore(subscribeMute, () => readStore("session", MUTE_KEY) === "1", () => false);
  const recorder = useRef<RecorderHandle | null>(null);
  const recordStart = useRef(0);
  const player = useRef(createSpeechPlayer());
  const speechGen = useRef(0);
  /** Oynatmayı durdur ve indirilmekte olan yanıt sesini geçersiz kıl (kapandıktan sonra ses çalmaz). */
  const silence = () => {
    speechGen.current += 1;
    player.current.stop();
  };
  const liveEndRef = useRef<() => void>(() => undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const proofKey = `${PROOF_PREFIX}${scope}`;
  const s = assistantStrings(language);
  const ls = liveStrings(language);
  const dir = aiDirection(language);

  // ── Diyalog aç / kapa (kapanınca mikrofon + ses durur) ──
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) {
      recorder.current?.cancel();
      recorder.current = null;
      silence();
      liveEndRef.current();
    }
  }, [open]);
  useEffect(() => () => {
    recorder.current?.cancel();
    silence();
  }, []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const applySummary = (c: ConversationSummary) => {
    setLanguage(c.language);
    setAssistantName(c.assistantName);
    setVoiceEnabled(c.voiceEnabled);
    setMessages(c.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, language: m.language })));
  };

  const startSession = useCallback(
    async (fresh: boolean) => {
      if (fresh) writeStore("local", proofKey, null);
      const proof = fresh ? null : readStore("local", proofKey);
      try {
        const res = await fetch(`/t/${token}/asistan/oturum`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(proof ? { "x-mn-ai-proof": proof } : {}) },
          body: JSON.stringify({ uiLocale: props.uiLocale }),
        });
        const json = (await res.json()) as { ok: boolean; proof?: string | null; conversation?: ConversationSummary; realtime?: boolean; error?: string };
        if (!json.ok || !json.conversation) {
          setLoaded("disabled");
          return false;
        }
        setRealtime(!!json.realtime);
        if (json.proof) writeStore("local", proofKey, json.proof);
        applySummary(json.conversation);
        setLoaded("ready");
        return true;
      } catch {
        setLoaded("disabled");
        return false;
      }
    },
    [proofKey, token, props.uiLocale],
  );

  useEffect(() => {
    if (sessionStarted.current) return;
    sessionStarted.current = true;
    void startSession(false);
  }, [startSession]);

  const errorText = (code: string) =>
    code === "stt_failed" || code === "audio_invalid" ? s.sttFailed : code === "rate_limited" || code === "turn_limit" ? s.rateLimited : code === "too_long" || code === "audio_too_long" ? s.tooLong : code === "feature_disabled" ? s.disabled : s.aiFailed;

  async function speak(reply: AssistantReply) {
    if (muted || !reply.speakable) return dispatch({ type: "SPEECH_ENDED" });
    const gen = ++speechGen.current;
    try {
      const res = await fetch(`/t/${token}/asistan/ses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mn-ai-proof": readStore("local", proofKey) ?? "" },
        body: JSON.stringify({ messageId: reply.messageId }),
      });
      if (res.status !== 200) return dispatch({ type: "SPEECH_ENDED" });
      const blob = await res.blob();
      if (gen !== speechGen.current) return; // bu arada durduruldu / kapatıldı / sessize alındı
      await player.current.play(blob);
    } catch {
      /* TTS yoksa metin yeterli */
    }
    dispatch({ type: "SPEECH_ENDED" });
  }

  async function send(input: { text?: string; audio?: { blob: Blob; mimeType: string; durationMs: number }; wav?: { data: string; durationMs: number }; turnKey?: string }, retried = false): Promise<void> {
    const payload = {
      text: input.text ?? null,
      clientDurationMs: input.audio?.durationMs ?? null,
      cart: props.cart,
      recentOrders: props.recentOrders,
      // Canlı moddan devralınan ifade: aynı tur anahtarı (çift kayıt yok) + JSON içinde WAV.
      turnKey: input.turnKey ?? null,
      audio: input.wav ? { data: input.wav.data, mime: "audio/wav", durationMs: input.wav.durationMs } : null,
    };
    const proof = readStore("local", proofKey) ?? "";
    let res: Response;
    try {
      if (input.audio) {
        const form = new FormData();
        form.append("payload", JSON.stringify(payload));
        form.append("audio", input.audio.blob, "utterance");
        res = await fetch(`/t/${token}/asistan`, { method: "POST", headers: { "x-mn-ai-proof": proof }, body: form });
      } else {
        res = await fetch(`/t/${token}/asistan`, { method: "POST", headers: { "Content-Type": "application/json", "x-mn-ai-proof": proof }, body: JSON.stringify(payload) });
      }
    } catch {
      return dispatch({ type: "ERROR", message: s.aiFailed });
    }
    const json = (await res.json().catch(() => ({ ok: false, error: "ai_failed" }))) as AssistantTurnResponse;
    if (!json.ok) {
      if (json.error === "conversation_invalid" && !retried) {
        await startSession(true);
        return send(input, true);
      }
      if (json.error === "stt_failed" || json.error === "audio_invalid") setTyping(true);
      return dispatch({ type: "ERROR", message: errorText(json.error) });
    }
    const reply = json.reply;
    setLanguage(reply.language);
    setMessages((list) => [
      ...list,
      ...(json.transcript || input.text ? [{ id: `u-${reply.messageId}`, role: "user" as const, text: json.transcript ?? input.text ?? "", language: reply.language }] : []),
      { id: reply.messageId, role: "assistant", text: reply.text, language: reply.language, reply },
    ]);
    // Sipariş kendiliğinden gönderilmez; "Sepeti Aç" kartı yalnızca dokunulunca sepeti açar.
    const willSpeak = !muted && reply.speakable;
    dispatch({ type: "RESPONSE", willSpeak });
    if (willSpeak) void speak(reply);
  }

  // ── Canlı sesli konuşma ──
  const upsertTurn = (turnKey: string, role: "user" | "assistant", patch: (m: Message) => Message) =>
    setMessages((list) => {
      const id = `${role === "user" ? "u" : "a"}-${turnKey}`;
      const i = list.findIndex((m) => m.id === id);
      if (i >= 0) return list.map((m, j) => (j === i ? patch(m) : m));
      // Kullanıcı mesajı asistan yanıtından önce görünür.
      const fresh = patch({ id, role, text: "", language, turnKey });
      if (role === "user") {
        const a = list.findIndex((m) => m.id === `a-${turnKey}`);
        if (a >= 0) return [...list.slice(0, a), fresh, ...list.slice(a)];
      }
      return [...list, fresh];
    });
  const live = useLiveVoice({
    token,
    getProof: () => readStore("local", proofKey) ?? "",
    getContext: () => ({ cart: props.cart, recentOrders: props.recentOrders }),
    muted,
    strings: ls,
    callbacks: {
      onTurnStart: (turnKey, input) => {
        setNotice(null);
        silence();
        if (input.text) upsertTurn(turnKey, "user", (m) => ({ ...m, text: input.text! }));
      },
      onTranscript: (turnKey, text) => upsertTurn(turnKey, "user", (m) => ({ ...m, text })),
      onLanguage: (l) => setLanguage(l),
      onText: (turnKey, seq, text) => {
        setRespondingTurn(turnKey);
        upsertTurn(turnKey, "assistant", (m) => {
          const parts = [...(m.parts ?? [])];
          parts[seq] = text; // aynı sıra numarası (yeniden bağlanma) üzerine yazar → çift metin yok
          return { ...m, parts, text: parts.filter(Boolean).join(" ") };
        });
      },
      onActions: (turnKey, data) => {
        if (staleTurns.current.has(turnKey)) return;
        upsertTurn(turnKey, "assistant", (m) => ({
          ...m,
          id: m.id,
          reply: { messageId: data.messageId, text: m.text, language: m.language, direction: aiDirection(m.language), actions: data.actions, products: data.products, recommendation: data.recommendation, speakable: false },
        }));
      },
      onDone: (turnKey, data) => {
        setRespondingTurn(null);
        setLanguage(data.language);
        upsertTurn(turnKey, "assistant", (m) => ({ ...m, text: data.text, language: data.language, reply: m.reply ? { ...m.reply, text: data.text, language: data.language, direction: aiDirection(data.language) } : m.reply }));
      },
      onStale: (turnKey) => {
        staleTurns.current.add(turnKey);
        setRespondingTurn(null);
        setMessages((list) => list.map((m) => (m.turnKey === turnKey && m.role === "assistant" ? { ...m, stale: true } : m)));
      },
      onFallback: (pending) => void fallbackSend(pending),
      onConversationInvalid: () => startSession(true),
      onError: (code) => setNotice(code === "stt_failed" || code === "audio_invalid" ? s.sttFailed : code === "ai_failed" ? ls.unavailable : errorText(code)),
    },
  });

  useEffect(() => {
    liveEndRef.current = () => live.end();
  });

  /** Canlı mod düştü: bekleyen ifade bas-konuş uç noktasına AYNI tur anahtarıyla gider (kayıp / çift yok). */
  async function fallbackSend(pending: PendingInput | null) {
    setRealtime(false);
    setNotice(ls.fallback);
    setRespondingTurn(null);
    if (!pending) return;
    setMessages((list) => list.filter((m) => m.turnKey !== pending.turnKey));
    dispatch(pending.text ? { type: "SUBMIT_TEXT" } : { type: "START_LISTENING" });
    if (!pending.text) dispatch({ type: "STOP_LISTENING" });
    await send(pending.text ? { text: pending.text, turnKey: pending.turnKey } : { wav: { data: toBase64(pending.audio!.wav), durationMs: pending.audio!.durationMs }, turnKey: pending.turnKey });
  }

  async function finishRecording() {
    const handle = recorder.current;
    if (!handle) return;
    recorder.current = null;
    dispatch({ type: "STOP_LISTENING" });
    const rec = await handle.stop();
    if (rec.blob.size < 10) return dispatch({ type: "ERROR", message: s.sttFailed });
    await send({ audio: { blob: rec.blob, mimeType: rec.mimeType, durationMs: rec.durationMs } });
  }
  const finishRef = useRef(finishRecording);
  useEffect(() => {
    finishRef.current = finishRecording;
  });

  async function onMic() {
    setNotice(null);
    if (machine.state === "LISTENING") return void finishRecording();
    if (machine.state === "THINKING") return;
    if (machine.state === "SPEAKING") {
      silence();
      dispatch({ type: "INTERRUPT" });
    } else dispatch({ type: "START_LISTENING" });
    try {
      recordStart.current = Date.now();
      recorder.current = await startRecording({ onAutoStop: () => void finishRef.current() });
    } catch (error) {
      recorder.current = null;
      setTyping(true);
      dispatch({ type: "ERROR", message: error instanceof MicrophoneError && error.reason === "unsupported" ? s.micUnsupported : s.micDenied });
    }
  }

  async function onSubmitText(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || machine.state === "THINKING") return;
    silence();
    setDraft("");
    if (live.live) return live.sendText(text);
    dispatch({ type: "SUBMIT_TEXT" });
    await send({ text });
  }

  function toggleMute() {
    writeStore("session", MUTE_KEY, muted ? null : "1");
    window.dispatchEvent(new Event(MUTE_EVENT));
    if (!muted) {
      silence();
      dispatch({ type: "SPEECH_ENDED" });
    }
  }

  function markCard(id: string, note: string) {
    setCards((c) => ({ ...c, [id]: { done: true, note } }));
  }

  async function confirmCard(card: ActionCard) {
    switch (card.kind) {
      case "cart_add":
        props.onAddLines([card.line]);
        return markCard(card.id, s.added);
      case "cart_change":
        props.onChangeLine(card.lineKey, card.quantity);
        return markCard(card.id, s.updated);
      case "configure":
        props.onOpenProduct(card.product);
        return markCard(card.id, "");
      case "open_cart":
        props.onOpenCart();
        return markCard(card.id, "");
      case "service": {
        const res = await submitServiceRequestAction(token, { type: card.type });
        if (res.kind === "created" || res.kind === "duplicate") {
          props.onServiceResult(res.request);
          return markCard(card.id, res.kind === "created" ? s.serviceSent[card.type] : s.serviceAlready[card.type]);
        }
        return markCard(card.id, s.aiFailed);
      }
    }
  }

  const latest = [...messages].reverse().find((m) => m.role === "assistant");
  // Kartlar yalnızca EN SON yanıtındır; kesilen (bayat) yanıtın kartı gösterilmez.
  const lastAssistant = latest?.reply && !latest.stale ? latest : null;
  const lm = live.machine;
  const liveKey = liveStatusKey(lm.state);
  const liveStatus =
    lm.state === "THINKING" && respondingTurn ? ls.responding : liveKey === "fallback" || liveKey === "error" || liveKey === "ended" ? (lm.message ?? (liveKey === "ended" ? ls.ended : ls.unavailable)) : liveKey === "ready" ? s.ready : ls[liveKey];
  const statusText =
    machine.state === "LISTENING" ? s.listening : machine.state === "THINKING" ? (recorder.current ? s.thinking : s.preparing) : machine.state === "SPEAKING" ? s.speaking : machine.state === "ERROR" ? (machine.error ?? s.aiFailed) : s.ready;
  const offerMenuLanguage = props.menuLocales.includes(language) && language !== props.uiLocale;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={() => onClose()}
      aria-labelledby="ai-title"
      data-testid="ai-panel"
      className="m-0 mt-auto hidden open:flex h-[92dvh] max-h-[92dvh] w-full max-w-none flex-col overflow-hidden rounded-t-[1.75rem] bg-[#f6f3ee] p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/55 open:motion-safe:animate-[pm-sheet-in_260ms_cubic-bezier(0.16,1,0.3,1)] sm:m-auto sm:h-[86dvh] sm:max-w-lg sm:rounded-[1.75rem]"
    >
      <div dir={dir} lang={language} className="flex min-h-0 flex-1 flex-col" data-testid="ai-content" data-language={language}>
        <header className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-stone-900 text-white">
              <Sparkles aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 id="ai-title" className="truncate text-[1.0625rem] font-semibold">
                {assistantName}
              </h2>
              <p className="text-xs text-stone-500" data-testid="ai-language">
                {AI_LANGUAGE_LABELS[language]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {voiceEnabled ? (
              <button type="button" onClick={toggleMute} aria-pressed={muted} data-testid="ai-mute" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium hover:bg-stone-200/70">
                {muted ? <VolumeX aria-hidden="true" className="size-4" /> : <Volume2 aria-hidden="true" className="size-4" />}
                <span className="max-[360px]:sr-only">{muted ? s.unmute : s.mute}</span>
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-full hover:bg-stone-200/70" data-testid="ai-close">
              <X aria-hidden="true" className="size-5" />
              <span className="sr-only">{s.close}</span>
            </button>
          </div>
        </header>

        {/* Transkript (ikincil katman) */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-3" aria-live="polite" data-testid="ai-transcript">
          {loaded === "loading" ? <Loader2 aria-hidden="true" className="mx-auto mt-8 size-6 animate-spin text-stone-400" /> : null}
          {loaded === "disabled" ? <p className="mt-8 text-center text-sm text-stone-600">{s.disabled}</p> : null}
          <ol className="grid gap-3">
            {messages.map((m) => (
              <li key={m.id} data-testid="ai-message" data-role={m.role} data-lang={m.language} dir={aiDirection(m.language)} className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[0.9375rem] leading-relaxed", m.role === "user" ? "ms-auto bg-stone-900 text-white" : "me-auto bg-white ring-1 ring-stone-900/10")}>
                <span className="sr-only">{m.role === "user" ? s.you : assistantName}: </span>
                {m.text}
              </li>
            ))}
          </ol>
          {lastAssistant?.reply ? (
            <Cards reply={lastAssistant.reply} s={s} cards={cards} onConfirm={confirmCard} onDismiss={(id) => markCard(id, s.dismissed)} onOpenProduct={props.onOpenProduct} onPrepare={(b) => {
              const n = props.onPrepareRecommendation(b);
              markCard("recommendation", n ? s.added : s.chooseOptions);
            }} />
          ) : null}
          {offerMenuLanguage ? (
            <a href={`?dil=${language}`} className="mt-3 inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium text-stone-700 underline underline-offset-2" data-testid="ai-menu-language">
              {s.menuInLanguage(AI_LANGUAGE_LABELS[language])}
            </a>
          ) : null}
        </div>

        {/* Ses alanı (birincil) */}
        <div className="shrink-0 border-t border-stone-900/10 bg-[#f6f3ee] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {live.live ? (
            <LiveControls
              machine={lm}
              status={liveStatus}
              ls={ls}
              levelRef={live.levelRef}
              typing={typing}
              onToggleTyping={() => setTyping((v) => !v)}
              onInterrupt={() => live.interrupt()}
              onEnd={() => live.end()}
              typeLabel={s.typeInstead}
              captureMode={live.captureMode}
            />
          ) : realtime && loaded === "ready" && machine.state !== "LISTENING" && machine.state !== "THINKING" && machine.state !== "SPEAKING" ? (
            <>
              <p role="status" className={cn("min-h-6 text-center text-[0.9375rem] font-medium", machine.state === "ERROR" || lm.message || notice ? "text-red-700" : "text-stone-700")} data-testid="ai-state" data-state={machine.state} data-live-state={lm.state}>
                {machine.state === "ERROR" ? (machine.error ?? s.aiFailed) : (notice ?? lm.message ?? s.ready)}
              </p>
              <div className="mt-3 flex items-center justify-center gap-4">
                <button type="button" onClick={() => setTyping((v) => !v)} aria-pressed={typing} data-testid="ai-text-toggle" className="inline-flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-stone-900/10">
                  <Keyboard aria-hidden="true" className="size-5" />
                  <span className="sr-only">{s.typeInstead}</span>
                </button>
                <button type="button" onClick={() => { silence(); setNotice(null); void live.start(); }} data-testid="ai-live-start" aria-label={ls.start} className="relative inline-flex size-20 items-center justify-center rounded-full bg-stone-900 text-white shadow-lg transition-transform active:scale-95">
                  <AudioLines aria-hidden="true" className="size-8" />
                </button>
                <button type="button" onClick={() => void onMic()} data-testid="ai-mic" aria-label={s.tapToTalk} className="inline-flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-stone-900/10">
                  <Mic aria-hidden="true" className="size-5" />
                </button>
              </div>
              <p className="mt-2 text-center text-sm font-semibold text-stone-800">{ls.start}</p>
            </>
          ) : (
            <>
            <p role="status" className={cn("min-h-6 text-center text-[0.9375rem] font-medium", machine.state === "ERROR" ? "text-red-700" : "text-stone-700")} data-testid="ai-state" data-state={machine.state}>
              {machine.state === "LISTENING" ? <span aria-hidden="true" className="me-2 inline-block size-2.5 animate-pulse rounded-full bg-red-500 align-middle" /> : null}
              {notice && (machine.state === "READY" || machine.state === "SPEAKING") ? notice : statusText}
            </p>
            <div className="mt-3 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setTyping((v) => !v)}
                aria-pressed={typing}
                data-testid="ai-text-toggle"
                className="inline-flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-stone-900/10"
              >
                <Keyboard aria-hidden="true" className="size-5" />
                <span className="sr-only">{s.typeInstead}</span>
              </button>
              <button
                type="button"
                onClick={() => void onMic()}
                disabled={loaded !== "ready" || machine.state === "THINKING"}
                data-testid="ai-mic"
                aria-label={machine.state === "LISTENING" ? s.stopTalking : machine.state === "SPEAKING" ? s.interrupt : s.tapToTalk}
                className={cn(
                  "relative inline-flex size-20 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 disabled:opacity-50",
                  machine.state === "LISTENING" ? "bg-red-600" : "bg-stone-900",
                )}
              >
                {machine.state === "LISTENING" ? <span aria-hidden="true" className="absolute inset-0 rounded-full ring-4 ring-red-400/60 motion-safe:animate-ping" /> : null}
                {machine.state === "THINKING" ? <Loader2 aria-hidden="true" className="size-8 animate-spin" /> : machine.state === "LISTENING" ? <Square aria-hidden="true" className="size-7" /> : <Mic aria-hidden="true" className="size-8" />}
              </button>
              {machine.state === "SPEAKING" ? (
                <button type="button" onClick={() => { silence(); dispatch({ type: "SPEECH_ENDED" }); }} data-testid="ai-stop-speaking" className="inline-flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-stone-900/10">
                  <Square aria-hidden="true" className="size-4" />
                  <span className="sr-only">{s.stopSpeaking}</span>
                </button>
              ) : lastAssistant?.reply && voiceEnabled && !muted ? (
                <button type="button" onClick={() => { dispatch({ type: "SUBMIT_TEXT" }); dispatch({ type: "RESPONSE", willSpeak: true }); void speak(lastAssistant.reply!); }} className="inline-flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-stone-900/10" data-testid="ai-replay">
                  <RotateCcw aria-hidden="true" className="size-4" />
                  <span className="sr-only">{s.replay}</span>
                </button>
              ) : (
                <span aria-hidden="true" className="size-12" />
              )}
            </div>
            </>
          )}
          {machine.state === "LISTENING" ? <p className="mt-2 text-center text-xs font-medium text-red-700">{s.recording} · {s.stopTalking}</p> : null}
          {typing ? (
            <form onSubmit={onSubmitText} className="mt-3 flex gap-2">
              <label className="sr-only" htmlFor="ai-input">
                {s.placeholder}
              </label>
              <input
                id="ai-input"
                data-testid="ai-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={500}
                placeholder={s.placeholder}
                autoComplete="off"
                className="h-12 min-w-0 flex-1 rounded-full bg-white px-4 text-[1rem] ring-1 ring-stone-900/15 focus:outline-none focus:ring-2 focus:ring-stone-900"
              />
              <button type="submit" data-testid="ai-send" disabled={!draft.trim() || machine.state === "THINKING"} className="h-12 shrink-0 rounded-full bg-stone-900 px-5 text-sm font-semibold text-white disabled:opacity-50">
                {s.send}
              </button>
            </form>
          ) : null}
          <p className="mt-2 text-center text-[0.75rem] text-stone-500">{s.privacy}</p>
        </div>
      </div>
    </dialog>
  );
}

function Cards({
  reply,
  s,
  cards,
  onConfirm,
  onDismiss,
  onOpenProduct,
  onPrepare,
}: {
  reply: AssistantReply;
  s: ReturnType<typeof assistantStrings>;
  cards: CardState;
  onConfirm: (card: ActionCard) => void;
  onDismiss: (id: string) => void;
  onOpenProduct: (product: string) => void;
  onPrepare: (bundle: RecommendationBundle) => void;
}) {
  const label = (card: ActionCard) =>
    card.kind === "cart_add" ? s.addToCart : card.kind === "service" ? s.service[card.type] : card.kind === "open_cart" ? s.openCart : card.kind === "configure" ? s.openProduct : card.quantity === 0 ? s.remove : s.update;
  const title = (card: ActionCard) =>
    card.kind === "cart_add" ? `${card.line.quantity} × ${card.line.name}${card.line.detail ? ` (${card.line.detail})` : ""}` : card.kind === "configure" ? `${card.name} · ${s.chooseOptions}` : card.kind === "cart_change" ? `${card.name} → ${card.quantity}` : card.kind === "service" ? s.service[card.type] : s.openCart;
  const rec = reply.recommendation;
  return (
    <div className="mt-3 grid gap-2.5">
      {rec ? (
        <div className="rounded-2xl bg-white p-3.5 ring-1 ring-stone-900/10" data-testid="ai-recommendation" data-total-minor={rec.totalMinor} data-budget-minor={rec.budgetMinor ?? ""}>
          <ul className="grid gap-1.5">
            {rec.items.map((i) => (
              <li key={i.product} className="flex items-center justify-between gap-2 text-[0.9375rem]">
                <button type="button" onClick={() => onOpenProduct(i.product)} className="min-h-10 min-w-0 truncate text-start font-medium underline-offset-2 hover:underline">
                  {i.quantity > 1 ? `${i.quantity} × ` : ""}
                  {i.name}
                </button>
                <span className="shrink-0 tabular-nums text-stone-600">{i.lineTotalLabel}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t border-stone-900/10 pt-2 font-semibold">
            <span>{s.total}</span>
            <span className="tabular-nums">{rec.totalLabel}</span>
          </p>
          {cards["recommendation"] ? (
            <p className="mt-2 text-sm text-emerald-700">{cards["recommendation"].note}</p>
          ) : (
            <button type="button" onClick={() => onPrepare(rec)} data-testid="ai-recommendation-prepare" className="mt-3 min-h-12 w-full rounded-full bg-stone-900 text-sm font-semibold text-white">
              {s.prepareCart}
            </button>
          )}
        </div>
      ) : null}
      {reply.actions.map((card) => {
        const state = cards[card.id];
        return (
          <div key={card.id} className="rounded-2xl bg-white p-3.5 ring-1 ring-stone-900/10" data-testid="ai-card" data-kind={card.kind}>
            <p className="flex justify-between gap-3 text-[0.9375rem] font-semibold">
              <span className="min-w-0">{title(card)}</span>
              {card.kind === "cart_add" ? <span className="shrink-0 tabular-nums">{card.totalLabel}</span> : null}
            </p>
            {state ? (
              state.note ? <p className="mt-2 text-sm text-emerald-700" data-testid="ai-card-result">{state.note}</p> : null
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onDismiss(card.id)} data-testid="ai-card-cancel" className="min-h-12 rounded-full bg-stone-100 text-sm font-semibold">
                  {s.cancel}
                </button>
                <button type="button" onClick={() => onConfirm(card)} data-testid="ai-card-confirm" className="min-h-12 rounded-full bg-stone-900 px-2 text-sm font-semibold text-white">
                  {label(card)}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {!rec && reply.products.length && !reply.actions.length ? (
        <ul className="flex flex-wrap gap-2" data-testid="ai-products">
          {reply.products.map((p) => (
            <li key={p.product}>
              <button type="button" onClick={() => onOpenProduct(p.product)} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-3.5 text-sm ring-1 ring-stone-900/10">
                <span className={cn("font-medium", p.soldOut && "line-through opacity-60")}>{p.name}</span>
                <span className="tabular-nums text-stone-500">{p.priceLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

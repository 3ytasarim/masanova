/**
 * Canlı sesli oturum durum makinesi (saf). Dağınık boolean yerine TEK durum:
 *
 *  IDLE ─start─▶ CONNECTING ─ready─▶ LISTENING ─speech─▶ USER_SPEAKING ─end─▶ THINKING ─delta─▶ ASSISTANT_SPEAKING
 *                    │                   ▲                                            │                 │
 *                    └─fail─▶ FALLBACK   └──────────── turnDone / audioDone ──────────┴─────────────────┘
 *  ASSISTANT_SPEAKING / THINKING ─bargeIn─▶ INTERRUPTING ─interrupted─▶ LISTENING (yeni konuşma) / USER_SPEAKING
 *  THINKING ─streamLost─▶ RECONNECTING ─retry─▶ THINKING   ·   tekrarlayan hata ─▶ FALLBACK (bas-konuş)
 *  her durum ─end─▶ ENDED ─start─▶ CONNECTING   ·   hata ─▶ ERROR
 *
 * Mikrofon yalnızca CONNECTING'den sonra (kullanıcının açık dokunuşu) çalışır; IDLE / ENDED / FALLBACK / ERROR'da kapalı.
 */
export type LiveState =
  | "IDLE"
  | "CONNECTING"
  | "READY"
  | "LISTENING"
  | "USER_SPEAKING"
  | "THINKING"
  | "ASSISTANT_SPEAKING"
  | "INTERRUPTING"
  | "RECONNECTING"
  | "FALLBACK"
  | "ERROR"
  | "ENDED";

export type LiveEvent =
  | { type: "START" }
  | { type: "CONNECTED" }
  | { type: "CONNECT_FAILED"; fallback: boolean; message: string }
  | { type: "SPEECH_START" }
  | { type: "SPEECH_END" }
  | { type: "SPEECH_DISCARDED" }
  | { type: "TEXT_SUBMITTED" }
  | { type: "AUDIO_STARTED" }
  | { type: "AUDIO_DONE" }
  | { type: "TURN_DONE"; speaking: boolean }
  | { type: "BARGE_IN" }
  | { type: "INTERRUPTED" }
  | { type: "STREAM_LOST" }
  | { type: "RETRYING" }
  | { type: "FALLBACK"; message: string }
  | { type: "ERROR"; message: string }
  | { type: "PAUSE" }
  | { type: "END" };

export type LiveMachine = { state: LiveState; message: string | null; interruptions: number; reconnects: number };

export const INITIAL_LIVE: LiveMachine = { state: "IDLE", message: null, interruptions: 0, reconnects: 0 };

/** Mikrofonun açık olması gereken durumlar (VAD çalışır). */
export const MIC_ACTIVE: readonly LiveState[] = ["LISTENING", "USER_SPEAKING", "THINKING", "ASSISTANT_SPEAKING", "INTERRUPTING", "RECONNECTING"];

export function liveReducer(m: LiveMachine, e: LiveEvent): LiveMachine {
  const to = (state: LiveState, patch: Partial<LiveMachine> = {}): LiveMachine => ({ ...m, state, message: null, ...patch });
  switch (e.type) {
    case "START":
      return ["IDLE", "ENDED", "ERROR", "READY"].includes(m.state) ? to("CONNECTING") : m;
    case "CONNECTED":
      return m.state === "CONNECTING" ? to("LISTENING") : m;
    case "CONNECT_FAILED":
      return to(e.fallback ? "FALLBACK" : "ERROR", { message: e.message });
    case "SPEECH_START":
      return m.state === "LISTENING" ? to("USER_SPEAKING") : m;
    case "SPEECH_DISCARDED":
      return m.state === "USER_SPEAKING" ? to("LISTENING") : m;
    case "SPEECH_END":
      return m.state === "USER_SPEAKING" ? to("THINKING") : m;
    case "TEXT_SUBMITTED":
      return ["LISTENING", "READY", "ASSISTANT_SPEAKING"].includes(m.state) ? to("THINKING") : m;
    case "AUDIO_STARTED":
      return m.state === "THINKING" ? to("ASSISTANT_SPEAKING") : m;
    case "TURN_DONE":
      return m.state === "THINKING" || m.state === "RECONNECTING" ? to(e.speaking ? "ASSISTANT_SPEAKING" : "LISTENING") : m;
    case "AUDIO_DONE":
      return m.state === "ASSISTANT_SPEAKING" ? to("LISTENING") : m;
    case "BARGE_IN":
      return m.state === "ASSISTANT_SPEAKING" || m.state === "THINKING" ? to("INTERRUPTING", { interruptions: m.interruptions + 1 }) : m;
    case "INTERRUPTED":
      return m.state === "INTERRUPTING" ? to("LISTENING") : m;
    case "STREAM_LOST":
      return m.state === "THINKING" || m.state === "ASSISTANT_SPEAKING" ? to("RECONNECTING", { reconnects: m.reconnects + 1 }) : m;
    case "RETRYING":
      return m.state === "RECONNECTING" ? to("THINKING") : m;
    case "FALLBACK":
      return to("FALLBACK", { message: e.message });
    case "ERROR":
      return to("ERROR", { message: e.message });
    case "PAUSE":
      return MIC_ACTIVE.includes(m.state) ? to("READY") : m;
    case "END":
      return to("ENDED");
  }
}

/** Kullanıcıya gösterilen kısa durum anahtarı (UI metni dil dosyasından). */
export function liveStatusKey(state: LiveState): "listening" | "understanding" | "responding" | "speaking" | "connecting" | "reconnecting" | "ready" | "ended" | "error" | "fallback" {
  switch (state) {
    case "LISTENING":
    case "USER_SPEAKING":
      return "listening";
    case "THINKING":
      return "understanding";
    case "INTERRUPTING":
      return "listening";
    case "ASSISTANT_SPEAKING":
      return "speaking";
    case "CONNECTING":
      return "connecting";
    case "RECONNECTING":
      return "reconnecting";
    case "FALLBACK":
      return "fallback";
    case "ERROR":
      return "error";
    case "ENDED":
      return "ended";
    default:
      return "ready";
  }
}

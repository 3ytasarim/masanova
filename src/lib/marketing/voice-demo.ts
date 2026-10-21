/**
 * Pazarlama sesli AI demosu — SAF durum makinesi. Gerçek mikrofon / ses / AI sağlayıcısı YOKTUR: yalnızca önceden
 * yazılmış, kısa bir senaryo görsel olarak oynatılır. Bileşen yalnızca `phase` ve görünür mesajları çizer.
 *
 *   idle → listening → user → thinking → reply → cards → (dil değişimi) listening → user → thinking → reply → done
 *
 * Döngü bir kez oynar ve son karede durur (dilleri sonsuza kadar döndürmez). Hareket azaltmada doğrudan son kare.
 */
export type VoiceLocale = "tr" | "en";
export type VoicePhase = "idle" | "listening" | "user" | "thinking" | "reply" | "cards" | "done";

export type VoiceTurn = { locale: VoiceLocale; user: string; reply: string; cards?: { name: string; price: string; note: string; photo?: string }[] };

export type VoiceDemoState = { turn: number; phase: VoicePhase };

export const PHASE_DURATION_MS: Record<VoicePhase, number> = {
  idle: 600,
  listening: 1400,
  user: 1100,
  thinking: 900,
  reply: 1600,
  cards: 2600,
  done: 0,
};

export const INITIAL_VOICE_STATE: VoiceDemoState = { turn: 0, phase: "idle" };

/** Bir sonraki durum. Son turun yanıtından sonra "done" (kalıcı). */
export function nextVoiceState(state: VoiceDemoState, script: readonly VoiceTurn[]): VoiceDemoState {
  if (state.phase === "done" || script.length === 0) return { turn: Math.max(0, script.length - 1), phase: "done" };
  const turn = script[state.turn];
  const last = state.turn >= script.length - 1;
  switch (state.phase) {
    case "idle":
      return { turn: state.turn, phase: "listening" };
    case "listening":
      return { turn: state.turn, phase: "user" };
    case "user":
      return { turn: state.turn, phase: "thinking" };
    case "thinking":
      return { turn: state.turn, phase: "reply" };
    case "reply":
      if (turn?.cards?.length) return { turn: state.turn, phase: "cards" };
      return last ? { turn: state.turn, phase: "done" } : { turn: state.turn + 1, phase: "listening" };
    case "cards":
      return last ? { turn: state.turn, phase: "done" } : { turn: state.turn + 1, phase: "listening" };
  }
}

/** Hareket azaltmada / JS'siz okuyucuda gösterilen son kare: tüm turlar tamamlanmış. */
export function finalVoiceState(script: readonly VoiceTurn[]): VoiceDemoState {
  return { turn: Math.max(0, script.length - 1), phase: "done" };
}

/** Bu durumda ekranda olması gereken mesajlar (önceki turlar tam, mevcut tur faza göre). */
export function visibleMessages(state: VoiceDemoState, script: readonly VoiceTurn[]) {
  const out: { role: "user" | "assistant"; text: string; locale: VoiceLocale; cards?: VoiceTurn["cards"] }[] = [];
  script.forEach((t, i) => {
    if (i > state.turn) return;
    const done = i < state.turn || state.phase === "done";
    const showUser = done || ["user", "thinking", "reply", "cards"].includes(state.phase);
    const showReply = done || ["reply", "cards"].includes(state.phase);
    const showCards = done || state.phase === "cards";
    if (showUser) out.push({ role: "user", text: t.user, locale: t.locale });
    if (showReply) out.push({ role: "assistant", text: t.reply, locale: t.locale, cards: showCards ? t.cards : undefined });
  });
  return out;
}

/** Etkin konuşma dili (rozet): mevcut turun dili. */
export function activeLocale(state: VoiceDemoState, script: readonly VoiceTurn[]): VoiceLocale {
  return script[Math.min(state.turn, script.length - 1)]?.locale ?? "tr";
}

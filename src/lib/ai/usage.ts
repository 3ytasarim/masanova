/**
 * Kullanım hesapları (saf). Faturalama fiyatı YOK — yalnızca ölçüm (ileride "aylık ses dakikası" paketleri için temel).
 */
export type UsageRow = { kind: "CONVERSATION" | "CHAT" | "STT" | "TTS" | "ADVISOR"; inputTokens: number; outputTokens: number; sttMs: number; ttsCharacters: number; success: boolean };

export type UsageSummary = { conversations: number; messages: number; inputTokens: number; outputTokens: number; sttSeconds: number; ttsCharacters: number; failures: number };

export function summarizeUsage(rows: readonly UsageRow[]): UsageSummary {
  const s: UsageSummary = { conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0, sttSeconds: 0, ttsCharacters: 0, failures: 0 };
  let sttMs = 0;
  for (const r of rows) {
    if (r.kind === "CONVERSATION") s.conversations += 1;
    if (r.kind === "CHAT" && r.success) s.messages += 1;
    s.inputTokens += r.inputTokens;
    s.outputTokens += r.outputTokens;
    sttMs += r.sttMs;
    s.ttsCharacters += r.ttsCharacters;
    if (!r.success) s.failures += 1;
  }
  s.sttSeconds = Math.round(sttMs / 100) / 10;
  return s;
}

/** Ses dakikası (STT) — "x dk y sn". */
export function formatVoiceDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} dk ${String(s).padStart(2, "0")} sn` : `${s} sn`;
}

/** Ses süresinin baytlardan kabaca tahmini YOK — STT sağlayıcısının bildirdiği / istemcinin ölçtüğü süre kullanılır. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Sesli tur ölçümü (AiTurn satırlarından). */
export type VoiceTurnRow = {
  conversationId: string;
  mode: "REALTIME" | "FALLBACK";
  status: "PROCESSING" | "COMPLETED" | "INTERRUPTED" | "FAILED";
  attempts: number;
  audioInMs: number;
  audioOutMs: number;
  interrupted: boolean;
  errorCode: string | null;
  firstAudioMs: number | null;
  totalMs: number | null;
};

export type VoiceSummary = {
  sessions: number;
  turns: number;
  liveTurns: number;
  fallbackTurns: number;
  interruptions: number;
  reconnects: number;
  audioInSeconds: number;
  audioOutSeconds: number;
  /** Toplam ses dakikası (giriş + çıkış). */
  voiceMinutes: number;
  /** Yedeğe düşen turların oranı (0–1). */
  fallbackRate: number;
  /** Sağlayıcı / AI hatasıyla biten turların oranı (0–1). */
  providerErrorRate: number;
  /** Ortalama ilk ses gecikmesi (ms) — yalnızca sesli yanıtı olan canlı turlar. */
  avgFirstAudioMs: number | null;
  avgTurnMs: number | null;
};

const PROVIDER_ERRORS = new Set(["provider_unavailable", "ai_failed", "stt_failed"]);

export function summarizeVoice(rows: readonly VoiceTurnRow[]): VoiceSummary {
  const sessions = new Set<string>();
  let liveTurns = 0;
  let fallbackTurns = 0;
  let interruptions = 0;
  let reconnects = 0;
  let inMs = 0;
  let outMs = 0;
  let providerErrors = 0;
  const firstAudio: number[] = [];
  const total: number[] = [];
  for (const r of rows) {
    sessions.add(r.conversationId);
    if (r.mode === "REALTIME") liveTurns += 1;
    else fallbackTurns += 1;
    if (r.interrupted) interruptions += 1;
    reconnects += Math.max(0, r.attempts - 1);
    inMs += r.audioInMs;
    outMs += r.audioOutMs;
    if (r.status === "FAILED" && r.errorCode && PROVIDER_ERRORS.has(r.errorCode)) providerErrors += 1;
    if (r.mode === "REALTIME" && r.firstAudioMs !== null) firstAudio.push(r.firstAudioMs);
    if (r.totalMs !== null) total.push(r.totalMs);
  }
  const turns = rows.length;
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    sessions: sessions.size,
    turns,
    liveTurns,
    fallbackTurns,
    interruptions,
    reconnects,
    audioInSeconds: Math.round(inMs / 100) / 10,
    audioOutSeconds: Math.round(outMs / 100) / 10,
    voiceMinutes: Math.round((inMs + outMs) / 6000) / 10,
    fallbackRate: turns ? fallbackTurns / turns : 0,
    providerErrorRate: turns ? providerErrors / turns : 0,
    avgFirstAudioMs: avg(firstAudio),
    avgTurnMs: avg(total),
  };
}

export function formatRate(rate: number): string {
  return `%${(Math.round(rate * 1000) / 10).toLocaleString("tr-TR")}`;
}

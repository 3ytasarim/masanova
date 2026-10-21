"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveStrings } from "@/lib/ai/i18n";
import type { AiLanguage } from "@/lib/ai/language";
import type { LiveErrorCode, LiveTurnEvent } from "@/lib/ai/realtime";
import type { ActionCard, ProductCard, RecommendationBundle } from "@/lib/ai/types";
import { AudioPlaybackQueue, type QueueContext } from "@/lib/voice/audio-queue";
import { reconnectBackoff, SESSION_LIMITS } from "@/lib/voice/config";
import { newTurnKey, streamLiveTurn } from "@/lib/voice/live-client";
import { INITIAL_LIVE, liveReducer, type LiveEvent, type LiveMachine } from "@/lib/voice/live-session";
import { MicrophoneUnavailable, startCapture, type CaptureHandle, type CaptureMode, type Utterance } from "@/lib/voice/pcm-capture";
import { toBase64 } from "@/lib/voice/wav";

/**
 * Canlı sesli konuşma (istemci orkestrasyonu). Tek durum makinesi (live-session.ts) + tek AudioContext (yakalama ve
 * oynatma paylaşır; oturum bitince KAPATILIR).
 *
 *  - Tur: VAD ifadeyi bitirir → WAV → /asistan/canli (NDJSON) → metin cümle cümle, ses sırayla çalınır.
 *  - Araya girme: asistan konuşurken / düşünürken kullanıcı konuşmaya başlarsa (ya da "Sözü Kes"): nesil artar, istek
 *    iptal edilir, ses ANINDA durur, eski turun geç gelen parçaları atılır, kartları geçersizleşir, sunucuya rapor gider.
 *  - Yeniden bağlanma: akış "done" gelmeden koparsa AYNI tur anahtarıyla yeniden denenir (sunucu kaydı tekrar eder).
 *  - Yedek: sağlayıcı yoksa ya da art arda hata olursa bas-konuş moduna geçilir (bekleyen ifade kaybolmaz).
 *  - Hareketsizlik / en uzun oturum / sekme gizlenmesi / panel kapanması / cihaz kaybı → mikrofon kapanır.
 */
export type LiveReplyData = { messageId: string; actions: ActionCard[]; products: ProductCard[]; recommendation: RecommendationBundle | null };
export type PendingInput = { turnKey: string; audio?: Utterance; text?: string };

export type LiveCallbacks = {
  onTurnStart: (turnKey: string, input: { text?: string }) => void;
  onTranscript: (turnKey: string, text: string) => void;
  onLanguage: (language: AiLanguage) => void;
  onText: (turnKey: string, seq: number, text: string) => void;
  onActions: (turnKey: string, data: LiveReplyData) => void;
  onDone: (turnKey: string, data: { messageId: string; text: string; language: AiLanguage }) => void;
  /** Kesilen tur: kartları geçersiz. */
  onStale: (turnKey: string) => void;
  onFallback: (pending: PendingInput | null) => void;
  /** Konuşma kanıtı geçersiz → yeni oturum (başarılıysa true). */
  onConversationInvalid: () => Promise<boolean>;
  onError: (code: LiveErrorCode) => void;
};

type Options = {
  token: string;
  getProof: () => string;
  getContext: () => { cart: unknown[]; recentOrders: string[] };
  muted: boolean;
  strings: LiveStrings;
  callbacks: LiveCallbacks;
};

type Turn = { key: string; gen: number; audio: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useLiveVoice(options: Options) {
  const [machine, setMachine] = useState<LiveMachine>(INITIAL_LIVE);
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const machineRef = useRef<LiveMachine>(INITIAL_LIVE);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  const ctxRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<CaptureHandle | null>(null);
  const queueRef = useRef<AudioPlaybackQueue | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnRef = useRef<Turn | null>(null);
  const genRef = useRef(0);
  const failuresRef = useRef(0);
  const lastActivity = useRef(0);
  const startedAt = useRef(0);
  const levelEl = useRef<HTMLElement | null>(null);

  const send = useCallback((event: LiveEvent, message?: string | null) => {
    const next = liveReducer(machineRef.current, event);
    machineRef.current = message === undefined ? next : { ...next, message };
    setMachine(machineRef.current);
  }, []);
  const touch = () => {
    lastActivity.current = Date.now();
  };

  const report = useCallback((turnKey: string, playedMs: number, interrupted: boolean) => {
    const { token, getProof } = opts.current;
    void fetch(`/t/${token}/asistan/canli/rapor`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", "x-mn-ai-proof": getProof() },
      body: JSON.stringify({ turnKey, playedMs: Math.round(playedMs), interrupted }),
    }).catch(() => undefined);
  }, []);

  /** Devam eden turu bırak (araya girme / bitiş): nesil artar, istek iptal, ses durur. */
  const dropTurn = useCallback(
    (interrupted: boolean) => {
      genRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      const played = queueRef.current?.cancel() ?? 0;
      const turn = turnRef.current;
      turnRef.current = null;
      if (turn && interrupted) {
        opts.current.callbacks.onStale(turn.key);
        report(turn.key, played, true);
      }
    },
    [report],
  );

  const teardown = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    queueRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    if (levelEl.current) levelEl.current.style.setProperty("--level", "0");
  }, []);

  const end = useCallback(
    (message: string | null = null) => {
      dropTurn(machineRef.current.state === "ASSISTANT_SPEAKING" || machineRef.current.state === "THINKING");
      teardown();
      if (machineRef.current.state !== "IDLE" && machineRef.current.state !== "FALLBACK") send({ type: "END" }, message);
    },
    [dropTurn, send, teardown],
  );

  const fallback = useCallback(
    (pending: PendingInput | null) => {
      dropTurn(false);
      teardown();
      send({ type: "FALLBACK", message: opts.current.strings.fallback });
      opts.current.callbacks.onFallback(pending);
    },
    [dropTurn, send, teardown],
  );

  const bargeIn = useCallback(() => {
    const s = machineRef.current.state;
    if (s !== "ASSISTANT_SPEAKING" && s !== "THINKING" && s !== "RECONNECTING") return false;
    if (s === "RECONNECTING") send({ type: "RETRYING" });
    send({ type: "BARGE_IN" });
    dropTurn(true);
    send({ type: "INTERRUPTED" });
    touch();
    return true;
  }, [dropTurn, send]);

  const runTurn = useCallback(
    async (input: { audio?: Utterance; text?: string }) => {
      const turnKey = newTurnKey();
      const gen = ++genRef.current;
      const turn: Turn = { key: turnKey, gen, audio: false };
      turnRef.current = turn;
      const queue = queueRef.current;
      const qgen = queue?.begin() ?? 0;
      const cb = opts.current.callbacks;
      cb.onTurnStart(turnKey, { text: input.text });
      const { cart, recentOrders } = opts.current.getContext();
      const body = {
        turnKey,
        text: input.text ?? null,
        audio: input.audio ? { data: toBase64(input.audio.wav), mime: "audio/wav", durationMs: input.audio.durationMs } : null,
        muted: opts.current.muted,
        cart,
        recentOrders,
      };
      let lost = 0;
      const busySince = Date.now();
      let sessionRetried = false;
      for (;;) {
        const controller = new AbortController();
        abortRef.current = controller;
        const outcome = await streamLiveTurn({
          url: `/t/${opts.current.token}/asistan/canli`,
          proof: opts.current.getProof(),
          body,
          signal: controller.signal,
          onEvent: (e: LiveTurnEvent) => {
            if (gen !== genRef.current) return; // eski nesil: atılır
            switch (e.t) {
              case "transcript":
                cb.onTranscript(turnKey, e.text);
                break;
              case "language":
                cb.onLanguage(e.language);
                break;
              case "text":
                cb.onText(turnKey, e.seq, e.text);
                break;
              case "audio":
                if (!opts.current.muted && queue) {
                  turn.audio = true;
                  queue.enqueue(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)).buffer, qgen);
                }
                break;
              case "actions":
                cb.onActions(turnKey, e);
                break;
              case "done":
                cb.onDone(turnKey, { messageId: e.messageId, text: e.text, language: e.language });
                break;
            }
          },
        });
        if (gen !== genRef.current || outcome.kind === "aborted") return;
        if (outcome.kind === "done") {
          failuresRef.current = 0;
          abortRef.current = null;
          touch();
          send({ type: "TURN_DONE", speaking: turn.audio });
          queue?.end(qgen);
          if (!turn.audio) turnRef.current = null;
          return;
        }
        const reconnectable = outcome.kind === "lost" || (outcome.kind === "error" && outcome.code === "shutting_down");
        if (reconnectable && lost < SESSION_LIMITS.reconnectAttempts) {
          // Ağ kopması ya da sunucu yeniden başlatması: AYNI tur anahtarıyla üstel beklemeyle yeniden bağlan.
          send({ type: "STREAM_LOST" });
          await sleep(reconnectBackoff(lost));
          lost += 1;
          if (gen !== genRef.current) return;
          send({ type: "RETRYING" });
          continue;
        }
        if (outcome.kind === "error" && outcome.code === "in_progress" && Date.now() - busySince < SESSION_LIMITS.inProgressBudgetMs) {
          await sleep(SESSION_LIMITS.inProgressRetryMs);
          if (gen !== genRef.current) return;
          continue;
        }
        if (outcome.kind === "error" && outcome.code === "conversation_invalid" && !sessionRetried) {
          sessionRetried = true;
          if (await cb.onConversationInvalid()) continue;
        }
        // Başarısız tur.
        turnRef.current = null;
        abortRef.current = null;
        const code: LiveErrorCode = outcome.kind === "lost" || (outcome.kind === "error" && outcome.code === "shutting_down") ? "ai_failed" : outcome.code;
        const pending: PendingInput = { turnKey, audio: input.audio, text: input.text };
        if (code === "provider_unavailable") return fallback(pending);
        if (code === "feature_disabled" || code === "turn_limit") {
          cb.onError(code);
          return end();
        }
        if (code === "ai_failed") {
          failuresRef.current += 1;
          if (failuresRef.current >= SESSION_LIMITS.maxConsecutiveFailures) return fallback(pending);
        }
        cb.onError(code);
        send({ type: "TURN_DONE", speaking: false });
        return;
      }
    },
    [end, fallback, send],
  );

  const start = useCallback(async () => {
    if (!["IDLE", "ENDED", "ERROR", "READY"].includes(machineRef.current.state)) return;
    send({ type: "START" });
    // Kullanıcı dokunuşu içinde oluşturulur (otomatik oynatma kuralı).
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      send({ type: "CONNECT_FAILED", fallback: false, message: opts.current.strings.micUnavailable });
      return;
    }
    const ctx = new Ctor();
    ctxRef.current = ctx;
    void ctx.resume().catch(() => undefined);
    queueRef.current = new AudioPlaybackQueue(ctx as unknown as QueueContext, {
      onStart: () => send({ type: "AUDIO_STARTED" }),
      onIdle: (playedMs) => {
        const turn = turnRef.current;
        if (turn?.audio) report(turn.key, playedMs, false);
        turnRef.current = null;
        touch();
        send({ type: "AUDIO_DONE" });
      },
    });
    try {
      captureRef.current = await startCapture(ctx, {
        onSpeechStart: () => {
          touch();
          const s = machineRef.current.state;
          if (s === "ASSISTANT_SPEAKING" || s === "THINKING" || s === "RECONNECTING") bargeIn();
          send({ type: "SPEECH_START" });
        },
        onUtterance: (u) => {
          touch();
          if (machineRef.current.state !== "USER_SPEAKING") return;
          send({ type: "SPEECH_END" });
          void runTurn({ audio: u });
        },
        onLevel: (level) => levelEl.current?.style.setProperty("--level", level.toFixed(3)),
        onDeviceLost: () => {
          dropTurn(false);
          teardown();
          send({ type: "ERROR", message: opts.current.strings.micUnavailable });
        },
      });
    } catch (error) {
      teardown();
      const reason = error instanceof MicrophoneUnavailable ? error.reason : "denied";
      send({ type: "CONNECT_FAILED", fallback: false, message: reason === "unsupported" ? opts.current.strings.fallback : opts.current.strings.micUnavailable });
      return;
    }
    if (machineRef.current.state !== "CONNECTING") {
      // bu arada kapatıldı
      teardown();
      return;
    }
    setCaptureMode(captureRef.current?.mode ?? null);
    failuresRef.current = 0;
    startedAt.current = Date.now();
    touch();
    send({ type: "CONNECTED" });
  }, [bargeIn, dropTurn, report, runTurn, send, teardown]);

  const sendText = useCallback(
    (text: string) => {
      const s = machineRef.current.state;
      if (s === "ASSISTANT_SPEAKING" || s === "THINKING" || s === "RECONNECTING") bargeIn();
      send({ type: "TEXT_SUBMITTED" });
      touch();
      void runTurn({ text });
    },
    [bargeIn, runTurn, send],
  );

  // VAD hassasiyeti: asistan konuşurken yankıya karşı yüksek eşik.
  useEffect(() => {
    captureRef.current?.setMode(machine.state === "ASSISTANT_SPEAKING" ? "barge-in" : "normal");
  }, [machine.state]);

  // Sessize alındı → çalan ses durur (tur sürer, metin gelir).
  useEffect(() => {
    if (!options.muted || !queueRef.current) return;
    const played = queueRef.current.cancel();
    const turn = turnRef.current;
    if (turn?.audio) {
      report(turn.key, played, false);
      turnRef.current = null;
    }
    if (machineRef.current.state === "ASSISTANT_SPEAKING") send({ type: "AUDIO_DONE" });
  }, [options.muted, report, send]);

  // Hareketsizlik + en uzun oturum.
  const live = machine.state !== "IDLE" && machine.state !== "ENDED" && machine.state !== "FALLBACK" && machine.state !== "ERROR";
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (machineRef.current.state === "LISTENING" && now - lastActivity.current > SESSION_LIMITS.idleTimeoutMs) end(opts.current.strings.idleEnded);
      else if (startedAt.current && now - startedAt.current > SESSION_LIMITS.maxSessionMs) end(opts.current.strings.ended);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [live, end]);

  // Sekme gizlenince mikrofon kapanır (arka planda dinleme yok).
  useEffect(() => {
    if (!live) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") end(opts.current.strings.ended);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [live, end]);

  // Bileşen kalkarken her şey kapanır.
  useEffect(
    () => () => {
      genRef.current += 1;
      abortRef.current?.abort();
      captureRef.current?.stop();
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    },
    [],
  );

  const levelRef = useCallback((el: HTMLElement | null) => {
    levelEl.current = el;
  }, []);

  return { machine, live, start, end, interrupt: bargeIn, sendText, levelRef, captureMode };
}

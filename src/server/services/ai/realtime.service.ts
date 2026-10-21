import "server-only";
import { aiDirection, type AiLanguage } from "@/lib/ai/language";
import { AI_LIMITS } from "@/lib/ai/limits";
import type { LiveErrorCode, LiveTurnEvent, TurnMetrics } from "@/lib/ai/realtime";
import { splitSentences } from "@/lib/ai/stream-text";
import type { TrustedTableContext } from "@/lib/tenant/table-qr-context";
import { prisma } from "@/lib/db/prisma";
import { getProviders } from "@/server/services/ai/config";
import { appendTurn, findConversation } from "@/server/services/ai/conversation.service";
import { getVoiceAiAccess } from "@/server/services/ai/access.service";
import { rateLimit } from "@/server/rate-limit";
import { generateReply, prepareTurn, readUtterance, replyMetadata, speechAllowed, tableScope, type GeneratedReply, type TurnInput } from "@/server/services/ai/assistant.service";
import { getRealtimeProvider } from "@/server/services/ai/realtime/provider";
import { beginTurn, failTurn, reportTurn, startTurnHeartbeat } from "@/server/services/ai/turn.service";
import { recordUsage } from "@/server/services/ai/usage.service";
import { providerErrorCode } from "@/lib/observability/errors";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { isShuttingDown, onShutdown } from "@/server/lifecycle/shutdown";

/**
 * Bu süreçte işlenmekte olan canlı turlar. Kapanışta (deploy / PM2 reload) hepsi iptal edilir ve "yarıda kaldı"
 * (FAILED, errorCode=shutdown) olarak işaretlenir → istemcinin aynı anahtarla yeniden denemesi yeni süreçte turu HEMEN
 * yeniden sahiplenir (yinelenen tur yok, kayıtlı yanıt varsa yalnızca tekrar gönderilir).
 */
type ActiveTurn = { controller: AbortController; turnId: string };
const ACTIVE_KEY = Symbol.for("masanova.ai.active-turns");
function activeTurns(): Map<string, ActiveTurn> {
  const g = globalThis as typeof globalThis & { [ACTIVE_KEY]?: Map<string, ActiveTurn> };
  if (!g[ACTIVE_KEY]) {
    g[ACTIVE_KEY] = new Map();
    const turns = g[ACTIVE_KEY];
    onShutdown("ai.live-turns", 30, async () => {
      const list = [...turns.values()];
      for (const t of list) t.controller.abort(new Error("shutdown"));
      await prisma.aiTurn.updateMany({ where: { id: { in: list.map((t) => t.turnId) }, assistantMessageId: null }, data: { status: "FAILED", errorCode: "shutdown" } });
    });
  }
  return g[ACTIVE_KEY];
}

/**
 * Canlı sesli tur (POST /t/<token>/asistan/canli) — NDJSON akışı.
 *
 * Bas-konuş turuyla AYNI motor (kapı, kanıt, hız sınırı, dil kararı, bağlam, güvenli araçlar, güvenlik koruması);
 * fark yalnızca çıktının akması: yanıt cümle cümle gelir, her cümle korumadan geçtikten sonra metin olarak hemen,
 * ses olarak sırayla gönderilir. Eylem kartları yalnızca tur kaydedildikten (doğrulandıktan) sonra tek seferde gelir.
 *
 * İdempotency: tur anahtarı (conversation, turn_key) benzersizdir. Bağlantı koparsa istemci AYNI anahtarla yeniden dener;
 * kaydedilmiş tur yeniden ÜRETİLMEZ (metin + kartlar kayıttan, ses yok) → yinelenen mesaj / kullanım kaydı oluşmaz.
 *
 * Araya girme: istemci isteği iptal edince ses üretimi durur; yanıt metni yine de tamamlanıp kaydedilir (yeniden
 * bağlanmada tutarlı tekrar için). İstemci kesintiyi ayrıca /canli/rapor ile bildirir; o turun kartları geçersizleşir.
 */
export type LiveInput = TurnInput & { turnKey: string; muted: boolean };

const RETRYABLE: Partial<Record<LiveErrorCode, boolean>> = { rate_limited: true, in_progress: true, ai_failed: true, stt_failed: false, shutting_down: true };

export function runLiveTurn(ctx: TrustedTableContext, input: LiveInput, requestSignal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: LiveTurnEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          /* istemci zaten ayrıldı */
        }
      };
      const fail = (code: LiveErrorCode, retryable = RETRYABLE[code] ?? false) => {
        emit({ t: "error", code, retryable });
        close();
      };
      if (isShuttingDown()) return fail("shutting_down", true);
      try {
        await run(ctx, input, requestSignal, emit, fail, () => {
          // Test kancası: kayıttan sonra, "done" öncesi bağlantı kopması.
          open = false;
          try {
            controller.error(new Error("dropped"));
          } catch {
            /* yok say */
          }
        });
      } catch (error) {
        log.error("ai.live_turn_error", { code: "INTERNAL_ERROR", errorName: error instanceof Error ? error.name : "unknown" });
        fail("ai_failed");
        return;
      }
      close();
    },
  });
}

async function run(
  ctx: TrustedTableContext,
  input: LiveInput,
  requestSignal: AbortSignal,
  emit: (e: LiveTurnEvent) => void,
  fail: (code: LiveErrorCode, retryable?: boolean) => void,
  drop: () => void,
): Promise<void> {
  const started = Date.now();
  const prepared = await prepareTurn(ctx, input.proof, input.ip);
  if (!prepared.ok) return fail(prepared.error as LiveErrorCode);
  const env = prepared.env;
  const realtime = getRealtimeProvider();
  if (!realtime || !env.settings.voiceEnabled) return fail("provider_unavailable", false);

  const begun = await beginTurn(env.conversation, input.turnKey, "REALTIME");
  if (begun.kind === "in_progress") return fail("in_progress", true);
  if (begun.kind === "replay") {
    // Kaydedilmiş tur: yeniden üretim YOK (ses dahil) — kayıttan aynen gönderilir.
    const r = begun.reply;
    emit({ t: "accepted", turn: input.turnKey, attempt: begun.turn.attempts + 1 });
    if (r.transcript) emit({ t: "transcript", text: r.transcript, confidence: null });
    emit({ t: "language", language: r.language, direction: aiDirection(r.language), acknowledged: false });
    splitSentences(r.text).forEach((text, seq) => emit({ t: "text", seq, text }));
    emit({ t: "actions", messageId: r.messageId, actions: r.actions, products: r.products, recommendation: r.recommendation });
    emit({ t: "done", messageId: r.messageId, text: r.text, language: r.language, replayed: true, metrics: { sttMs: null, firstTextMs: null, firstAudioMs: null, totalMs: Date.now() - started } });
    return;
  }
  const turn = begun.turn;
  emit({ t: "accepted", turn: input.turnKey, attempt: turn.attempts });
  metrics.inc("voice.live_turns");
  if (turn.attempts > 1) metrics.inc("voice.reconnects");

  // Turun tamamı için üst süre + kapanış iptali → tüm sağlayıcı istekleri (STT / sohbet / TTS) birlikte iptal edilir.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), AI_LIMITS.timeouts.liveTurnMs);
  // Kalp atışı: işlenen tur "canlı" görünür; süreç ölürse en geç TURN_STALE_MS sonra başka süreç yeniden sahiplenir.
  const stopHeartbeat = startTurnHeartbeat(turn.id);
  activeTurns().set(turn.id, { controller, turnId: turn.id });
  const session = realtime.connect(controller.signal);
  const timedOut = () => controller.signal.aborted && controller.signal.reason instanceof Error && controller.signal.reason.message === "timeout";
  try {
    const read = await readUtterance(env, input, (args) => session.transcribe(args));
    if (!read.ok) {
      await failTurn(turn, read.error);
      return fail(read.error as LiveErrorCode);
    }
    if (!read.utterance) {
      await failTurn(turn, "stt_failed");
      return fail("stt_failed");
    }
    const sttDone = Date.now();
    const hook = session.testHook(read.utterance);
    if (hook?.down) {
      await failTurn(turn, "provider_unavailable");
      return fail("provider_unavailable", false);
    }
    emit({ t: "transcript", text: read.utterance, confidence: read.confidence ?? null });

    // Ses: cümleler sırayla seslendirilir; istek iptal edilirse (araya girme) yeni ses üretilmez.
    const voice = !input.muted && !!getProviders().tts && (await speechAllowed(env.conversation));
    let language: AiLanguage = env.current;
    let seq = 0;
    let firstTextMs: number | null = null;
    let firstAudioMs: number | null = null;
    let ttsChars = 0;
    let ttsFailed = false;
    let chain: Promise<void> = Promise.resolve();
    const speakQueued = (text: string, sentenceSeq: number, lang: AiLanguage) => {
      chain = chain.then(async () => {
        if (requestSignal.aborted || ttsFailed) return;
        try {
          const audio = await session.speak(text.slice(0, AI_LIMITS.maxTtsCharacters), lang, requestSignal);
          if (requestSignal.aborted) return;
          ttsChars += text.length;
          firstAudioMs ??= Date.now() - sttDone;
          emit({ t: "audio", seq: sentenceSeq, mime: audio.mimeType, data: Buffer.from(audio.audio).toString("base64") });
        } catch {
          // Ses üretilemezse tur metinle sürer (kullanıcı yanıtı okur); kalan cümleler için ses denenmez.
          if (!requestSignal.aborted) ttsFailed = true;
        }
      });
    };

    let reply: GeneratedReply;
    try {
      reply = await generateReply(
        env,
        { utterance: read.utterance, confidence: read.confidence ?? null, cart: input.cart, recentOrders: input.recentOrders },
        {
          onLanguage: (lang, switched) => {
            language = lang;
            if (switched) emit({ t: "language", language: lang, direction: aiDirection(lang), acknowledged: true });
          },
          onSentence: (sentence) => {
            const s = seq++;
            firstTextMs ??= Date.now() - sttDone;
            emit({ t: "text", seq: s, text: sentence });
            if (voice) speakQueued(sentence, s, language);
          },
          respond: (request, onDelta) => session.respond(request, onDelta),
        },
      );
    } catch (error) {
      const provider = getProviders().ai!;
      const code = timedOut() ? "AI_PROVIDER_TIMEOUT" : providerErrorCode(error instanceof Error ? error.message : undefined);
      metrics.inc("ai.failures", 1, code);
      if (code === "AI_PROVIDER_TIMEOUT") metrics.inc("ai.timeouts");
      log.warn("ai.live_turn_failed", { code, provider: provider.name, model: provider.model, latencyMs: Date.now() - sttDone, category: "chat" });
      await recordUsage({ tenantId: env.scope.tenantId, conversationId: env.conversation.id, kind: "CHAT", provider: provider.name, model: provider.model, latencyMs: Date.now() - sttDone, success: false, errorCode: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
      await failTurn(turn, "ai_failed");
      return fail("ai_failed", true);
    }

    // Kayıt: iki mesaj + tur tamamlanması tek işlemde. Eylem kartları ANCAK bundan sonra gönderilir.
    const metricsBase = { sttMs: sttDone - started, firstTextMs, audioInMs: read.audioMs ?? 0 };
    const messageId = await appendTurn(env.conversation, {
      userText: read.utterance,
      inputMode: read.mode,
      userLanguage: reply.decision?.detection.candidate ?? reply.language,
      reply: reply.text,
      replyLanguage: reply.language,
      metadata: replyMetadata(reply, { live: true }),
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
      turn: { id: turn.id, status: "COMPLETED", stats: { ...metricsBase, totalMs: Date.now() - started } },
    });
    if (reply.usedProvider) {
      const provider = getProviders().ai!;
      await recordUsage({ tenantId: env.scope.tenantId, conversationId: env.conversation.id, kind: "CHAT", provider: provider.name, model: provider.model, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, latencyMs: Date.now() - sttDone });
    }
    if (hook?.drop) {
      // Test: tur kaydedildi ama istemci "done" alamadı — yeniden bağlanma aynı anahtarla tekrar almalı.
      return drop();
    }
    const c = reply.collector;
    if (!requestSignal.aborted) emit({ t: "actions", messageId, actions: c?.actions ?? [], products: c?.products ?? [], recommendation: c?.recommendation ?? null });

    await chain;
    if (ttsChars > 0) {
      const tts = getProviders().tts!;
      await recordUsage({ tenantId: env.scope.tenantId, conversationId: env.conversation.id, kind: "TTS", provider: tts.name, model: tts.model, ttsCharacters: ttsChars, latencyMs: firstAudioMs ?? 0 });
    }
    const turnMetrics: TurnMetrics = { sttMs: metricsBase.sttMs, firstTextMs, firstAudioMs, totalMs: Date.now() - started };
    if (firstAudioMs !== null) await recordFirstAudio(turn.id, firstAudioMs, turnMetrics.totalMs);
    metrics.inc("ai.turns");
    metrics.observe("ai.live_turn_ms", turnMetrics.totalMs);
    if (firstAudioMs !== null) metrics.observe("ai.first_audio_ms", firstAudioMs);
    emit({ t: "done", messageId, text: reply.text, language: reply.language, replayed: false, metrics: turnMetrics });
  } finally {
    clearTimeout(timeout);
    stopHeartbeat();
    activeTurns().delete(turn.id);
    session.disconnect();
  }
}

async function recordFirstAudio(turnId: string, firstAudioMs: number, totalMs: number) {
  await prisma.aiTurn.update({ where: { id: turnId }, data: { firstAudioMs, totalMs } });
}

/** İstemci raporu: oynatılan ses süresi + araya girme (kesilen turun kartları geçersizleşir). */
export async function reportLiveTurn(ctx: TrustedTableContext, input: { proof: string | null; ip: string; turnKey: string; playedMs: number; interrupted: boolean }): Promise<{ ok: true } | { ok: false; error: "feature_disabled" | "conversation_invalid" | "rate_limited" | "not_found" }> {
  const { availability } = await getVoiceAiAccess(ctx.tenant.id);
  if (!availability.available) return { ok: false, error: "feature_disabled" };
  const conversation = await findConversation(tableScope(ctx), input.proof);
  if (!conversation) return { ok: false, error: "conversation_invalid" };
  if (!(await rateLimit("ai.report", conversation.id)).allowed) return { ok: false, error: "rate_limited" };
  return (await reportTurn(conversation, input.turnKey, input)) ? { ok: true } : { ok: false, error: "not_found" };
}

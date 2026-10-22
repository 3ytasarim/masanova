import "server-only";
import { readStoredPairings } from "@/lib/ai/pairings";
import { knowledgeIndex } from "@/lib/ai/knowledge";
import { getActiveKnowledge } from "@/server/services/ai/knowledge.service";
import { resolveEntitlements } from "@/server/billing/entitlements";
import type { Prisma } from "@prisma/client";
import { isMenuLocale } from "@/config/menu";
import { contextSummary, parseContext, updateContext, type ConversationContext } from "@/lib/ai/conversation-context";
import { aiDirection, decideLanguage, initialLanguage, LANGUAGE_ACKNOWLEDGEMENTS, type AiLanguage, type LanguageDecision } from "@/lib/ai/language";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { guardAssistantText, sanitizeUserText, USER_TEXT_MAX } from "@/lib/ai/safety";
import { SentenceBuffer } from "@/lib/ai/stream-text";
import { enabledTools, toolDefinitions } from "@/lib/ai/tools";
import type { AssistantErrorCode, AssistantReply, AssistantTurnResponse, ConversationSummary } from "@/lib/ai/types";
import type { ItemSelection } from "@/lib/orders/calculate";
import type { TrustedTableContext } from "@/lib/tenant/table-qr-context";
import { TRANSCRIPT_CONFIDENCE_MIN } from "@/lib/voice/config";
import { prisma } from "@/lib/db/prisma";
import { rateLimit, rateLimitAll } from "@/server/rate-limit";
import { RATE_LIMIT_POLICIES } from "@/server/rate-limit/policies";
import { getCachedPublicPresentation, getCachedPublishedMenu } from "@/server/services/public-menu/public-menu-cache";
import { toPublicMenuView } from "@/server/services/public-menu/serialize";
import { createMenuRefs } from "@/server/services/orders/menu-refs";
import { getProviders } from "@/server/services/ai/config";
import { getVoiceAiAccess, type EffectiveAiSettings } from "@/server/services/ai/access.service";
import { appendTurn, conversationSummary, countUserTurns, createConversation, findConversation, MAX_USER_TURNS, recentHistory, saveContext, type ConversationRow } from "@/server/services/ai/conversation.service";
import { createToolExecutor, type ToolCollector } from "@/server/services/ai/tools.service";
import { beginTurn, failTurn, startTurnHeartbeat } from "@/server/services/ai/turn.service";
import { recordUsage } from "@/server/services/ai/usage.service";
import { transcribe } from "@/server/services/voice/speech.service";

/**
 * Sesli asistan turu — ORTAK motor (bas-konuş Sprint 9 yolu ve Sprint 10 canlı yol aynı adımları kullanır):
 * kapı → konuşma kanıtı → hız sınırı → (tur idempotency) → (ses → STT, güven denetimi) → dil kararı + bağlam →
 * araçlı yanıt (isteğe bağlı akış; her cümle güvenlik korumasından geçer) → kayıt + kullanım.
 * Model hiçbir şeyi değiştirmez; eylem kartları yalnızca sunucunun doğruladığı araç sonuçlarından gelir.
 */
/** Politikalar src/server/rate-limit/policies.ts'te (Redis yoksa AI isteği güvenli biçimde reddedilir). */
export const RATE_LIMITS = {
  conversation: RATE_LIMIT_POLICIES["ai.conversation"],
  table: RATE_LIMIT_POLICIES["ai.table"],
  ip: RATE_LIMIT_POLICIES["ai.ip"],
  session: RATE_LIMIT_POLICIES["ai.session"],
  speech: RATE_LIMIT_POLICIES["ai.speech"],
} as const;

export const NUMBER_LOCALES: Record<AiLanguage, string> = { tr: "tr-TR", en: "en-GB", de: "de-DE", ar: "tr-TR", ru: "ru-RU" };

const GREETINGS: Record<AiLanguage, (name: string) => string> = {
  tr: (n) => `Merhaba, hoş geldiniz! Ben ${n}. Size nasıl yardımcı olabilirim?`,
  en: (n) => `Hello and welcome! I'm ${n}. How can I help you?`,
  de: (n) => `Hallo und willkommen! Ich bin ${n}. Wie kann ich Ihnen helfen?`,
  ar: (n) => `مرحبًا بكم! أنا ${n}. كيف يمكنني مساعدتك؟`,
  ru: (n) => `Здравствуйте и добро пожаловать! Я ${n}. Чем могу помочь?`,
};
const HOW_HELP: Record<AiLanguage, string> = { tr: "Size nasıl yardımcı olabilirim?", en: "How can I help you?", de: "Wie kann ich Ihnen helfen?", ar: "كيف يمكنني مساعدتك؟", ru: "Чем могу помочь?" };
/** Düşük güvenli konuşma metni: tahmin yok, araç yok — tekrar istenir. */
export const UNCLEAR: Record<AiLanguage, string> = {
  tr: "Sizi tam anlayamadım. Tekrar eder misiniz?",
  en: "Sorry, I didn't quite catch that. Could you say it again?",
  de: "Entschuldigung, das habe ich nicht verstanden. Könnten Sie es wiederholen?",
  ar: "عذرًا، لم أفهم جيدًا. هل يمكنك التكرار؟",
  ru: "Извините, не расслышал. Повторите, пожалуйста.",
};

export function tableScope(ctx: TrustedTableContext) {
  return { tenantId: ctx.tenant.id, branchId: ctx.branch.id, tableId: ctx.table.id };
}

async function tenantDefaultLocale(tenantId: string): Promise<string> {
  const s = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultLocale: true } });
  return s?.defaultLocale ?? "tr";
}

// ─── Oturum (başlat / sürdür) ───────────────────────────────────────────────

export type SessionResponse =
  | { ok: true; resumed: boolean; proof: string | null; conversation: ConversationSummary; realtime: boolean }
  | { ok: false; error: "feature_disabled" | "rate_limited" };

export async function startOrResumeSession(ctx: TrustedTableContext, input: { proof: string | null; uiLocale: string; ip: string; realtimeAvailable?: boolean }): Promise<SessionResponse> {
  const { availability, settings } = await getVoiceAiAccess(ctx.tenant.id);
  if (!availability.available) return { ok: false, error: "feature_disabled" };
  const scope = tableScope(ctx);
  const existing = await findConversation(scope, input.proof);
  const voiceEnabled = settings.voiceEnabled && !!getProviders().tts;
  const realtime = !!input.realtimeAvailable && settings.voiceEnabled;
  if (existing) return { ok: true, resumed: true, proof: null, conversation: await conversationSummary(existing, { assistantName: settings.assistantName, voiceEnabled }), realtime };

  if (
    !(
      await rateLimitAll([
        ["ai.session", scope.tableId],
        ["ai.ip", `session|${input.ip}`],
      ])
    ).allowed
  )
    return { ok: false, error: "rate_limited" };
  const tenantDefault = await tenantDefaultLocale(ctx.tenant.id);
  const language = initialLanguage(settings.defaultVoiceLanguage, tenantDefault);
  const greeting = settings.welcomeMessage && language === initialLanguage(null, tenantDefault) ? settings.welcomeMessage : GREETINGS[language](settings.assistantName);
  const { conversation, proof } = await createConversation(scope, { uiLocale: input.uiLocale, language, greeting });
  await recordUsage({ tenantId: ctx.tenant.id, conversationId: conversation.id, kind: "CONVERSATION", provider: getProviders().ai?.name ?? "none" });
  return { ok: true, resumed: false, proof, conversation: await conversationSummary(conversation, { assistantName: settings.assistantName, voiceEnabled }), realtime };
}

// ─── Ortak adımlar ─────────────────────────────────────────────────────────

export type TurnEnv = { ctx: TrustedTableContext; settings: EffectiveAiSettings; conversation: ConversationRow; scope: ReturnType<typeof tableScope>; current: AiLanguage };

/** Kapı + kanıt + hız sınırı + tur sınırı. Hız sınırı yeniden denemelerde de geçerli (canlı aktarım atlatamaz). */
export async function prepareTurn(ctx: TrustedTableContext, proof: string | null, ip: string): Promise<{ ok: true; env: TurnEnv } | { ok: false; error: AssistantErrorCode }> {
  const { availability, settings } = await getVoiceAiAccess(ctx.tenant.id);
  if (!availability.available) return { ok: false, error: "feature_disabled" };
  const scope = tableScope(ctx);
  const conversation = await findConversation(scope, proof);
  if (!conversation) return { ok: false, error: "conversation_invalid" };
  const limit = await rateLimitAll([
    ["ai.conversation", conversation.id],
    ["ai.table", scope.tableId],
    ["ai.ip", ip],
  ]);
  if (!limit.allowed) return { ok: false, error: "rate_limited" };
  if ((await countUserTurns(conversation)) >= MAX_USER_TURNS) return { ok: false, error: "turn_limit" };
  const current = (["tr", "en", "de", "ar", "ru"] as const).find((l) => l === conversation.conversationLanguage) ?? "tr";
  return { ok: true, env: { ctx, settings, conversation, scope, current } };
}

export type UtteranceInput = { text: string | null; audio: { bytes: Uint8Array; mimeType: string; clientDurationMs: number | null } | null };

/** Girdiyi metne çevir: ses → STT (güven puanı); yazı → temizle. */
export async function readUtterance(env: TurnEnv, input: UtteranceInput, via?: Parameters<typeof transcribe>[0]["via"]) {
  if (input.audio) {
    const r = await transcribe({ tenantId: env.scope.tenantId, conversationId: env.conversation.id, audio: input.audio.bytes, mimeType: input.audio.mimeType, clientDurationMs: input.audio.clientDurationMs, languageHint: env.current, via });
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, utterance: sanitizeUserText(r.text), mode: "VOICE" as const, confidence: r.confidence, audioMs: r.durationMs };
  }
  const raw = input.text ?? "";
  if (raw.length > USER_TEXT_MAX * 2) return { ok: false as const, error: "too_long" as const };
  return { ok: true as const, utterance: sanitizeUserText(raw), mode: "TEXT" as const, confidence: null, audioMs: 0 };
}

async function buildView(ctx: TrustedTableContext, language: AiLanguage) {
  const presentation = await getCachedPublicPresentation(ctx.scope);
  const locale = isMenuLocale(language) ? language : isMenuLocale(presentation.defaultLocale) ? presentation.defaultLocale : "tr";
  const menu = await getCachedPublishedMenu(ctx.scope, { branchId: ctx.branch.id, locale });
  return toPublicMenuView(menu, presentation, { table: { name: ctx.table.name, area: ctx.area?.name ?? null }, refOf: createMenuRefs(ctx.tenant.id), ordering: null });
}

function menuDigest(view: Awaited<ReturnType<typeof buildView>>): string {
  const categories = view.categories.map((c) => c.name).join(", ");
  const featured = view.categories.flatMap((c) => c.products).filter((p) => view.featuredKeys.includes(p.key)).map((p) => p.name).slice(0, 5).join(", ");
  return `Kategoriler: ${categories}.${featured ? ` Restoranın öne çıkardıkları: ${featured}.` : ""} Ürün ayrıntısı için araçları kullan.`;
}

export type GeneratedReply = {
  text: string;
  language: AiLanguage;
  decision: LanguageDecision | null;
  collector: ToolCollector | null;
  inputTokens: number;
  outputTokens: number;
  usedProvider: boolean;
  unclear: boolean;
};

/**
 * Yanıt üret. `onSentence` verilirse yanıt cümle cümle (güvenlik korumasından geçmiş) bildirilir — canlı yol bunları
 * seslendirir; aksi halde tek seferde. Düşük güvenli konuşma metninde araç / model çağrılmaz.
 */
export async function generateReply(
  env: TurnEnv,
  input: { utterance: string; confidence: number | null; cart: { key: string; selection: ItemSelection }[]; recentOrders: string[] },
  stream?: { onSentence: (sentence: string) => void; onLanguage?: (language: AiLanguage, switched: boolean) => void; respond: (request: Parameters<NonNullable<ReturnType<typeof getProviders>["ai"]>["complete"]>[0], onDelta: (d: string) => void) => Promise<{ text: string; inputTokens: number; outputTokens: number }> },
): Promise<GeneratedReply> {
  const { ctx, settings, conversation, scope, current } = env;
  const say = (text: string) => {
    stream?.onSentence(text);
    return text;
  };

  if (input.confidence !== null && input.confidence < TRANSCRIPT_CONFIDENCE_MIN) {
    return { text: say(UNCLEAR[current]), language: current, decision: null, collector: null, inputTokens: 0, outputTokens: 0, usedProvider: false, unclear: true };
  }

  const decision = decideLanguage(input.utterance, current);
  const language = decision.language;
  stream?.onLanguage?.(language, decision.switched);
  // Bağlam (kişi, bütçe, diyet, acı) her ifadeden güncellenir ve hemen kaydedilir — tur kesilse de korunur.
  const previous = parseContext(conversation.context);
  const { context, constraintOnly } = updateContext(previous, input.utterance);
  if (JSON.stringify(context) !== JSON.stringify(previous)) {
    await saveContext(conversation, context as unknown as Prisma.InputJsonValue);
    conversation.context = context as unknown as Prisma.JsonValue;
  }

  const wordCount = input.utterance.split(/\s+/).length;
  if (decision.switched && decision.detection.explicitSwitch && wordCount <= 7) {
    // Saf dil değişimi — model çağrısı yok; onay bir kez.
    return { text: [say(LANGUAGE_ACKNOWLEDGEMENTS[language]), say(HOW_HELP[language])].join(" "), language, decision, collector: null, inputTokens: 0, outputTokens: 0, usedProvider: false, unclear: false };
  }
  if (decision.clarification) return { text: say(decision.clarification), language, decision, collector: null, inputTokens: 0, outputTokens: 0, usedProvider: false, unclear: false };

  const view = await buildView(ctx, language);
  const [knowledge, entitlements] = await Promise.all([getActiveKnowledge(), resolveEntitlements(ctx.tenant.id)]);
  const executor = createToolExecutor({
    order: { tenantId: scope.tenantId, branchId: scope.branchId, tableId: scope.tableId, tokenId: ctx.token.id, branchName: ctx.branch.name, tableName: ctx.table.name, areaName: ctx.area?.name ?? null, defaultLocale: view.defaultLocale },
    view,
    numberLocale: NUMBER_LOCALES[language],
    settings,
    cart: input.cart,
    recentOrders: input.recentOrders,
    context: context as ConversationContext,
    knowledge,
    pairings: readStoredPairings(settings.pairings),
  });
  const summary = contextSummary(context);
  const request = {
    system:
      buildSystemPrompt({
        restaurantName: ctx.tenant.name,
        branchName: ctx.branch.name,
        tableName: ctx.table.name,
        assistantName: settings.assistantName,
        tone: settings.tone,
        customInstructions: settings.customInstructions,
        language,
        currency: view.categories.flatMap((c) => c.products)[0]?.currency ?? "TRY",
        menuDigest: menuDigest(view),
        knowledge: knowledgeIndex(knowledge),
      }) + (summary ? `\n\nKONUŞMA BAĞLAMI (güvenilir özet): ${summary}. Müşteri önceki öneriye kısıt eklerse öneriyi bu bağlamla getRecommendationCandidates ile yenile.` : ""),
    history: await recentHistory(conversation),
    utterance: input.utterance,
    language,
    tools: toolDefinitions(enabledTools(settings, { ordering: entitlements.has("ordering"), service: entitlements.has("service_requests") })),
    executeTool: (name: Parameters<typeof executor.execute>[0], args: unknown) => executor.execute(name, args),
    hints: { constraintFollowUp: constraintOnly },
  };
  const ack = decision.switched ? LANGUAGE_ACKNOWLEDGEMENTS[language] : null;
  if (!stream) {
    const provider = getProviders().ai!;
    const result = await provider.complete(request);
    if (!result.text.trim()) throw new Error("empty");
    return { text: (ack ? `${ack} ` : "") + guardAssistantText(result.text, language), language, decision, collector: executor.collector, inputTokens: result.inputTokens, outputTokens: result.outputTokens, usedProvider: true, unclear: false };
  }
  // Akış: dil onayı → cümle cümle (her biri korumadan geçer)
  const spoken: string[] = [];
  if (ack) spoken.push(say(ack));
  const buffer = new SentenceBuffer();
  const emit = (raw: string) => {
    const safe = guardAssistantText(raw, language);
    if (safe.trim()) spoken.push(say(safe));
  };
  const result = await stream.respond(request, (delta) => buffer.push(delta).forEach(emit));
  const tail = buffer.flush();
  if (tail) emit(tail);
  if (!result.text.trim()) throw new Error("empty");
  return { text: spoken.join(" "), language, decision, collector: executor.collector, inputTokens: result.inputTokens, outputTokens: result.outputTokens, usedProvider: true, unclear: false };
}

export function replyMetadata(reply: GeneratedReply, extra: Record<string, unknown> = {}): Prisma.InputJsonValue {
  const c = reply.collector;
  return { actions: c?.actions ?? [], products: c?.products ?? [], recommendation: c?.recommendation ?? null, tools: c?.toolCalls ?? [], unclear: reply.unclear, ...extra } as unknown as Prisma.InputJsonValue;
}

// ─── Bas-konuş turu (Sprint 9 yolu; Sprint 10'da yedek) ─────────────────────

export type TurnInput = UtteranceInput & {
  proof: string | null;
  ip: string;
  cart: { key: string; selection: ItemSelection }[];
  recentOrders: string[];
  /** İsteğe bağlı tur anahtarı: yeniden denemede yinelenen mesaj / kullanım kaydı oluşmaz. */
  turnKey?: string | null;
};

const fail = (error: AssistantErrorCode): AssistantTurnResponse => ({ ok: false, error });

export async function runTurn(ctx: TrustedTableContext, input: TurnInput): Promise<AssistantTurnResponse> {
  const prepared = await prepareTurn(ctx, input.proof, input.ip);
  if (!prepared.ok) return fail(prepared.error);
  const env = prepared.env;
  const speakable = env.settings.voiceEnabled && !!getProviders().tts;

  let turn: Awaited<ReturnType<typeof beginTurn>> | null = null;
  if (input.turnKey) {
    turn = await beginTurn(env.conversation, input.turnKey, "FALLBACK");
    if (turn.kind === "in_progress") return fail("rate_limited");
    if (turn.kind === "replay") {
      const r = turn.reply;
      return { ok: true, transcript: r.transcript, languageSwitched: false, reply: { messageId: r.messageId, text: r.text, language: r.language, direction: aiDirection(r.language), actions: r.actions, products: r.products, recommendation: r.recommendation, speakable } };
    }
  }
  const stopHeartbeat = turn?.kind === "new" ? startTurnHeartbeat(turn.turn.id) : () => undefined;
  try {
    const started = Date.now();
    const read = await readUtterance(env, input);
    if (!read.ok) {
      if (turn?.kind === "new") await failTurn(turn.turn, read.error);
      return fail(read.error);
    }
    if (!read.utterance) {
      if (turn?.kind === "new") await failTurn(turn.turn, "stt_failed");
      return fail(read.mode === "VOICE" ? "stt_failed" : "too_long");
    }

    let reply: GeneratedReply;
    const provider = getProviders().ai!;
    try {
      reply = await generateReply(env, { utterance: read.utterance, confidence: read.confidence ?? null, cart: input.cart, recentOrders: input.recentOrders });
    } catch (error) {
      await recordUsage({ tenantId: env.scope.tenantId, conversationId: env.conversation.id, kind: "CHAT", provider: provider.name, model: provider.model, latencyMs: Date.now() - started, success: false, errorCode: error instanceof Error ? error.message.slice(0, 40) : "unknown" });
      if (turn?.kind === "new") await failTurn(turn.turn, "ai_failed");
      return fail("ai_failed");
    }

    const messageId = await appendTurn(env.conversation, {
      userText: read.utterance,
      inputMode: read.mode,
      userLanguage: reply.decision?.detection.candidate ?? reply.language,
      reply: reply.text,
      replyLanguage: reply.language,
      metadata: replyMetadata(reply),
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
      ...(turn?.kind === "new" ? { turn: { id: turn.turn.id, status: "COMPLETED" as const, stats: { totalMs: Date.now() - started, audioInMs: read.audioMs ?? 0 } } } : {}),
    });
    await recordUsage({ tenantId: env.scope.tenantId, conversationId: env.conversation.id, kind: "CHAT", provider: provider.name, model: provider.model, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, latencyMs: Date.now() - started });

    const c = reply.collector;
    const out: AssistantReply = {
      messageId,
      text: reply.text,
      language: reply.language,
      direction: aiDirection(reply.language),
      actions: c?.actions ?? [],
      products: c?.products ?? [],
      recommendation: c?.recommendation ?? null,
      speakable,
    };
    return { ok: true, transcript: read.mode === "VOICE" ? read.utterance : null, languageSwitched: !!reply.decision?.switched, reply: out };
  } finally {
    stopHeartbeat();
  }
}

/** Ses için hız sınırı (konuşma başına). */
export async function speechAllowed(conversation: ConversationRow): Promise<boolean> {
  return (await rateLimit("ai.speech", conversation.id)).allowed;
}

export type { EffectiveAiSettings };

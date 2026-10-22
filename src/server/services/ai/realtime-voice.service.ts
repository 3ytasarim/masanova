import "server-only";
import { readStoredPairings } from "@/lib/ai/pairings";
import { knowledgeIndex } from "@/lib/ai/knowledge";
import { getActiveKnowledge } from "@/server/services/ai/knowledge.service";
import { isMenuLocale } from "@/config/menu";
import { parseContext, type ConversationContext } from "@/lib/ai/conversation-context";
import { isAiLanguage, type AiLanguage } from "@/lib/ai/language";
import { guardAssistantText, sanitizeUserText } from "@/lib/ai/safety";
import { flattenMenu } from "@/lib/ai/menu-match";
import { heardSupports, isAffirmative, matchProduct, resolveSpokenProduct } from "@/lib/ai/voice-lexicon";
import { refreshVoiceIndexIfStale, runtimeLexicon } from "@/server/services/ai/voice-index.service";
import {
  buildRealtimeInstructions,
  enabledRealtimeTools,
  greetingInstruction,
  isRealtimeToolName,
  menuOverview,
  parseRealtimeArgs,
  realtimeToolDefinitions,
  resolveSelection,
} from "@/lib/ai/realtime-voice";
import type { CartLinePayload } from "@/lib/ai/types";
import type { ItemSelection } from "@/lib/orders/calculate";
import type { TrustedTableContext } from "@/lib/tenant/table-qr-context";
import { getServerEnv } from "@/lib/env";
import { formatMoney } from "@/lib/menu/money";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import { rateLimit, rateLimitAll } from "@/server/rate-limit";
import { resolveEntitlements } from "@/server/billing/entitlements";
import { getCachedPublicPresentation, getCachedPublishedMenu } from "@/server/services/public-menu/public-menu-cache";
import { toPublicMenuView } from "@/server/services/public-menu/serialize";
import { createMenuRefs } from "@/server/services/orders/menu-refs";
import { prisma } from "@/lib/db/prisma";
import { getVoiceAiAccess } from "@/server/services/ai/access.service";
import { NUMBER_LOCALES, startOrResumeSession, tableScope } from "@/server/services/ai/assistant.service";
import { appendTurn, findConversation } from "@/server/services/ai/conversation.service";
import { createToolExecutor } from "@/server/services/ai/tools.service";
import { beginTurn } from "@/server/services/ai/turn.service";
import { recordUsage } from "@/server/services/ai/usage.service";

/**
 * Sesten sese canlı garson (OpenAI Realtime, WebRTC).
 *
 *  1) mintRealtimeSession: kapı (paket + ayar + limit) → konuşma (kanıt) → menü kataloğu + talimat + araçlar → OpenAI'dan
 *     KISA ÖMÜRLÜ istemci anahtarı (1 dk içinde bağlanılmalı). Asıl API anahtarı tarayıcıya ASLA gitmez.
 *  2) runRealtimeTool: model araç çağırınca tarayıcı buraya iletir; araç sunucuda güvenilir menüyle çalışır. Sepete ekleme
 *     / servis / sipariş "etkisi" döner — tarayıcı mevcut sepet / servis / sipariş iş mantığıyla uygular (sunucu yine doğrular).
 *  3) recordRealtimeTurn: tamamlanan her konuşma turu kayıt + kullanım (tur, dakika limiti, panel geçmişi).
 */
export const REALTIME_DEFAULT_MODEL = "gpt-realtime";
export const REALTIME_DEFAULT_VOICE = "marin";
const CLIENT_SECRET_TTL_S = 60;

export function realtimeConfig(): { apiKey: string; model: string; voice: string; transcribeModel: string } | null {
  const env = getServerEnv();
  if (env.VOICE_REALTIME === "off" || env.AI_PROVIDER !== "openai" || !env.AI_API_KEY) return null;
  return { apiKey: env.AI_API_KEY, model: env.VOICE_REALTIME_MODEL || REALTIME_DEFAULT_MODEL, voice: env.VOICE_REALTIME_VOICE || REALTIME_DEFAULT_VOICE, transcribeModel: env.VOICE_STT_MODEL || "gpt-4o-mini-transcribe" };
}

async function buildView(ctx: TrustedTableContext, language: string) {
  const presentation = await getCachedPublicPresentation(ctx.scope);
  const locale = isMenuLocale(language) ? language : isMenuLocale(presentation.defaultLocale) ? presentation.defaultLocale : "tr";
  const menu = await getCachedPublishedMenu(ctx.scope, { branchId: ctx.branch.id, locale });
  return toPublicMenuView(menu, presentation, { table: { name: ctx.table.name, area: ctx.area?.name ?? null }, refOf: createMenuRefs(ctx.tenant.id), ordering: null });
}

export type MintResult =
  | { ok: true; clientSecret: string; expiresAt: number; model: string; proof: string | null; greeting: string; assistantName: string; restaurantName: string; ordering: boolean }
  | { ok: false; error: "feature_disabled" | "rate_limited" | "provider_unavailable" | "provider_failed" };

export async function mintRealtimeSession(ctx: TrustedTableContext, input: { proof: string | null; uiLocale: string; ip: string }): Promise<MintResult> {
  const config = realtimeConfig();
  if (!config) return { ok: false, error: "provider_unavailable" };
  const [{ availability, settings }, ent] = await Promise.all([getVoiceAiAccess(ctx.tenant.id), resolveEntitlements(ctx.tenant.id)]);
  // Paket kapısı (access.service ile aynı kanonik çözücü; burada açıkça da denetlenir).
  if (!ent.has("voice_ai") || !availability.available || !settings.voiceEnabled) return { ok: false, error: "feature_disabled" };
  // Her bağlantı ücretli bir ses oturumu açar → masa + IP başına sınır (yeni konuşma sınırından ayrı).
  if (!(await rateLimitAll([["ai.realtime.table", ctx.table.id], ["ai.realtime.ip", input.ip]])).allowed) return { ok: false, error: "rate_limited" };
  const session = await startOrResumeSession(ctx, { proof: input.proof, uiLocale: input.uiLocale, ip: input.ip, realtimeAvailable: true });
  if (!session.ok) return { ok: false, error: session.error };

  // Menü değiştiyse sesli menü dizini arka planda yenilenir (QR bağlamının güvenilir kapsamıyla; oturum beklemez).
  refreshVoiceIndexIfStale(ctx.scope);
  const view = await buildView(ctx, "tr");
  const ordering = ent.has("ordering");
  const service = ent.has("service_requests");
  const products = view.categories.flatMap((c) => c.products);
  const instructions = buildRealtimeInstructions({
    restaurantName: ctx.tenant.name,
    tableName: ctx.table.name,
    assistantName: settings.assistantName,
    tone: settings.tone,
    customInstructions: settings.customInstructions,
    currency: products[0]?.currency ?? "TRY",
    catalog: menuOverview(flattenMenu(view)),
    ordering,
    service,
    knowledge: knowledgeIndex(await getActiveKnowledge()),
  });
  const tools = realtimeToolDefinitions(enabledRealtimeTools(settings, ordering, service));
  // Tanıma ipucu: ürün adları (yabancı adların Türkçe söylenişi dahil daha iyi tanınır). Kısa tutulur.
  const vocabulary = products.map((p) => p.name).join(", ").slice(0, 800);
  const started = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_S },
        session: {
          type: "realtime",
          model: config.model,
          instructions,
          output_modalities: ["audio"],
          max_output_tokens: 1024,
          audio: {
            input: {
              noise_reduction: { type: "far_field" },
              transcription: { model: config.transcribeModel, prompt: `Menü: ${vocabulary}` },
              turn_detection: { type: "semantic_vad", eagerness: "high", create_response: true, interrupt_response: true },
            },
            output: { voice: config.voice },
          },
          tools,
          tool_choice: "auto",
        },
      }),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      log.warn("ai.realtime_mint_failed", { code: `http_${res.status}`, model: config.model, latencyMs: Date.now() - started });
      metrics.inc("ai.failures", 1, "REALTIME_MINT");
      return { ok: false, error: "provider_failed" };
    }
    const json = (await res.json()) as { value?: string; expires_at?: number };
    if (!json.value) return { ok: false, error: "provider_failed" };
    metrics.inc("voice.realtime_sessions");
    return {
      ok: true,
      clientSecret: json.value,
      expiresAt: json.expires_at ?? Math.floor(Date.now() / 1000) + CLIENT_SECRET_TTL_S,
      model: config.model,
      proof: session.proof,
      greeting: greetingInstruction({ restaurantName: ctx.tenant.name, welcomeMessage: settings.welcomeMessage }),
      assistantName: settings.assistantName,
      restaurantName: ctx.tenant.name,
      ordering,
    };
  } catch (error) {
    log.warn("ai.realtime_mint_failed", { code: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network", model: config.model, latencyMs: Date.now() - started });
    return { ok: false, error: "provider_failed" };
  }
}

// ─── Araçlar ─────────────────────────────────────────────────────────────────

export type ToolEffect =
  | { kind: "add"; line: CartLinePayload }
  | { kind: "change"; product: string; quantity: number }
  | { kind: "service"; type: "WAITER" | "WATER" | "NAPKIN" | "BILL" }
  | { kind: "review" }
  | { kind: "place" };

export type ToolResponse = { ok: true; output: Record<string, unknown>; effect: ToolEffect | null } | { ok: false; error: "conversation_invalid" | "feature_disabled" | "rate_limited" };

export async function runRealtimeTool(
  ctx: TrustedTableContext,
  input: { proof: string | null; ip: string; name: string; args: unknown; cart: { key: string; selection: ItemSelection }[]; recentOrders: string[]; heard?: string },
): Promise<ToolResponse> {
  const [{ availability, settings }, ent] = await Promise.all([getVoiceAiAccess(ctx.tenant.id), resolveEntitlements(ctx.tenant.id)]);
  if (!ent.has("voice_ai") || !availability.available) return { ok: false, error: "feature_disabled" };
  const scope = tableScope(ctx);
  const conversation = await findConversation(scope, input.proof);
  if (!conversation) return { ok: false, error: "conversation_invalid" };
  if (!(await rateLimit("ai.tool", conversation.id)).allowed) return { ok: false, error: "rate_limited" };
  const ordering = ent.has("ordering");
  const name = input.name;
  if (!isRealtimeToolName(name) || !enabledRealtimeTools(settings, ordering, ent.has("service_requests")).includes(name)) return { ok: true, output: { ok: false, error: "unknown_tool" }, effect: null };

  const view = await buildView(ctx, "tr");
  const language: AiLanguage = isAiLanguage(conversation.conversationLanguage) ? conversation.conversationLanguage : "tr";
  const executor = createToolExecutor({
    order: { tenantId: scope.tenantId, branchId: scope.branchId, tableId: scope.tableId, tokenId: ctx.token.id, branchName: ctx.branch.name, tableName: ctx.table.name, areaName: ctx.area?.name ?? null, defaultLocale: view.defaultLocale },
    view,
    numberLocale: NUMBER_LOCALES[language],
    settings,
    cart: input.cart,
    recentOrders: input.recentOrders,
    context: parseContext(conversation.context) as ConversationContext,
    knowledge: await getActiveKnowledge(),
    pairings: readStoredPairings(settings.pairings),
  });
  const money = (minor: number) => formatMoney(minor, executor.products[0]?.currency ?? "TRY", NUMBER_LOCALES[language]);
  // Ürün adı çözümü YALNIZCA sesli menü sözlüğüyle (canlı menü + doğrulanmış söyleyişler); model ad çözmez.
  const lexicon = await runtimeLexicon(ctx.tenant.id, executor.products);
  const resolve = (phrase: string) => resolveSpokenProduct(lexicon, executor.products, phrase);
  const done = (output: Record<string, unknown>, effect: ToolEffect | null = null): ToolResponse => ({ ok: true, output, effect });

  switch (name) {
    case "findMenuItems": {
      const a = parseRealtimeArgs(name, input.args);
      if (!a) return done({ ok: false, error: "invalid_arguments" });
      const r = matchProduct(lexicon, a.query, 5);
      if (r.status === "none") return done({ ok: false, reason: "not_on_menu", say: "Menümüzde bu isimde bir ürün bulamadım." });
      if (r.status === "low") return done({ ok: false, needs: "repeat", say: "Tam anlayamadım; ürünün adını tekrar eder misiniz?" });
      // Yalnızca en uygun adaylar (tam menü değil) — güvenilir ürün verisiyle.
      const items = r.candidates
        .map((c) => executor.products.find((p) => p.key === c.productKey))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({
          name: p.name,
          category: p.categoryName,
          price: p.priceLabel,
          soldOut: p.soldOut,
          variants: p.variants.map((v) => `${v.name} ${v.priceLabel}`),
          requiredChoices: p.modifierGroups.filter((g) => g.required || g.minSelect > 0).map((g) => `${g.name}: ${g.modifiers.map((m) => m.name).join(", ")}`),
          description: p.shortDescription,
        }));
      const match = r.status === "high" ? "exact" : r.status === "medium" ? "confirm" : r.status === "ambiguous" ? "choose" : r.status;
      return done({ ok: true, match, items, hint: match === "confirm" ? "İlk ürünü kastettiğini doğrula." : match === "choose" ? "Hangisi olduğunu sor." : undefined });
    }
    case "searchMenu":
    case "getProductDetails":
    case "getRecommendationCandidates":
    case "getGuidance":
    case "planMealByCalories":
    case "getPairings":
    case "getOrderStatus": {
      // getProductDetails: konuşulan ad (çizburger) menü adına çevrilir.
      let args = input.args;
      if (name === "getProductDetails") {
        const a = parseRealtimeArgs(name, input.args);
        if (!a) return done({ ok: false, error: "invalid_arguments" });
        const r = resolve(a.product);
        if (!r.ok) return done(r.output);
        args = { product: r.product.key };
      }
      return done((await executor.execute(name, args)) as unknown as Record<string, unknown>);
    }
    case "addToCart": {
      const a = parseRealtimeArgs(name, input.args);
      if (!a) return done({ ok: false, error: "invalid_arguments" });
      const r = resolve(a.product);
      if (!r.ok) return done(r.output);
      const p = r.product;
      // Model adı kendisi "düzeltmiş" olabilir: müşterinin GERÇEKTE söylediği bu ürünü güçlü desteklemiyorsa onay sorulur.
      // Onay bayrağı yalnızca müşterinin son sözü gerçekten bir onaysa geçerlidir (model kendi kendine onaylayamaz).
      // Son İKİ söz birlikte: "bir çipura" → (garson: deniz mi ızgara mı?) → "ızgara olsun" cevabı ürünü destekler.
      const lastHeard = input.heard?.split(" | ").slice(-2).join(" ").trim();
      if (lastHeard) {
        const support = heardSupports(lexicon, lastHeard, p.key);
        const confirmedNow = a.confirmed === true && isAffirmative(input.heard?.split(" | ").pop() ?? "");
        if (support !== "strong" && !confirmedNow)
          return done({ ok: false, needs: "confirm", candidate: p.name, say: `«${p.name}» mı demek istediniz?`, hint: "Müşteri evet derse addToCart'ı aynı ürünle confirmed: true ile tekrar çağır." });
      }
      const sel = resolveSelection(p, { phrase: a.product, variant: a.variant, options: a.options, heard: input.heard });
      if (!sel.ok) return done({ name: p.name, ...sel, hint: "Müşteriye seçenekleri kısaca sor, cevabına göre addToCart'ı tekrar çağır." });
      const unit = (sel.variant ? sel.variant.priceMinor : p.basePriceMinor) + sel.modifiers.reduce((s, m) => s + m.priceDeltaMinor, 0);
      const detail = [p.variants.length > 1 && sel.variant ? sel.variant.name : null, ...sel.modifiers.map((m) => m.name)].filter(Boolean).join(", ");
      const note = a.note ? sanitizeUserText(a.note).slice(0, 120) || null : null;
      const line: CartLinePayload = { product: p.key, variant: sel.variant?.ref ?? null, modifiers: sel.modifiers.map((m) => ({ group: m.group, modifier: m.modifier })), quantity: a.quantity, note, unitPriceMinor: unit, name: p.name, detail };
      return done({ ok: true, added: true, name: p.name, detail, quantity: a.quantity, lineTotal: money(unit * a.quantity) }, { kind: "add", line });
    }
    case "updateCartItem": {
      const a = parseRealtimeArgs(name, input.args);
      if (!a) return done({ ok: false, error: "invalid_arguments" });
      const r = resolve(a.product);
      // Tükenen ürün de sepetten çıkarılabilir / adedi değiştirilebilir.
      const p = r.ok ? r.product : r.status === "sold_out" ? (executor.products.find((x) => x.name === r.output.name) ?? null) : null;
      if (!p || !input.cart.some((c) => c.selection.product === p.key)) return done({ ok: false, reason: "not_in_cart" });
      return done({ ok: true, name: p.name, quantity: a.quantity }, { kind: "change", product: p.key, quantity: a.quantity });
    }
    case "reviewOrder": {
      if (!input.cart.length) return done({ ok: false, reason: "cart_empty" });
      const summary = (await executor.execute("getCartSummary", {})) as unknown as { lines: { name: string; quantity: number; lineTotalLabel: string; status: string }[]; totalLabel: string };
      const blocked = summary.lines.filter((l) => l.status !== "ok" && l.status !== "price_changed");
      return done({ ok: true, lines: summary.lines, total: summary.totalLabel, unavailable: blocked.map((l) => l.name), hint: "Özeti tek cümleyle oku ve onay iste." }, { kind: "review" });
    }
    case "placeOrder": {
      const a = parseRealtimeArgs(name, input.args);
      if (!a) return done({ ok: false, error: "confirmation_required" });
      if (!input.cart.length) return done({ ok: false, reason: "cart_empty" });
      // Gönderimi tarayıcı MEVCUT sipariş eylemiyle yapar (aynı doğrulama / hız sınırı / panel); sonuç modele iletilir.
      return done({ ok: true, pending: true }, { kind: "place" });
    }
    case "callService": {
      const a = parseRealtimeArgs(name, input.args);
      if (!a) return done({ ok: false, error: "invalid_arguments" });
      return done({ ok: true, pending: true, type: a.type }, { kind: "service", type: a.type });
    }
  }
}

// ─── Tur kaydı ───────────────────────────────────────────────────────────────

export type RealtimeTurnInput = {
  proof: string | null;
  turnKey: string;
  userText: string;
  reply: string;
  inputTokens: number;
  outputTokens: number;
  audioInMs: number;
  audioOutMs: number;
  firstAudioMs: number | null;
  totalMs: number | null;
  interrupted: boolean;
  tools: string[];
};

/** Detect a rough language for history labels (model replies in the customer's language). */
function labelLanguage(text: string, fallback: AiLanguage): AiLanguage {
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[ğışİ]/.test(text)) return "tr";
  if (/[äß]/.test(text)) return "de";
  if (/\b(the|you|and|would|like)\b/i.test(text)) return "en";
  return fallback;
}

export async function recordRealtimeTurn(ctx: TrustedTableContext, input: RealtimeTurnInput): Promise<{ ok: true } | { ok: false; error: "conversation_invalid" | "rate_limited" | "feature_disabled" }> {
  if (!(await getVoiceAiAccess(ctx.tenant.id)).availability.available) return { ok: false, error: "feature_disabled" };
  const conversation = await findConversation(tableScope(ctx), input.proof);
  if (!conversation) return { ok: false, error: "conversation_invalid" };
  if (!(await rateLimit("ai.report", conversation.id)).allowed) return { ok: false, error: "rate_limited" };
  const begun = await beginTurn(conversation, input.turnKey, "REALTIME");
  if (begun.kind !== "new") return { ok: true };
  const current: AiLanguage = isAiLanguage(conversation.conversationLanguage) ? conversation.conversationLanguage : "tr";
  const userText = sanitizeUserText(input.userText) || "…";
  const userLanguage = labelLanguage(userText, current);
  const replyLanguage = labelLanguage(input.reply, userLanguage);
  await appendTurn(conversation, {
    userText,
    inputMode: "VOICE",
    userLanguage,
    reply: guardAssistantText(input.reply || "…", replyLanguage),
    replyLanguage,
    metadata: { realtime: true, tools: input.tools.map((n) => ({ name: n, ok: true })), interrupted: input.interrupted },
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    turn: { id: begun.turn.id, status: input.interrupted ? "INTERRUPTED" : "COMPLETED", stats: { firstAudioMs: input.firstAudioMs, totalMs: input.totalMs, audioInMs: input.audioInMs, audioOutMs: input.audioOutMs } },
  });
  if (input.interrupted) await prisma.aiTurn.update({ where: { id: begun.turn.id }, data: { interruptedAt: new Date() } });
  if (replyLanguage !== current) await prisma.aiConversation.update({ where: { id: conversation.id }, data: { conversationLanguage: replyLanguage } });
  await recordUsage({ tenantId: ctx.tenant.id, conversationId: conversation.id, kind: "CHAT", provider: "openai", model: realtimeConfig()?.model ?? REALTIME_DEFAULT_MODEL, inputTokens: input.inputTokens, outputTokens: input.outputTokens, latencyMs: input.firstAudioMs ?? 0 });
  return { ok: true };
}

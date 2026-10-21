import "server-only";
import { Prisma, type AdvisorFeedback, type AdvisorInsight } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatLocalDate, localDateOf } from "@/lib/analytics/time";
import { generateCandidates } from "@/lib/advisor/engine";
import { fmtMetric } from "@/lib/advisor/format";
import { factHash, materialSignature } from "@/lib/advisor/hash";
import { toExplainItem } from "@/lib/advisor/prompt";
import { renderInsight, type RenderedInsight } from "@/lib/advisor/templates";
import { ADVISOR_RANGES, DEFAULT_ADVISOR_RANGE, HIGHLIGHTS, MAX_INSIGHTS, type AdvisorRange } from "@/lib/advisor/thresholds";
import type { ActionType, AnalyticsTab, Confidence, InsightCandidate, InsightCategory, InsightType, MetricRow, Severity } from "@/lib/advisor/types";
import { allowedNumbers, validateExplanation, type AiExplanation } from "@/lib/advisor/validate";
import { log } from "@/lib/observability/logger";
import { metrics } from "@/lib/observability/metrics";
import type { TenantScope } from "@/lib/tenant/scope";
import { analyticsCacheKey, cached, primeCache } from "@/server/analytics/cache";
import { analyticsNow, resolveAnalyticsContext, type AnalyticsContext, type BranchOption } from "@/server/analytics/filter";
import { recordUsage } from "@/server/services/ai/usage.service";
import { checkFeature, resolveEntitlements, usageAllows } from "@/server/billing/entitlements";
import { getAdvisorExplainer } from "@/server/services/advisor/explainer";
import { loadAdvisorFacts } from "@/server/services/advisor/facts.service";

/**
 * İşletme Danışmanı — SALT OKUNUR. Akış:
 *   güvenilir analitik olguları (Sprint 12) → deterministik kurallar (adaylar) → [isteğe bağlı] AI açıklaması
 *   → doğrulama (uydurma sayı / kâr / personel / nedensellik → şablona dönüş) → kart.
 * Bu modül fiyat, menü, istasyon, personel, ayar ya da paket DEĞİŞTİRMEZ; yazdığı tek tablo kendi içgörü kayıtları
 * (durum: yeni / görüldü / kapatıldı, geri bildirim, açıklama önbelleği) ve AI kullanım ölçümüdür.
 */
export type AdvisorActor = { scope: TenantScope; userId: string | null; canMutate: boolean };
export type AdvisorQuery = { range?: string | null; branch?: string | null };

/** Deterministik aday önbelleği: 5 dk (sayfa yenilemesi yeniden hesaplamaz). "Analizi Yenile" önbelleği atlar. */
export const ADVISOR_CACHE_TTL_MS = 5 * 60_000;
/** Kayıtlı içgörünün geçerlilik süresi (bilgi amaçlı; bir sonraki üretimde güncellenir). */
const INSIGHT_TTL_MS = 24 * 3600_000;
/** Bir yenilemede açıklanacak en fazla içgörü — gösterilenlerin tümü (tek istek; olgu yükü küçük). */
const MAX_EXPLAIN = MAX_INSIGHTS;

export type AdvisorCard = {
  id: string | null;
  type: InsightType;
  category: InsightCategory;
  severity: Severity;
  confidence: Confidence;
  subjectKey: string;
  subject: string | null;
  isNew: boolean;
  status: "NEW" | "SEEN" | "DISMISSED";
  feedback: AdvisorFeedback | null;
  rendered: RenderedInsight;
  explanation: { source: "ai" | "template"; summary: string; whyItMatters: string; suggestedAction: string };
  metrics: { label: string; current: string; previous: string | null; note: string | null }[];
  tab: AnalyticsTab;
  deepLink: string;
};

export type AdvisorView = {
  range: AdvisorRange;
  branchId: string | null;
  branchName: string | null;
  branches: BranchOption[];
  period: { current: string; previous: string };
  cards: AdvisorCard[];
  highlights: AdvisorCard[];
  brief: string[];
  dismissedCount: number;
  generatedAt: Date;
  explainerAvailable: boolean;
  persisted: boolean;
};

export type AdvisorError = "feature" | "range" | "branch_invalid";

type Stored = { facts: InsightCandidate["facts"]; metrics: MetricRow[]; score: number; subject: string | null; tab: AnalyticsTab; actions: ActionType[] };

export function parseRange(value: string | null | undefined): AdvisorRange {
  return (ADVISOR_RANGES as readonly string[]).includes(value ?? "") ? (value as AdvisorRange) : DEFAULT_ADVISOR_RANGE;
}

async function featureAllowed(tenantId: string): Promise<boolean> {
  return (await checkFeature(tenantId, "business_advisor")).allowed;
}

/** Bağlam (kiracı oturumdan; şube yalnızca bu kiracının). */
async function context(actor: AdvisorActor, query: AdvisorQuery, now: Date) {
  return resolveAnalyticsContext(actor.scope, { range: parseRange(query.range), branch: query.branch ?? null }, now);
}

/** Normal (sayfa görüntüleme) önbellek anahtarı: "şimdi" 5 dk'ya yuvarlanmış bağlamdan. */
function advisorCacheKey(f: AnalyticsContext["filter"], range: AdvisorRange, suffix = ""): string {
  return analyticsCacheKey({ tenantId: f.tenantId, branchId: f.branchId, start: f.start, end: f.end, timeZone: f.timeZone, currency: f.currency, section: `advisor:${range}${suffix}` });
}

async function candidatesFor(ctx: AnalyticsContext, range: AdvisorRange, fresh: boolean): Promise<{ candidates: InsightCandidate[]; hit: boolean }> {
  const f = ctx.filter;
  const key = advisorCacheKey(f, range, fresh ? `:${Date.now()}` : "");
  const started = Date.now();
  const result = await cached(
    key,
    "advisor",
    async () => {
      const facts = await loadAdvisorFacts(ctx);
      const { candidates, failedRules } = generateCandidates(facts);
      if (failedRules.length) log.warn("advisor.rule_failed", { rules: failedRules.join(",") });
      return candidates;
    },
    ADVISOR_CACHE_TTL_MS,
  );
  if (result.hit) metrics.inc("advisor.cache_hit", 1);
  else {
    metrics.inc("advisor.generated", 1);
    log.info("advisor.generated", { tenant: f.tenantId, range, candidates: result.value.length, ms: Date.now() - started });
  }
  return { candidates: result.value, hit: result.hit };
}

/** Adayları kalıcı kayıtlarla eşitler (yalnızca yazma yetkisi olan aktör; destek modu YAZMAZ). */
async function syncInsights(actor: AdvisorActor, ctx: AnalyticsContext, range: AdvisorRange, candidates: InsightCandidate[], now: Date): Promise<AdvisorInsight[]> {
  const tenantId = actor.scope.tenantId;
  const scopeKey = ctx.filter.branchId ?? "all";
  const base = {
    periodStart: ctx.filter.start,
    periodEnd: ctx.filter.end,
    comparisonStart: ctx.previousFilter.start,
    comparisonEnd: ctx.previousFilter.end,
    expiresAt: new Date(now.getTime() + INSIGHT_TTL_MS),
  };
  const existing = await prisma.advisorInsight.findMany({ where: { tenantId, scopeKey, range } });
  const byKey = new Map(existing.map((r) => [`${r.type}|${r.subjectKey}`, r]));
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.type}|${c.subjectKey}`;
    seen.add(key);
    const stored: Stored = { facts: c.facts, metrics: c.metrics, score: c.score, subject: c.subject, tab: c.tab, actions: c.actions };
    const hash = factHash(c);
    const material = materialSignature(c);
    const prev = byKey.get(key);
    const data = { category: c.category, severity: c.severity, confidence: c.confidence, facts: stored as unknown as Prisma.InputJsonValue, factHash: hash, materialHash: material, active: true, ...base };
    try {
      if (!prev) {
        await prisma.advisorInsight.create({ data: { tenantId, branchId: ctx.filter.branchId, scopeKey, range, type: c.type, subjectKey: c.subjectKey, ...data } });
      } else {
        // Kapatılmış içgörü yalnızca ÖNEMLİ değişimde (yön / büyüklük kovası / güven) yeniden "yeni" olur.
        const reopen = prev.status === "DISMISSED" && prev.materialHash !== material;
        await prisma.advisorInsight.updateMany({
          where: { id: prev.id, tenantId },
          data: { ...data, ...(reopen ? { status: "NEW", dismissedAt: null, dismissedByUserId: null, feedback: null } : {}) },
        });
      }
    } catch (error) {
      // Eşzamanlı ilk üretim (benzersiz anahtar yarışı) — diğer istek yazdı; sonuç aynı.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  const stale = existing.filter((r) => r.active && !seen.has(`${r.type}|${r.subjectKey}`)).map((r) => r.id);
  if (stale.length) await prisma.advisorInsight.updateMany({ where: { tenantId, id: { in: stale } }, data: { active: false } });
  return prisma.advisorInsight.findMany({ where: { tenantId, scopeKey, range, active: true } });
}

function periodLabel(tz: string, start: Date, end: Date): string {
  const a = formatLocalDate(localDateOf(tz, start));
  const b = formatLocalDate(localDateOf(tz, new Date(end.getTime() - 1)));
  return a === b ? a : `${a} – ${b}`;
}

function deepLink(range: AdvisorRange, tab: AnalyticsTab, branchId: string | null): string {
  const q = new URLSearchParams({ aralik: range, sekme: tab });
  if (branchId) q.set("sube", branchId);
  return `/panel/analitik?${q.toString()}`;
}

function toCard(input: { id: string | null; candidate: InsightCandidate; row: AdvisorInsight | null; currency: string; range: AdvisorRange; branchId: string | null; wasNew: boolean }): AdvisorCard {
  const { candidate: c, row, currency } = input;
  const rendered = renderInsight(c, currency);
  const hash = factHash(c);
  const ai = row?.explanation && row.explanationHash === hash ? (row.explanation as unknown as AiExplanation) : null;
  return {
    id: input.id,
    type: c.type,
    category: c.category,
    severity: c.severity,
    confidence: c.confidence,
    subjectKey: c.subjectKey,
    subject: c.subject,
    isNew: input.wasNew,
    status: row?.status ?? "NEW",
    feedback: row?.feedback ?? null,
    rendered,
    explanation: ai ? { source: "ai", ...ai } : { source: "template", summary: rendered.finding, whyItMatters: rendered.why, suggestedAction: rendered.action },
    metrics: c.metrics.map((m) => ({ label: m.label, current: fmtMetric(m.current, m.unit, currency), previous: m.previous === undefined ? null : fmtMetric(m.previous, m.unit, currency), note: m.note ?? null })),
    tab: c.tab,
    deepLink: deepLink(input.range, c.tab, input.branchId),
  };
}

function fromRow(row: AdvisorInsight): InsightCandidate {
  const s = row.facts as unknown as Stored;
  return {
    type: row.type as InsightType,
    category: row.category as InsightCategory,
    severity: row.severity as Severity,
    confidence: row.confidence as Confidence,
    subjectKey: row.subjectKey,
    subject: s.subject,
    facts: s.facts,
    metrics: s.metrics,
    score: s.score,
    tab: s.tab,
    actions: s.actions,
  };
}

/**
 * Danışman görünümü. `persist` (sahip / müdür, destek modu DEĞİL): içgörüler kaydedilir, yeni olanlar "görüldü"
 * yapılır. Destek modunda hiçbir şey yazılmaz; mevcut kayıtlar yalnızca okunur. AI ÇAĞRILMAZ (yalnızca refresh).
 */
export async function loadAdvisor(actor: AdvisorActor, query: AdvisorQuery, options: { now?: Date; fresh?: boolean; markSeen?: boolean } = {}): Promise<{ ok: true; view: AdvisorView } | { ok: false; error: AdvisorError; branches?: BranchOption[] }> {
  if (!(await featureAllowed(actor.scope.tenantId))) return { ok: false, error: "feature" };
  const now = options.now ?? analyticsNow(ADVISOR_CACHE_TTL_MS);
  const range = parseRange(query.range);
  const resolved = await context(actor, query, now);
  if (!resolved.ok) return { ok: false, error: resolved.error === "branch_invalid" ? "branch_invalid" : "range", branches: resolved.branches };
  const ctx = resolved.context;
  const { candidates } = await candidatesFor(ctx, range, !!options.fresh);
  // "Analizi Yenile": taze sonuç normal sayfa anahtarına da yazılır — yenilemeden sonraki görüntüleme eski önbelleği göstermez.
  if (options.fresh) primeCache(advisorCacheKey(ctx.filter, range), candidates, ADVISOR_CACHE_TTL_MS);
  const currency = ctx.filter.currency;
  const scopeKey = ctx.filter.branchId ?? "all";

  let cards: AdvisorCard[];
  let dismissedCount = 0;
  if (actor.canMutate) {
    const rows = await syncInsights(actor, ctx, range, candidates, now);
    const byKey = new Map(rows.map((r) => [`${r.type}|${r.subjectKey}`, r]));
    const visible = candidates.filter((c) => byKey.get(`${c.type}|${c.subjectKey}`)?.status !== "DISMISSED");
    dismissedCount = candidates.length - visible.length;
    cards = visible.map((c) => {
      const row = byKey.get(`${c.type}|${c.subjectKey}`) ?? null;
      return toCard({ id: row?.id ?? null, candidate: c, row, currency, range, branchId: ctx.filter.branchId, wasNew: row?.status === "NEW" });
    });
    const newIds = cards.filter((c) => c.isNew && c.id).map((c) => c.id!);
    // "Görüldü" yalnızca kullanıcı sayfayı GÖRÜNTÜLEDİĞİNDE (yenileme isteği yeni içgörüyü görülmüş saymaz).
    if (newIds.length && options.markSeen !== false) await prisma.advisorInsight.updateMany({ where: { tenantId: actor.scope.tenantId, id: { in: newIds }, status: "NEW" }, data: { status: "SEEN" } });
  } else {
    // Destek modu: salt okuma — kayıtlardaki durum / açıklama okunur, hiçbir şey yazılmaz.
    const rows = await prisma.advisorInsight.findMany({ where: { tenantId: actor.scope.tenantId, scopeKey, range } });
    const byKey = new Map(rows.map((r) => [`${r.type}|${r.subjectKey}`, r]));
    const visible = candidates.filter((c) => byKey.get(`${c.type}|${c.subjectKey}`)?.status !== "DISMISSED");
    dismissedCount = candidates.length - visible.length;
    cards = visible.map((c) => {
      const row = byKey.get(`${c.type}|${c.subjectKey}`) ?? null;
      return toCard({ id: row?.id ?? null, candidate: c, row, currency, range, branchId: ctx.filter.branchId, wasNew: false });
    });
  }

  return {
    ok: true,
    view: {
      range,
      branchId: ctx.filter.branchId,
      branchName: ctx.branchName,
      branches: ctx.branches,
      period: { current: periodLabel(ctx.filter.timeZone, ctx.filter.start, ctx.filter.end), previous: periodLabel(ctx.filter.timeZone, ctx.previousFilter.start, ctx.previousFilter.end) },
      cards,
      highlights: cards.slice(0, HIGHLIGHTS),
      brief: ownerBrief(cards),
      dismissedCount,
      generatedAt: now,
      explainerAvailable: !!getAdvisorExplainer(),
      persisted: actor.canMutate,
    },
  };
}

/** Kısa özet (deterministik): en önemli 4 içgörünün başlığı + karşılaştırması. */
export function ownerBrief(cards: readonly AdvisorCard[]): string[] {
  return cards.slice(0, 4).map((c) => (c.rendered.comparison ? `${c.rendered.title} — ${c.rendered.comparison}` : c.rendered.title));
}

export type RefreshResult = { ok: true; explained: number; reused: number; rejected: number; fallback: boolean } | { ok: false; error: AdvisorError | "provider" };

/**
 * "Analizi Yenile": önbelleği atlayarak yeniden hesaplar ve açıklaması olmayan (ya da olguları değişmiş) içgörüleri
 * AI ile açıklar. Aynı olgular → önceki açıklama yeniden kullanılır (aynı kiracıda herhangi bir kapsamdan); AI çağrısı
 * yok. Sağlayıcı yoksa / hata verirse deterministik şablonlar kalır.
 */
export async function refreshAdvisor(actor: AdvisorActor, query: AdvisorQuery, options: { now?: Date } = {}): Promise<RefreshResult> {
  if (!actor.canMutate) return { ok: false, error: "feature" };
  const loaded = await loadAdvisor(actor, query, { now: options.now, fresh: true, markSeen: false });
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const view = loaded.view;
  const tenantId = actor.scope.tenantId;
  const scopeKey = view.branchId ?? "all";
  const rows = await prisma.advisorInsight.findMany({ where: { tenantId, scopeKey, range: view.range, active: true, status: { not: "DISMISSED" } } });
  const pending = rows.filter((r) => r.explanationHash !== r.factHash);
  if (!pending.length) return { ok: true, explained: 0, reused: 0, rejected: 0, fallback: false };

  // 1) Aynı olgularla daha önce açıklanmış içgörü varsa yeniden kullan (ücretli istek yok).
  const prior = await prisma.advisorInsight.findMany({ where: { tenantId, factHash: { in: pending.map((p) => p.factHash) }, explanationHash: { not: null } }, select: { factHash: true, explanationHash: true, explanation: true, explanationModel: true } });
  const reusable = new Map(prior.filter((p) => p.explanationHash === p.factHash && p.explanation).map((p) => [p.factHash, p]));
  let reused = 0;
  const toExplain: AdvisorInsight[] = [];
  for (const row of pending) {
    const hit = reusable.get(row.factHash);
    if (hit) {
      await prisma.advisorInsight.updateMany({ where: { id: row.id, tenantId }, data: { explanation: hit.explanation as Prisma.InputJsonValue, explanationHash: row.factHash, explanationModel: hit.explanationModel } });
      reused++;
    } else toExplain.push(row);
  }
  if (reused) metrics.inc("advisor.explanation_reused", reused);
  if (!toExplain.length) return { ok: true, explained: 0, reused, rejected: 0, fallback: false };

  const explainer = getAdvisorExplainer();
  if (!explainer) {
    metrics.inc("advisor.fallback", 1, "no_provider");
    return { ok: true, explained: 0, reused, rejected: 0, fallback: true };
  }
  // Dönem limiti (Sprint 20): dolduysa sağlayıcı ÇAĞRILMAZ; içgörüler hesaplanan verilerle gösterilir.
  if (!(await usageAllows(await resolveEntitlements(tenantId), ["maxMonthlyAdvisorRuns"])).allowed) {
    metrics.inc("advisor.fallback", 1, "limit");
    return { ok: true, explained: 0, reused, rejected: 0, fallback: true };
  }
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultCurrency: true } });
  const currency = settings?.defaultCurrency ?? "TRY";
  const batch = toExplain.sort((a, b) => (fromRow(b).score ?? 0) - (fromRow(a).score ?? 0)).slice(0, MAX_EXPLAIN);
  const prepared = batch.map((row) => {
    const candidate = fromRow(row);
    const rendered = renderInsight(candidate, currency);
    return { row, candidate, rendered, item: toExplainItem(row.id, candidate, rendered, currency) };
  });

  const started = Date.now();
  let result;
  try {
    result = await explainer.explain(prepared.map((p) => p.item));
  } catch (error) {
    metrics.inc("advisor.provider_failure", 1);
    metrics.inc("advisor.fallback", 1, "provider_error");
    log.warn("advisor.provider_failure", { errorName: error instanceof Error ? error.name : "unknown", ms: Date.now() - started });
    await recordUsage({ tenantId, kind: "ADVISOR", provider: explainer.name, model: explainer.model, latencyMs: Date.now() - started, success: false, errorCode: "provider_error" });
    return { ok: true, explained: 0, reused, rejected: 0, fallback: true };
  }
  const latencyMs = Date.now() - started;
  await recordUsage({ tenantId, kind: "ADVISOR", provider: explainer.name, model: explainer.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs, success: true });

  let explained = 0;
  let rejected = 0;
  const byId = new Map(result.items.map((i) => [String(i.id ?? ""), i]));
  for (const p of prepared) {
    const raw = byId.get(p.row.id);
    const verdict = validateExplanation(raw, allowedNumbers(p.candidate, p.rendered, currency));
    if (verdict.ok) {
      await prisma.advisorInsight.updateMany({ where: { id: p.row.id, tenantId }, data: { explanation: verdict.value as unknown as Prisma.InputJsonValue, explanationHash: p.row.factHash, explanationModel: explainer.model } });
      explained++;
    } else {
      // Reddedilen açıklama saklanmaz; aynı olgular için tekrar ücretli istek yapılmasın diye "denendi" işaretlenir.
      await prisma.advisorInsight.updateMany({ where: { id: p.row.id, tenantId }, data: { explanation: Prisma.DbNull, explanationHash: p.row.factHash, explanationModel: `rejected:${verdict.reason}` } });
      rejected++;
      metrics.inc("advisor.explanation_rejected", 1, verdict.reason);
    }
  }
  if (explained) metrics.inc("advisor.explained", explained);
  log.info("advisor.explained", { tenant: tenantId, explained, rejected, reused, ms: latencyMs });
  return { ok: true, explained, reused, rejected, fallback: false };
}

/** Kapat / geri bildirim: yalnızca bu kiracının kaydı; analitik verisine dokunmaz. */
export async function dismissInsight(actor: AdvisorActor, id: string): Promise<boolean> {
  if (!actor.canMutate) return false;
  const r = await prisma.advisorInsight.updateMany({ where: { id, tenantId: actor.scope.tenantId }, data: { status: "DISMISSED", dismissedAt: new Date(), dismissedByUserId: actor.userId } });
  return r.count === 1;
}

export async function setInsightFeedback(actor: AdvisorActor, id: string, feedback: AdvisorFeedback): Promise<boolean> {
  if (!actor.canMutate) return false;
  const r = await prisma.advisorInsight.updateMany({ where: { id, tenantId: actor.scope.tenantId }, data: { feedback } });
  return r.count === 1;
}

/** Genel bakış özeti: varsayılan aralık, tüm şubeler — yeni içgörü sayısı + en önemli başlık. */
export async function advisorOverview(actor: AdvisorActor): Promise<{ newCount: number; total: number; top: string | null } | null> {
  if (!(await featureAllowed(actor.scope.tenantId))) return null;
  const loaded = await loadAdvisor({ ...actor, canMutate: false }, { range: DEFAULT_ADVISOR_RANGE }).catch(() => null);
  if (!loaded?.ok) return null;
  const rows = actor.canMutate ? await prisma.advisorInsight.findMany({ where: { tenantId: actor.scope.tenantId, scopeKey: "all", range: DEFAULT_ADVISOR_RANGE, active: true }, select: { type: true, subjectKey: true, status: true } }) : [];
  const status = new Map(rows.map((r) => [`${r.type}|${r.subjectKey}`, r.status]));
  const newCount = loaded.view.cards.filter((c) => (status.get(`${c.type}|${c.subjectKey}`) ?? "NEW") === "NEW").length;
  return { newCount: actor.canMutate ? newCount : 0, total: loaded.view.cards.length, top: loaded.view.cards[0]?.rendered.title ?? null };
}

/** Danışman AI kullanımı (müşteri sesli AI'ından ayrı). */
export async function advisorUsage(tenantId: string, since: Date): Promise<{ requests: number; inputTokens: number; outputTokens: number }> {
  const agg = await prisma.aiUsage.aggregate({ where: { tenantId, kind: "ADVISOR", createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } });
  return { requests: agg._count._all, inputTokens: agg._sum.inputTokens ?? 0, outputTokens: agg._sum.outputTokens ?? 0 };
}

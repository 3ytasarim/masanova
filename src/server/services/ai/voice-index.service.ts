import "server-only";
import type { Prisma, VoiceIndexStatus } from "@prisma/client";
import { flattenMenu, type FlatProduct } from "@/lib/ai/menu-match";
import { buildLexicon, menuFingerprint, phoneticKey, similarity, tokenize, type VoiceLexicon } from "@/lib/ai/voice-lexicon";
import { prisma } from "@/lib/db/prisma";
import type { TenantScope } from "@/lib/tenant/scope";
import { log } from "@/lib/observability/logger";
import { getProviders } from "@/server/services/ai/config";
import { getPublishedMenu } from "@/server/services/menu/public-menu.service";
import { loadPublicPresentation } from "@/server/services/public-menu/public-menu-cache";
import { toPublicMenuView } from "@/server/services/public-menu/serialize";
import { createMenuRefs } from "@/server/services/orders/menu-refs";

/**
 * Sesli menü dizini (kiracı başına). "Menüyü Tara ve Sesli AI'ı Hazırla":
 *   yayındaki menü (kategoriler, ürünler, varyantlar, ekstralar, tükendi) → deterministik sözlük (Türkçe okunuş, yabancı ad
 *   okunuşu, ayırt edici kısmi adlar, ek atma) → isteğe bağlı yapay zekâ ek söyleyişleri (fonetik olarak DOĞRULANIR; ada
 *   benzemeyen öneri atılır) → belirsiz adlar → kalıcı dizin + istatistik.
 * Eşleştirme çalışma anında CANLI menüyle yapılır (tükendi / yeni ürün anında doğru); kalıcı dizin yalnızca doğrulanmış
 * ek söyleyişleri, istatistiği ve belirsizlik listesini taşır. Menü değişince dizin "eskimiş" olur ve gecikmeli yeniden kurulur.
 */
export type VoiceIndexView = {
  status: VoiceIndexStatus | "NONE";
  builtAt: Date | null;
  staleSince: Date | null;
  counts: { products: number; variants: number; modifiers: number; terms: number; ambiguous: number };
  ambiguities: VoiceLexicon["ambiguities"];
  aiAugmented: boolean;
  errorCode: string | null;
};

/** Dizin için menü: işletmenin varsayılan dili, ilk etkin şube (fiyat / tükendi şubeden bağımsız ad eşleşmesi için yeterli). */
export async function loadIndexProducts(scope: TenantScope): Promise<FlatProduct[]> {
  const tenantId = scope.tenantId;
  const [presentation, branch] = await Promise.all([
    loadPublicPresentation(scope),
    prisma.branch.findFirst({ where: { tenantId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  ]);
  const menu = await getPublishedMenu(scope, { branchId: branch?.id ?? null, locale: presentation.defaultLocale });
  const view = toPublicMenuView(menu, presentation, { table: null, refOf: createMenuRefs(tenantId), ordering: null });
  return flattenMenu(view);
}

// ─── Yapay zekâ ek söyleyişleri (isteğe bağlı, doğrulanmış) ──────────────────

const AI_MAX_PER_PRODUCT = 3;
const AI_CHUNK = 12;

/** Öneri ürün adına fonetik olarak benziyor mu (ad ya da adın bir kelimesi)? Benzemeyen = uydurma → atılır. */
export function plausibleVariant(name: string, candidate: string): boolean {
  const c = phoneticKey(candidate).replace(/\s/g, "");
  if (c.length < 3 || candidate.length > 60) return false;
  const full = phoneticKey(name).replace(/\s/g, "");
  if (similarity(c, full) >= 0.6) return true;
  return tokenize(name).some((w) => {
    const k = phoneticKey(w);
    return k.length >= 4 && similarity(c, k) >= 0.7;
  });
}

async function generateAiTerms(products: FlatProduct[], existing: Record<string, string[]>): Promise<Record<string, string[]>> {
  const provider = getProviders().ai;
  if (!provider || provider.name !== "openai") return existing;
  const todo = products.filter((p) => !existing[p.key]).slice(0, 80);
  if (!todo.length) return existing;
  const out: Record<string, string[]> = { ...existing };
  // Parça parça (yanıt uzunluğu sınırına takılıp yarım JSON dönmesin); bir parça başarısızsa diğerleri sürer.
  for (let start = 0; start < todo.length; start += AI_CHUNK) {
    const chunk = todo.slice(start, start + AI_CHUNK);
    const list = chunk.map((p, i) => `${i + 1}. ${p.name}`).join(String.fromCharCode(10));
    try {
      const result = await provider.complete({
        system:
          "Bir restoran menüsündeki ürün adlarının, Türk müşterilerin KONUŞURKEN söyleyebileceği ve konuşma tanıma sisteminin yazabileceği biçimlerini üret. " +
          "Yalnızca adın okunuşu / kısaltması / yaygın yanlış yazımı olsun; yeni ürün, açıklama ya da çeviri UYDURMA. Her ürün için en fazla 3 kısa biçim. " +
          'Yanıt YALNIZCA JSON: {"1": ["...", "..."], "2": [...]}',
        history: [],
        utterance: list,
        language: "tr",
        tools: [],
        executeTool: async () => ({ ok: false }),
        signal: AbortSignal.timeout(25_000),
      });
      const raw = result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1);
      const json = JSON.parse(raw) as Record<string, unknown>;
      chunk.forEach((p, i) => {
        const value = json[String(i + 1)];
        const variants = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => plausibleVariant(p.name, v)) : [];
        out[p.key] = [...new Set(variants)].slice(0, AI_MAX_PER_PRODUCT);
      });
    } catch (error) {
      // Ek söyleyiş isteğe bağlıdır: hata olursa deterministik sözlük yeterli.
      log.warn("voice_index.ai_terms_failed", { code: error instanceof Error ? error.name : "unknown", chunk: start / AI_CHUNK });
    }
  }
  return out;
}

// ─── Kurma / durum ───────────────────────────────────────────────────────────

const toJson = (v: unknown) => v as Prisma.InputJsonValue;

export async function buildVoiceIndex(scope: TenantScope, options: { useAi?: boolean } = {}): Promise<VoiceIndexView> {
  const tenantId = scope.tenantId;
  await prisma.voiceMenuIndex.upsert({ where: { tenantId }, update: { status: "BUILDING", errorCode: null }, create: { tenantId, status: "BUILDING" } });
  try {
    const products = await loadIndexProducts(scope);
    const row = await prisma.voiceMenuIndex.findUnique({ where: { tenantId }, select: { aiTerms: true } });
    const keys = new Set(products.map((p) => p.key));
    // Menüden çıkan ürünlerin ek söyleyişleri atılır.
    const previous = Object.fromEntries(Object.entries((row?.aiTerms ?? {}) as Record<string, string[]>).filter(([k]) => keys.has(k)));
    const aiTerms = options.useAi === false ? previous : await generateAiTerms(products, previous);
    const lexicon = buildLexicon(products, aiTerms);
    await prisma.voiceMenuIndex.update({
      where: { tenantId },
      data: {
        status: "READY",
        menuHash: menuFingerprint(products),
        builtAt: new Date(),
        staleSince: null,
        productCount: lexicon.stats.products,
        variantCount: lexicon.stats.variants,
        modifierCount: lexicon.stats.modifiers,
        termCount: lexicon.stats.terms,
        ambiguousCount: lexicon.stats.ambiguous,
        lexicon: toJson({ entries: lexicon.entries.map((e) => ({ productKey: e.productKey, name: e.name, category: e.category, terms: e.terms.map((t) => ({ text: t.text, kind: t.kind })) })), ambiguities: lexicon.ambiguities }),
        aiTerms: toJson(aiTerms),
        errorCode: null,
      },
    });
    lexiconCache.delete(tenantId);
    log.info("voice_index.built", { tenant: tenantId, products: lexicon.stats.products, terms: lexicon.stats.terms, ambiguous: lexicon.stats.ambiguous });
  } catch (error) {
    await prisma.voiceMenuIndex.update({ where: { tenantId }, data: { status: "FAILED", errorCode: error instanceof Error ? error.name.slice(0, 40) : "unknown" } });
    log.error("voice_index.build_failed", { tenant: tenantId, error: error instanceof Error ? { name: error.name, message: error.message.slice(0, 200) } : "unknown" });
  }
  return getVoiceIndexView(scope);
}

/** Panel görünümü: kayıtlı durum + (READY ise) menü özeti karşılaştırması → değiştiyse STALE. */
export async function getVoiceIndexView(scope: TenantScope): Promise<VoiceIndexView> {
  const tenantId = scope.tenantId;
  const row = await prisma.voiceMenuIndex.findUnique({ where: { tenantId } });
  if (!row) return { status: "NONE", builtAt: null, staleSince: null, counts: { products: 0, variants: 0, modifiers: 0, terms: 0, ambiguous: 0 }, ambiguities: [], aiAugmented: false, errorCode: null };
  let status = row.status;
  let staleSince = row.staleSince;
  if (status === "READY") {
    const hash = menuFingerprint(await loadIndexProducts(scope));
    if (hash !== row.menuHash) {
      status = "STALE";
      staleSince ??= new Date();
      await prisma.voiceMenuIndex.updateMany({ where: { tenantId, status: "READY" }, data: { status: "STALE", staleSince } });
    }
  }
  const lexicon = (row.lexicon ?? {}) as { ambiguities?: VoiceLexicon["ambiguities"] };
  const ai = (row.aiTerms ?? {}) as Record<string, string[]>;
  return {
    status,
    builtAt: row.builtAt,
    staleSince,
    counts: { products: row.productCount, variants: row.variantCount, modifiers: row.modifierCount, terms: row.termCount, ambiguous: row.ambiguousCount },
    ambiguities: lexicon.ambiguities ?? [],
    aiAugmented: Object.values(ai).some((v) => v.length > 0),
    errorCode: row.errorCode,
  };
}

// ─── Çalışma anı sözlüğü (canlı menü + doğrulanmış ek söyleyişler) ───────────

const lexiconCache = new Map<string, { at: number; fingerprint: string; lexicon: VoiceLexicon }>();
const aiTermsCache = new Map<string, { at: number; terms: Record<string, string[]> }>();
const CACHE_MS = 60_000;

async function storedAiTerms(tenantId: string): Promise<Record<string, string[]>> {
  const hit = aiTermsCache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.terms;
  const row = await prisma.voiceMenuIndex.findUnique({ where: { tenantId }, select: { aiTerms: true } });
  const terms = (row?.aiTerms ?? {}) as Record<string, string[]>;
  aiTermsCache.set(tenantId, { at: Date.now(), terms });
  return terms;
}

/** Çalışma anı: verilen (canlı, şubeye özgü) menü ürünlerinden sözlük — tükendi / yeni ürün anında yansır. */
export async function runtimeLexicon(tenantId: string, products: readonly FlatProduct[]): Promise<VoiceLexicon> {
  const fingerprint = menuFingerprint(products);
  const hit = lexiconCache.get(tenantId);
  if (hit && hit.fingerprint === fingerprint && Date.now() - hit.at < CACHE_MS) return hit.lexicon;
  const lexicon = buildLexicon(products, await storedAiTerms(tenantId));
  lexiconCache.set(tenantId, { at: Date.now(), fingerprint, lexicon });
  return lexicon;
}

// ─── Menü değişince: eskimiş işaretle; yeniden kurulum güvenilir kapsamla (oturum / QR) arka planda ─────────

/** Menü değişikliği sonrası (invalidatePublicMenu): dizin eskimiş işaretlenir. Kapsam üretilmez (güvenlik kuralı). */
export function scheduleVoiceIndexRefresh(tenantId: string): void {
  void prisma.voiceMenuIndex.updateMany({ where: { tenantId, status: "READY" }, data: { status: "STALE", staleSince: new Date() } }).catch(() => undefined);
  aiTermsCache.delete(tenantId);
  lexiconCache.delete(tenantId);
}

const refreshing = new Set<string>();
export const VOICE_INDEX_REBUILD_DELAY_MS = 20_000;

/**
 * Eskimiş dizini arka planda yeniden kur (bekletmez): bir sonraki sesli garson oturumunda (QR bağlamının kapsamı) ya da
 * panel açılışında (oturum kapsamı). Son değişiklikten bu yana kısa süre geçtiyse (art arda düzenleme) bekler.
 */
export function refreshVoiceIndexIfStale(scope: TenantScope): void {
  const tenantId = scope.tenantId;
  if (refreshing.has(tenantId)) return;
  refreshing.add(tenantId);
  void prisma.voiceMenuIndex
    .findUnique({ where: { tenantId }, select: { status: true, staleSince: true } })
    .then(async (row) => {
      // Hiç kurulmamış dizin (yeni işletme / içe aktarılan menü) de ilk sesli oturumda kurulur; eskimiş olan gecikmeyle.
      if (row && row.status !== "STALE") return;
      if (row?.staleSince && Date.now() - row.staleSince.getTime() < VOICE_INDEX_REBUILD_DELAY_MS) return;
      await buildVoiceIndex(scope);
    })
    .catch(() => undefined)
    .finally(() => refreshing.delete(tenantId));
}

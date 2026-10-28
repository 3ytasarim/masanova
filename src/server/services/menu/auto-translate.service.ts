import "server-only";
import { translatableLocales } from "@/config/menu";
import { prisma } from "@/lib/db/prisma";
import { chunkItems, parseTranslationResponse, translationSystemPrompt, translationUserPrompt, type TranslatableKind, type TranslatedText, type TranslationItem } from "@/lib/menu/auto-translate";
import { log } from "@/lib/observability/logger";
import { getJsonCompleter } from "@/server/services/ai/config";
import { recordUsage } from "@/server/services/ai/usage.service";
import type { PublishedMenu } from "@/server/services/menu/public-menu.service";

/**
 * Menünün yapay zekâyla otomatik çevirisi (QR menü dil seçici + sesli garson için).
 *
 * - Yalnızca EKSİK çeviriler (createMany skipDuplicates): işletmenin elle girdiği / düzelttiği çeviri ASLA ezilmez.
 * - Adım adım: her çağrı sınırlı iş yapar (≈20 sn) ve kalan sayıyı döndürür → proxy zaman aşımına (nginx 60 sn) takılmaz;
 *   panel ilerleme çubuğu adımları ardışık çağırır, arka plan işi döngüyle bitirir.
 * - Sağlayıcı yoksa (mock / anahtar yok) hiçbir şey YAZILMAZ — sahte çeviri üretilmez.
 * - Kiracı kapsamı: her sorgu ve yazım tenantId ile.
 */
type Missing = { locale: string; items: TranslationItem[] };

const CHUNK_PARALLEL = 4;
const RETRY_NOTE =
  "These items came back UNTRANSLATED. Translate each one now. Only a pure brand / label name may stay unchanged; dish names, ingredients and descriptive words must be translated (traditional dishes: original name + short translation in parentheses).";

function untranslated(result: string, source: string): boolean {
  return result.trim().toLocaleLowerCase("tr-TR") === source.trim().toLocaleLowerCase("tr-TR");
}
const MAX_TOKENS = 4000;

/** Kiracının eksik çevirileri (dil başına). Sıra: kategoriler → ürünler → varyant / seçenek / içerik (görünürlük önceliği). */
export async function findMissingTranslations(tenantId: string, locales?: string[]): Promise<Missing[]> {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultLocale: true } });
  const targets = (locales ?? translatableLocales(settings?.defaultLocale ?? "tr")).filter((l) => l !== (settings?.defaultLocale ?? "tr"));
  if (!targets.length) return [];
  const tr = { where: { locale: { in: targets } }, select: { locale: true } } as const;
  const [categories, products, variants, groups, modifiers, ingredients] = await Promise.all([
    prisma.menuCategory.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, description: true, translations: tr } }),
    prisma.product.findMany({ where: { tenantId, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, shortDescription: true, description: true, translations: tr } }),
    prisma.productVariant.findMany({ where: { tenantId, archivedAt: null, product: { archivedAt: null } }, select: { id: true, name: true, translations: tr } }),
    prisma.modifierGroup.findMany({ where: { tenantId, archivedAt: null }, select: { id: true, name: true, translations: tr } }),
    prisma.modifier.findMany({ where: { tenantId, archivedAt: null }, select: { id: true, name: true, translations: tr } }),
    prisma.ingredient.findMany({ where: { tenantId, active: true }, select: { id: true, name: true, translations: tr } }),
  ]);
  const sets: [TranslatableKind, { id: string; name: string; shortDescription?: string | null; description?: string | null; translations: { locale: string }[] }[]][] = [
    ["category", categories],
    ["product", products],
    ["variant", variants],
    ["modifierGroup", groups],
    ["modifier", modifiers],
    ["ingredient", ingredients],
  ];
  return targets
    .map((locale) => ({
      locale,
      items: sets.flatMap(([kind, rows]) =>
        rows
          .filter((r) => r.name.trim() && !r.translations.some((t) => t.locale === locale))
          .map((r) => ({ kind, id: r.id, source: { name: r.name, shortDescription: r.shortDescription ?? null, description: r.description ?? null } })),
      ),
    }))
    .filter((m) => m.items.length > 0);
}

export function countMissing(missing: readonly Missing[]): number {
  return missing.reduce((n, m) => n + m.items.length, 0);
}

async function save(tenantId: string, locale: string, items: readonly TranslationItem[], texts: readonly (TranslatedText | null)[]): Promise<number> {
  const rows = items.flatMap((item, i) => (texts[i] ? [{ item, text: texts[i]! }] : []));
  const of = (kind: TranslatableKind) => rows.filter((r) => r.item.kind === kind);
  const base = { tenantId, locale };
  const results = await prisma.$transaction([
    prisma.menuCategoryTranslation.createMany({ data: of("category").map((r) => ({ ...base, categoryId: r.item.id, name: r.text.name, description: r.text.description })), skipDuplicates: true }),
    prisma.productTranslation.createMany({
      data: of("product").map((r) => ({ ...base, productId: r.item.id, name: r.text.name, shortDescription: r.text.shortDescription, description: r.text.description })),
      skipDuplicates: true,
    }),
    prisma.productVariantTranslation.createMany({ data: of("variant").map((r) => ({ ...base, variantId: r.item.id, name: r.text.name })), skipDuplicates: true }),
    prisma.modifierGroupTranslation.createMany({ data: of("modifierGroup").map((r) => ({ ...base, modifierGroupId: r.item.id, name: r.text.name })), skipDuplicates: true }),
    prisma.modifierTranslation.createMany({ data: of("modifier").map((r) => ({ ...base, modifierId: r.item.id, name: r.text.name })), skipDuplicates: true }),
    prisma.ingredientTranslation.createMany({ data: of("ingredient").map((r) => ({ ...base, ingredientId: r.item.id, name: r.text.name })), skipDuplicates: true }),
  ]);
  return results.reduce((n, r) => n + r.count, 0);
}

export type TranslateStepResult = { ok: true; translated: number; remaining: number; failedChunks: number } | { ok: false; error: "provider_unavailable" };

/**
 * Bir adım: en fazla CHUNK_PARALLEL parça (dil başına sırayla) çevrilir ve yazılır. remaining=0 → menü tamamen çevrili.
 * failedChunks>0 ve translated=0 → sağlayıcı hatası; çağıran döngüyü bırakmalı (sonsuz deneme yok).
 */
export async function translateMenuStep(tenantId: string, defaultLocale?: string): Promise<TranslateStepResult> {
  const completer = getJsonCompleter();
  if (!completer) return { ok: false, error: "provider_unavailable" };
  const sourceLocale = defaultLocale ?? (await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { defaultLocale: true } }))?.defaultLocale ?? "tr";
  const missing = await findMissingTranslations(tenantId);
  const jobs = missing.flatMap((m) => chunkItems(m.items).map((items) => ({ locale: m.locale, items }))).slice(0, CHUNK_PARALLEL);
  let translated = 0;
  let failedChunks = 0;
  const results = await Promise.allSettled(
    jobs.map(async (job) => {
      const started = Date.now();
      const system = translationSystemPrompt(sourceLocale, job.locale);
      const res = await completer.run({ system, user: translationUserPrompt(job.items), maxTokens: MAX_TOKENS, timeoutMs: 45_000 });
      void recordUsage({ tenantId, kind: "CHAT", provider: "openai", model: completer.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, latencyMs: Date.now() - started }).catch(() => undefined);
      const texts = parseTranslationResponse(res.data, job.items);
      // Düzeltme turu: model bazen bir grubu çevirmeden geri verir → yalnızca kaynakla AYNI dönenler bir kez daha
      // (marka adıysa yine aynı gelir, doğru). Sonsuz deneme yok.
      const unchanged = job.items.flatMap((item, i) => (texts[i] && untranslated(texts[i]!.name, item.source.name) ? [i] : []));
      if (unchanged.length) {
        try {
          const retryItems = unchanged.map((i) => job.items[i]!);
          const retry = await completer.run({ system, user: `${RETRY_NOTE}\n${translationUserPrompt(retryItems)}`, maxTokens: MAX_TOKENS, timeoutMs: 45_000 });
          void recordUsage({ tenantId, kind: "CHAT", provider: "openai", model: completer.model, inputTokens: retry.inputTokens, outputTokens: retry.outputTokens }).catch(() => undefined);
          parseTranslationResponse(retry.data, retryItems).forEach((t, k) => {
            if (t) texts[unchanged[k]!] = t;
          });
        } catch {
          // İlk sonuç kalır (marka adı gibi aynı kalması doğru olabilir).
        }
      }
      return save(tenantId, job.locale, job.items, texts);
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled") translated += r.value;
    else {
      failedChunks++;
      log.warn("menu.auto_translate_chunk_failed", { tenant: tenantId, code: r.reason instanceof Error ? r.reason.message.slice(0, 40) : "unknown" });
    }
  }
  const remaining = countMissing(await findMissingTranslations(tenantId));
  log.info("menu.auto_translate_step", { tenant: tenantId, translated, remaining, failedChunks });
  return { ok: true, translated, remaining, failedChunks };
}

// ─── Arka plan: menü değişince / misafir çevirisi olmayan dili açınca ──────────────────────────────────────────

const running = new Set<string>();
const lastRun = new Map<string, number>();
/** Aynı kiracı için arka plan çevirisi en fazla bu aralıkla başlar (misafir dil değiştirmesiyle maliyet sınırı). */
const BACKGROUND_COOLDOWN_MS = 10 * 60_000;
const MAX_BACKGROUND_STEPS = 40;

/**
 * Eksik çevirileri arka planda tamamlar (beklemez). Menü düzenlemesi sonrası `force` ile (bekleme süresi yok) ya da
 * misafir varsayılan dışı bir dili açtığında (bekleme süreli). Bitince menü önbelleği geçersiz kılınır (istek bağlamı
 * dışında geçersiz kılma sessizce atlanırsa 5 dk emniyet süresi devreye girer).
 */
export function scheduleMenuAutoTranslate(tenantId: string, opts: { force?: boolean; delayMs?: number } = {}): void {
  if (!getJsonCompleter() || running.has(tenantId)) return;
  const now = Date.now();
  if (!opts.force && now - (lastRun.get(tenantId) ?? 0) < BACKGROUND_COOLDOWN_MS) return;
  lastRun.set(tenantId, now);
  running.add(tenantId);
  setTimeout(() => {
    void (async () => {
      let total = 0;
      try {
        for (let i = 0; i < MAX_BACKGROUND_STEPS; i++) {
          const step = await translateMenuStep(tenantId);
          if (!step.ok) break;
          total += step.translated;
          if (step.remaining === 0 || step.translated === 0) break;
        }
      } catch (error) {
        log.warn("menu.auto_translate_failed", { tenant: tenantId, code: error instanceof Error ? error.name : "unknown" });
      } finally {
        running.delete(tenantId);
        if (total > 0) {
          try {
            const { invalidatePublicMenu } = await import("@/server/services/public-menu/public-menu-cache");
            invalidatePublicMenu(tenantId, "other");
          } catch {
            // İstek bağlamı dışında etiket geçersiz kılınamayabilir → 5 dk emniyet süresi.
          }
        }
      }
    })();
  }, opts.delayMs ?? 0);
}

export function isMenuAutoTranslateRunning(tenantId: string): boolean {
  return running.has(tenantId);
}

/** Misafir varsayılan dışı bir dili açtı ve menüde çevirisi olmayan ürün / kategori var → arka planda tamamla. */
export function ensureMenuTranslated(tenantId: string, menu: PublishedMenu): void {
  if (menu.locale === menu.defaultLocale) return;
  const products = menu.categories.flatMap((c) => [...c.products, ...c.children.flatMap((ch) => ch.products)]);
  if (products.some((p) => p.translationFallback)) scheduleMenuAutoTranslate(tenantId);
}

import "server-only";
import { fold, type FlatProduct } from "@/lib/ai/menu-match";
import { retrieveKnowledge } from "@/lib/ai/knowledge";
import { pairingViews, parsePairingText, resolvePairings, type PairingView } from "@/lib/ai/pairings";
import { log } from "@/lib/observability/logger";
import type { TenantScope } from "@/lib/tenant/scope";
import { getProviders } from "@/server/services/ai/config";
import { getActiveKnowledge } from "@/server/services/ai/knowledge.service";
import { loadIndexProducts, runtimeLexicon } from "@/server/services/ai/voice-index.service";

/**
 * Yapay zekâyla yemek eşleştirmesi — işletmenin menüsünü bir gastronom gibi okuyup her ana yemek için meze, içecek ve
 * tatlı önerir (ChatGPT'ye "bu menü için eşleştirme hazırla" demek gibi). Platform eğitim metinleri (Super Admin ›
 * Yapay Zeka Eğit) kurallar olarak verilir. Model YALNIZCA menüdeki adları kullanabilir; çıktı her zaman menüye çözülür,
 * çözülemeyen ad (uydurma) elenir. Sonuç KAYDEDİLMEZ — işletme gözden geçirip kaydeder.
 */
const SIDE_CATEGORY = /(meze|salata|corba|ara sicak|tatli|ekmek|kahvalti|icecek|sicak|soguk|bira|sarap|raki|viski|votka|cin|kokteyl)/;
const CHUNK = 5;
const PARALLEL = 4;

export type GeneratedPairings = { text: string; views: PairingView[]; unmatched: { line: number; text: string }[]; mains: number; failedChunks: number };

function mainCourses(products: readonly FlatProduct[]): FlatProduct[] {
  return products.filter((p) => p.kind === "meal" && !p.soldOut && !SIDE_CATEGORY.test(fold(p.categoryName))).slice(0, 60);
}

function catalog(products: readonly FlatProduct[]): string {
  const byCat = new Map<string, string[]>();
  for (const p of products) if (!p.soldOut) byCat.set(p.categoryName, [...(byCat.get(p.categoryName) ?? []), p.name]);
  return [...byCat].map(([cat, names]) => `${cat}: ${names.join(", ")}`).join("\n").slice(0, 9000);
}

export async function generatePairingsWithAi(scope: TenantScope): Promise<GeneratedPairings | { error: "provider_unavailable" | "no_mains" }> {
  const provider = getProviders().ai;
  if (!provider || provider.name !== "openai") return { error: "provider_unavailable" };
  const products = await loadIndexProducts(scope);
  const mains = mainCourses(products);
  if (!mains.length) return { error: "no_mains" };

  const rules = retrieveKnowledge(await getActiveKnowledge(), "gastronomi eşleştirme meze içecek tatlı alkol diyabet öneri", 1500)
    .map((s) => s.text)
    .join("\n");
  const system = [
    "Sen deneyimli bir restoran gastronomu ve sommelyesin. Aşağıdaki MENÜYE göre yemek eşleştirmesi hazırlıyorsun.",
    "Her ana yemek için: 2 uyumlu meze / salata / ara sıcak, 1–2 içecek (uygunsa bir alkollü — rakı / şarap / bira — ve bir alkolsüz seçenek), 1 tatlı.",
    "KURAL: YALNIZCA menüde YAZAN ürün adlarını AYNEN kullan; menüde olmayan ürün, yorum ya da açıklama yazma.",
    "Çıktı biçimi — her satır bir ana yemek, başka hiçbir şey yazma:",
    "Ana yemek | meze1, meze2 | içecek1, içecek2 | tatlı",
    ...(rules ? ["", "Platform kuralları (uy):", rules] : []),
    "",
    "MENÜ:",
    catalog(products),
  ].join("\n");

  const chunks: FlatProduct[][] = [];
  for (let i = 0; i < mains.length; i += CHUNK) chunks.push(mains.slice(i, i + CHUNK));
  const outputs: string[] = [];
  let failedChunks = 0;
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const results = await Promise.allSettled(
      chunks.slice(i, i + PARALLEL).map((chunk) =>
        provider.complete({
          system,
          history: [],
          utterance: `Şu ana yemekler için eşleştirme yaz:\n${chunk.map((p) => p.name).join("\n")}`,
          language: "tr",
          tools: [],
          executeTool: async () => ({ ok: false }),
          signal: AbortSignal.timeout(30_000),
        }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") outputs.push(r.value.text);
      else {
        failedChunks++;
        log.warn("pairings.ai_chunk_failed", { code: r.reason instanceof Error ? r.reason.name : "unknown" });
      }
    }
  }

  const lexicon = await runtimeLexicon(scope.tenantId, products);
  const { pairings, unmatched } = resolvePairings(parsePairingText(outputs.join("\n")), products, lexicon);
  const views = pairingViews(pairings, products);
  const text = views
    .map((v) => [v.main, v.sides.map((s) => s.name).join(", "), v.drinks.map((d) => d.name).join(", "), v.desserts.map((d) => d.name).join(", ")].join(" | ").replace(/( \| )+$/, ""))
    .join("\n");
  return { text, views, unmatched, mains: mains.length, failedChunks };
}

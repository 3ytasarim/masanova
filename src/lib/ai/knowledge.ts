import { fold, type FlatProduct } from "@/lib/ai/menu-match";
import { buildHealthGuide, classifyForHealth, HEALTH_CONDITIONS, HEALTH_DISCLAIMER, HEALTH_LABELS, type HealthCondition, type HealthGuideItem } from "@/lib/ai/health-guide";

/**
 * Yapay Zeka Eğitimi — Super Admin'in yazdığı SERBEST eğitim metinleri (ör. "Diyabet ve beslenme", "Kalori rehberi").
 * Tüm işletmelerin garsonu kullanır. Metnin tamamı talimata konmaz (maliyet): garson konu geçince getGuidance çağırır,
 * sunucu metni paragraflara bölüp konuyla en ilgili bölümleri döndürür. Ürünler HER ZAMAN işletmenin canlı menüsünden
 * (kalori bilgisi dahil) seçilir; metin ürün uyduramaz.
 */
export type KnowledgeDocument = { id: string; title: string; content: string; active: boolean; sortOrder: number };

/** Yerleşik sağlık sınıflandırıcısını tetikleyen ifadeler (metinden bağımsız taban kural). */
const CONDITION_TRIGGERS: Record<HealthCondition, string[]> = {
  diabetes: ["seker hasta", "sekerim", "seker var", "diyabet", "insulin", "kan sekeri", "diabetes", "diabetic"],
  hypertension: ["tansiyon", "hipertansiyon", "tuzsuz", "tuz yiyemiyorum", "blood pressure"],
  pregnancy: ["hamile", "gebe", "bebek bekliyorum", "emzir", "pregnant"],
  heart: ["kolesterol", "kalp", "damar", "cholesterol"],
  celiac: ["colyak", "gluten", "bugday yiyemiyorum", "celiac"],
};

export function detectCondition(phrase: string): HealthCondition | null {
  const t = ` ${fold(phrase)}`;
  for (const c of HEALTH_CONDITIONS) if (CONDITION_TRIGGERS[c].some((k) => t.includes(` ${k}`))) return c;
  return null;
}

// ─── Metinden bölüm getirme ─────────────────────────────────────────────────

const STOP = new Set(["ve", "ile", "bir", "bu", "su", "o", "da", "de", "mi", "mu", "icin", "gibi", "ben", "benim", "var", "yok", "ne", "bana", "olsun", "ama", "cok", "daha", "en", "the", "and", "for"]);
const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w);
const terms = (text: string) => fold(text).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)).map(stem);

export type KnowledgeSection = { document: string; text: string };

/** Metni başlık / paragraf bloklarına böl (boş satır ya da başlık satırı). */
function sections(doc: KnowledgeDocument): KnowledgeSection[] {
  const blocks = doc.content.replace(/\r/g, "").split(/\n\s*\n|\n(?=#+\s|[A-ZÇĞİÖŞÜ][^\n]{0,60}:\s*\n)/);
  return blocks.map((b) => b.trim()).filter((b) => b.length > 0).map((text) => ({ document: doc.title, text: text.slice(0, 1200) }));
}

/**
 * Konuyla en ilgili bölümler (kelime kökü örtüşmesi; başlık eşleşmesi bonus). Toplam en fazla `maxChars` karakter.
 * Konu hiçbir bölümle örtüşmezse boş döner (garson uydurmaz).
 */
export function retrieveKnowledge(docs: readonly KnowledgeDocument[], phrase: string, maxChars = 1800): KnowledgeSection[] {
  const q = new Set(terms(phrase));
  const condition = detectCondition(phrase);
  if (condition) for (const w of terms(HEALTH_LABELS[condition])) q.add(w);
  if (q.size === 0) return [];
  const scored = docs
    .filter((d) => d.active)
    .flatMap((d) => {
      const titleTerms = new Set(terms(d.title));
      const titleHit = [...q].filter((w) => titleTerms.has(w)).length;
      return sections(d).map((s) => {
        const st = new Set(terms(s.text));
        const hits = [...q].filter((w) => st.has(w)).length;
        return { s, score: hits * 2 + titleHit * 3 + (hits && titleHit ? 1 : 0) };
      });
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const out: KnowledgeSection[] = [];
  let used = 0;
  for (const { s } of scored) {
    if (used + s.text.length > maxChars) continue;
    out.push(s);
    used += s.text.length;
  }
  return out;
}

/** Garson talimatına eklenen kısa dizin: eğitim metinlerinin başlıkları (ayrıntı araçta — talimat kısa kalır). */
export function knowledgeIndex(docs: readonly KnowledgeDocument[], max = 40): string {
  return docs
    .filter((d) => d.active)
    .slice(0, max)
    .map((d) => `- ${d.title.slice(0, 100)}`)
    .join("\n");
}

// ─── Rehber (metin + menü) ──────────────────────────────────────────────────

export type GuidanceItem = HealthGuideItem & { calories: number | null };
export type Guidance = {
  topic: string;
  condition: HealthCondition | null;
  conditionLabel: string | null;
  /** Super Admin eğitim metninden konuyla ilgili bölümler — garson bunlara göre konuşur. */
  knowledge: KnowledgeSection[];
  good: GuidanceItem[];
  moderate: GuidanceItem[];
  avoid: GuidanceItem[];
  swaps: string[];
  tips: string[];
  /** Menüde kalori bilgisi olan ürün sayısı (kalori hesabı yapılabilir mi?). */
  productsWithCalories: number;
  disclaimer: string;
};

export function caloriesOf(p: FlatProduct): number | null {
  return p.nutrition?.calories ?? null;
}

export function buildGuidance(products: readonly FlatProduct[], docs: readonly KnowledgeDocument[], topic: string, options: { kind?: "meal" | "drink" | "dessert" | "any"; query?: string; limit?: number } = {}): Guidance {
  const condition = detectCondition(topic);
  const byKey = new Map(products.map((p) => [p.key, p]));
  const withCal = (i: HealthGuideItem): GuidanceItem => ({ ...i, calories: caloriesOf(byKey.get(i.key)!) });
  const base = condition ? buildHealthGuide(products, condition, options) : null;
  return {
    topic,
    condition,
    conditionLabel: condition ? HEALTH_LABELS[condition] : null,
    knowledge: retrieveKnowledge(docs, `${topic} ${options.query ?? ""}`),
    good: (base?.good ?? []).map(withCal),
    moderate: (base?.moderate ?? []).map(withCal),
    avoid: (base?.avoid ?? []).map(withCal),
    swaps: base?.swaps ?? [],
    tips: base?.tips ?? [],
    productsWithCalories: products.filter((p) => caloriesOf(p) !== null).length,
    disclaimer: HEALTH_DISCLAIMER,
  };
}

// ─── Kaloriye göre öğün ─────────────────────────────────────────────────────

const SIDE = /(salata|meze|corba|soup|salad|cacik|haydari|ezme|sogus|piyaz|fava|humus)/;
const ZERO_CAL_DRINK = /(^| )(su|soda|maden suyu|sade soda|cay|turk kahvesi|espresso|americano|bitki cayi)( |$)/;

export type CaloriePlan = { items: { key: string; name: string; calories: number; priceLabel: string }[]; totalCalories: number };
export type CaloriePlanResult = { maxCalories: number; plans: CaloriePlan[]; productsWithCalories: number; productsWithoutCalories: number };

/**
 * Hedef kaloriye (kişi başı üst sınır) göre öğün: ana yemek + (varsa) yan (salata / meze / çorba) + kalorisiz içecek.
 * YALNIZCA kalori bilgisi girilmiş ürünler hesaba girer (tahmin yok). Sağlık durumu verilirse 'kaçınılmalı' ürünler çıkar.
 * Her plan farklı ana yemekle; toplam hedefi aşmaz ve hedefe en yakın olanlar önce gelir.
 */
export function planMealByCalories(products: readonly FlatProduct[], input: { maxCalories: number; condition?: HealthCondition | null; query?: string }): CaloriePlanResult {
  const available = products.filter((p) => !p.soldOut && (!input.condition || classifyForHealth(p, input.condition).tier !== "avoid"));
  const known = available.filter((p) => caloriesOf(p) !== null);
  const q = input.query ? fold(input.query) : "";
  const isSide = (p: FlatProduct) => SIDE.test(fold(`${p.name} ${p.categoryName}`));
  const mains = known.filter((p) => p.kind === "meal" && !isSide(p) && (!q || p.search.includes(q) || fold(p.name).includes(q)));
  const sides = known.filter((p) => p.kind === "meal" && isSide(p));
  const drink = available.find((p) => p.kind === "drink" && (ZERO_CAL_DRINK.test(fold(p.name)) || caloriesOf(p) === 0));
  const line = (p: FlatProduct, calories: number) => ({ key: p.key, name: p.name, calories, priceLabel: p.priceLabel });

  const plans: CaloriePlan[] = [];
  for (const m of mains) {
    const mc = caloriesOf(m)!;
    if (mc > input.maxCalories) continue;
    const side = sides.filter((s) => mc + caloriesOf(s)! <= input.maxCalories).sort((a, b) => caloriesOf(b)! - caloriesOf(a)!)[0];
    const items = [line(m, mc), ...(side ? [line(side, caloriesOf(side)!)] : []), ...(drink ? [line(drink, caloriesOf(drink) ?? 0)] : [])];
    plans.push({ items, totalCalories: items.reduce((s, i) => s + i.calories, 0) });
  }
  // Sağlık durumu varsa önce 'uygun' ana yemekli planlar, sonra 'ölçülü' olanlar; aynı grupta hedefe en yakın önce.
  const rank = (plan: CaloriePlan) => (input.condition ? (classifyForHealth(products.find((p) => p.key === plan.items[0]!.key)!, input.condition).tier === "good" ? 0 : 1) : 0);
  plans.sort((a, b) => rank(a) - rank(b) || b.totalCalories - a.totalCalories);
  return { maxCalories: input.maxCalories, plans: plans.slice(0, 3), productsWithCalories: known.length, productsWithoutCalories: available.length - known.length };
}

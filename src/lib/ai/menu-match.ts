import type { PublicMenuView, PublicProductView } from "@/lib/public-menu/types";

/**
 * Güvenilir menü görünümünden (PublicMenuView — gizli / arşiv / şube dışı ürün İÇERMEZ) düz ürün listesi ve eşleştirme.
 * Model ya da müşteri ne söylerse söylesin ürün YALNIZCA bu listeden bulunur; bulunamazsa null (uydurma yok).
 */
export type FlatProduct = PublicProductView & {
  categoryName: string;
  /** Doğrudan sepete eklenebilir mi (zorunlu seçim yok, en fazla bir varyant). */
  directlyAddable: boolean;
  /** Varsayılan/tek fiyat (kuruş): varyantsızsa taban, varyantlıysa en düşük varyant. */
  unitPriceMinor: number;
  kind: "meal" | "dessert" | "drink";
  light: boolean;
};

export function fold(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DESSERT = /(tatli|dessert|nachtisch|nachspeise|десерт|حلو|cheesecake|baklava|kunefe|sutlac|pasta|dondurma|ice cream)/;
const DRINK = /(icecek|drink|getrank|напит|مشروب|kahve|coffee|kaffee|cay|tea|tee|ayran|limonata|lemonade|su$|water|soda|kola|cola|juice|meyve suyu)/;
const LIGHT = /(salata|salad|salat|салат|سلطة|corba|soup|suppe|суп|شوربة|izgara|grill)/;

function classify(p: PublicProductView, categoryName: string): FlatProduct["kind"] {
  const text = fold(`${categoryName} ${p.categoryKey}`);
  if (DESSERT.test(text)) return "dessert";
  if (DRINK.test(text)) return "drink";
  return "meal";
}

export function flattenMenu(view: PublicMenuView): FlatProduct[] {
  const out: FlatProduct[] = [];
  const seen = new Set<string>();
  for (const c of view.categories) {
    for (const p of c.products) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      const requiresChoice = p.modifierGroups.some((g) => g.required || g.minSelect > 0);
      const unitPriceMinor = p.variants.length ? Math.min(...p.variants.map((v) => v.priceMinor)) : p.basePriceMinor;
      const kind = classify(p, c.name);
      out.push({
        ...p,
        categoryName: c.name,
        directlyAddable: !requiresChoice && p.variants.length <= 1,
        unitPriceMinor,
        kind,
        light: kind === "meal" && (LIGHT.test(fold(`${c.name} ${p.name}`)) || (p.nutrition?.calories ?? 9999) < 500),
      });
    }
  }
  return out;
}

/** Diller arası küçük eş anlamlı sözlüğü (malzeme / kategori). Menü kendi dilinde aranır; bu yalnızca sorgu genişletir. */
const SYNONYMS: string[][] = [
  ["tavuk", "chicken", "hahnchen", "huhn", "курица", "куриц", "دجاج"],
  ["et", "beef", "dana", "rind", "говядин", "لحم"],
  ["burger", "hamburger", "бургер", "برغر", "برجر"],
  ["corba", "soup", "suppe", "суп", "شوربة"],
  ["salata", "salad", "salat", "салат", "سلطة"],
  ["tatli", "dessert", "nachtisch", "десерт", "حلوى", "حلويات"],
  ["icecek", "drink", "getrank", "напиток", "مشروب"],
  ["kahve", "coffee", "kaffee", "кофе", "قهوة"],
  ["mercimek", "lentil", "linsen", "чечевиц", "عدس"],
  ["peynir", "cheese", "kase", "сыр", "جبن"],
  ["ayran", "yogurt drink", "ayran", "айран", "عيران"],
  ["su", "water", "wasser", "вода", "ماء"],
  ["balik", "fish", "fisch", "рыба", "سمك"],
  ["sushi", "суши", "سوشي"],
];

/** Arama dışı dolgu kelimeler (5 dil) — "something with chicken" içindeki "with" açıklamalarla eşleşmesin. */
const STOP = new Set(
  [
    "bir", "ve", "ile", "icin", "ne", "var", "mi", "mu", "bana", "bize", "olan", "olarak", "biraz", "sey", "seyler", "oner", "onerir", "misin", "misiniz", "lutfen", "istiyorum", "hangi", "hangisi", "icinde", "iki", "kisi", "kisiyiz", "agir", "olmayan", "tavsiye",
    "can", "you", "could", "would", "something", "some", "with", "and", "the", "a", "an", "for", "please", "recommend", "suggest", "have", "any", "what", "is", "are", "there", "me", "us", "like", "want", "of", "in", "on", "do", "which",
    "der", "die", "das", "und", "mit", "ein", "eine", "etwas", "bitte", "haben", "sie", "gibt", "es", "was", "empfehlen", "konnen", "mochten", "fur",
    "что", "нибудь", "с", "и", "есть", "ли", "пожалуйста", "посоветуйте", "мне", "нам", "какой", "какое",
    "هل", "مع", "و", "شيء", "من", "فضلك", "لديكم", "يوجد", "اقترح",
  ].map((w) => fold(w)),
);

export function expandQuery(query: string): string[] {
  const q = fold(query);
  const terms = new Set(q.split(" ").filter((t) => t.length >= 2 && !STOP.has(t)));
  for (const group of SYNONYMS) {
    const folded = group.map(fold);
    if (folded.some((s) => terms.has(s) || (s.length >= 4 && [...terms].some((t) => t.startsWith(s) || s.startsWith(t) && t.length >= 4)))) folded.forEach((s) => terms.add(s));
  }
  return [...terms];
}

/** Ürün ifadesi eşleştirme: anahtar → tam ad → kelime öneki örtüşmesi (≥ 4 harf). Eşik altında null. */
export function resolveProduct(products: readonly FlatProduct[], phrase: string): FlatProduct | null {
  const q = fold(phrase);
  if (!q) return null;
  const byKey = products.find((p) => p.key === phrase.trim().toLowerCase());
  if (byKey) return byKey;
  const exact = products.find((p) => fold(p.name) === q);
  if (exact) return exact;
  const words = expandQuery(phrase).filter((w) => w.length >= 3);
  let best: { p: FlatProduct; score: number } | null = null;
  for (const p of products) {
    const nameTokens = fold(p.name).split(" ").filter((t) => t.length >= 3);
    if (!nameTokens.length) continue;
    const hits = nameTokens.filter((t) => words.some((w) => w === t || (w.length >= 4 && t.length >= 4 && (w.startsWith(t.slice(0, 4)) || t.startsWith(w.slice(0, 4)))))).length;
    const score = hits / nameTokens.length;
    if (hits && (!best || score > best.score || (score === best.score && nameTokens.length > fold(best.p.name).split(" ").length))) best = { p, score };
  }
  return best && best.score >= 0.5 ? best.p : null;
}

/** Metin araması (malzeme, ad, açıklama, kategori, etiket — PublicProductView.search alanı). */
export function searchProducts(products: readonly FlatProduct[], query: string): FlatProduct[] {
  const terms = expandQuery(query).filter((t) => t.length >= 3);
  if (!terms.length) return [];
  return products
    .map((p) => {
      const hay = fold(`${p.search} ${p.name} ${p.categoryName} ${p.ingredients.join(" ")}`);
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.p.featured) - Number(a.p.featured) || a.p.unitPriceMinor - b.p.unitPriceMinor)
    .map((x) => x.p);
}

/** Restoranın AÇIK etiketi var mı (çıkarım yok). Kod ya da ad eşleşmesi. */
export function hasDietaryTag(p: Pick<PublicProductView, "dietaryTags">, tag: string): boolean {
  const t = fold(tag).replace(/\s+/g, "_");
  const aliases: Record<string, string[]> = {
    vegan: ["vegan", "веган", "نباتي_صرف"],
    vegetarian: ["vegetarian", "vejetaryen", "vegetarisch", "вегетариан", "نباتي"],
    gluten_free: ["gluten_free", "glutensiz", "glutenfrei", "без_глютена", "خالي_من_الغلوتين"],
    halal: ["halal", "helal", "халяль", "حلال"],
    spicy: ["spicy", "aci", "scharf", "острое", "حار"],
  };
  const wanted = new Set([t, ...Object.entries(aliases).filter(([k, v]) => k === t || v.map((x) => fold(x).replace(/\s+/g, "_")).includes(t)).flatMap(([k, v]) => [k, ...v.map((x) => fold(x).replace(/\s+/g, "_"))])]);
  return p.dietaryTags.some((d) => wanted.has(fold(d.code).replace(/\s+/g, "_")) || wanted.has(fold(d.name).replace(/\s+/g, "_")));
}

/** Alerjen kaçınma: bilgi BELİRTİLMEMİŞSE ürün "bilinmiyor" sayılır ve güvenli kabul EDİLMEZ. */
export function allergenStatus(p: Pick<PublicProductView, "allergens" | "allergenInfoDeclared">, avoid: readonly string[]): "contains" | "not_declared" | "not_listed" {
  if (!p.allergenInfoDeclared) return "not_declared";
  const wanted = avoid.map(fold);
  const hit = p.allergens.some((a) => wanted.some((w) => fold(a.code).includes(w) || fold(a.name).includes(w) || w.includes(fold(a.name))));
  return hit ? "contains" : "not_listed";
}

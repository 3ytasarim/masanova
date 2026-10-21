import { allergenStatus, hasDietaryTag, searchProducts, type FlatProduct } from "@/lib/ai/menu-match";

/**
 * Deterministik öneri motoru (saf). Model aritmetik yapmaz: aday seçimi ve toplam burada; bütçe ASLA aşılmaz.
 * Tükenen ürün önerilmez; alerjen kaçınmada bilgisi belirtilmemiş ürün dışarıda kalır; diyet yalnızca açık etiketle.
 * Strateji (grup): kişi başı bir ana yemek (çeşitlilik, öne çıkanlar önce), bütçe kalırsa kişi başı içecek, sonra paylaşımlı
 * tatlı. Sığmazsa ucuz alternatife iner; en son kalem sayısını azaltır.
 */
export type RecommendationOptions = {
  guests?: number;
  budgetMinor?: number;
  kind?: "meal" | "dessert" | "drink" | "light" | "any";
  query?: string;
  dietaryTag?: string;
  avoidAllergens?: readonly string[];
  spicy?: "avoid" | "prefer";
  /** Grubun bir kısmı için açık diyet etiketi (ör. 3 kişiden 1'i vegan). Yalnızca restoranın etiketiyle karşılanır. */
  dietGuests?: readonly { tag: string; guests: number }[];
};

export type RecommendationItem = { product: FlatProduct; quantity: number; lineTotalMinor: number };
export type RecommendationResult = {
  items: RecommendationItem[];
  totalMinor: number;
  guests: number;
  budgetMinor: number | null;
  fitsBudget: boolean;
  empty: boolean;
  /** Restoranda etiketli ana yemeği olmadığı için karşılanamayan diyetler (tahmin / uydurma yok). */
  unmetDiets: string[];
  /** Diyet için seçilen ürün anahtarları. */
  dietPicks: { tag: string; product: string }[];
};

const SPICY = /(aci|spicy|scharf|остр|حار|jalapeno|chili|biber)/;

function eligible(products: readonly FlatProduct[], o: RecommendationOptions): FlatProduct[] {
  let list = products.filter((p) => !p.soldOut);
  if (o.dietaryTag) list = list.filter((p) => hasDietaryTag(p, o.dietaryTag!));
  if (o.avoidAllergens?.length) list = list.filter((p) => allergenStatus(p, o.avoidAllergens!) === "not_listed");
  if (o.spicy === "avoid") list = list.filter((p) => !hasDietaryTag(p, "spicy") && !SPICY.test(p.search));
  if (o.spicy === "prefer") list = list.filter((p) => hasDietaryTag(p, "spicy") || SPICY.test(p.search));
  return list;
}

const byPreference = (a: FlatProduct, b: FlatProduct) => Number(b.featured) - Number(a.featured) || a.unitPriceMinor - b.unitPriceMinor || a.name.localeCompare(b.name, "tr");

function sum(items: RecommendationItem[]) {
  return items.reduce((s, i) => s + i.lineTotalMinor, 0);
}

function add(items: RecommendationItem[], p: FlatProduct, quantity = 1) {
  const existing = items.find((i) => i.product.key === p.key);
  if (existing) {
    existing.quantity += quantity;
    existing.lineTotalMinor = existing.quantity * p.unitPriceMinor;
  } else items.push({ product: p, quantity, lineTotalMinor: quantity * p.unitPriceMinor });
}

export function recommend(products: readonly FlatProduct[], options: RecommendationOptions): RecommendationResult {
  const guests = Math.max(1, Math.min(20, options.guests ?? 1));
  const budget = options.budgetMinor ?? null;
  let pool = eligible(products, options);
  if (options.query) {
    const matched = searchProducts(pool, options.query);
    if (matched.length) pool = matched;
    else return { items: [], totalMinor: 0, guests, budgetMinor: budget, fitsBudget: true, empty: true, unmetDiets: [], dietPicks: [] };
  }
  const kind = options.kind ?? "meal";
  const items: RecommendationItem[] = [];
  const unmetDiets: string[] = [];
  const dietPicks: { tag: string; product: string }[] = [];
  const fits = (extra: number) => budget === null || sum(items) + extra <= budget;

  if (kind === "dessert" || kind === "drink") {
    const list = pool.filter((p) => p.kind === kind).sort(byPreference);
    for (const p of list.slice(0, 3)) if (fits(p.unitPriceMinor * (kind === "drink" ? guests : 1))) add(items, p, kind === "drink" ? guests : 1);
  } else {
    const mains = pool.filter((p) => p.kind === "meal" && (kind !== "light" || p.light)).sort(byPreference);
    const cheapestMain = [...mains].sort((a, b) => a.unitPriceMinor - b.unitPriceMinor)[0];
    // Kişi başı tavan: bütçenin ~%75'i ana yemeklere (içecek payı).
    const perGuestCap = budget === null ? Infinity : Math.floor((budget * 0.75) / guests);
    const used = new Set<string>();
    // Önce diyet gereksinimi olan kişiler: yalnızca AÇIK etiketli ana yemekler.
    let assigned = 0;
    for (const need of options.dietGuests ?? []) {
      const tagged = mains.filter((p) => hasDietaryTag(p, need.tag));
      for (let i = 0; i < need.guests && assigned < guests; i++) {
        const pick = tagged.find((p) => !used.has(p.key) && fits(p.unitPriceMinor)) ?? tagged.find((p) => fits(p.unitPriceMinor));
        if (!pick) {
          if (!unmetDiets.includes(need.tag)) unmetDiets.push(need.tag);
          continue;
        }
        used.add(pick.key);
        add(items, pick);
        dietPicks.push({ tag: need.tag, product: pick.key });
        assigned += 1;
      }
    }
    // Diyet gereksinimi olan kişiye etiketsiz ürün önerilmez (karşılanamazsa açıkça söylenir).
    const dietTotal = Math.min(guests, (options.dietGuests ?? []).reduce((n, d) => n + d.guests, 0));
    void assigned;
    for (let g = dietTotal; g < guests; g++) {
      const pick =
        mains.find((p) => !used.has(p.key) && p.unitPriceMinor <= perGuestCap && fits(p.unitPriceMinor)) ??
        mains.find((p) => p.unitPriceMinor <= perGuestCap && fits(p.unitPriceMinor)) ??
        (cheapestMain && fits(cheapestMain.unitPriceMinor) ? cheapestMain : undefined);
      if (!pick) break;
      used.add(pick.key);
      add(items, pick);
    }
    if (kind !== "light" || items.length) {
      const drink = pool.filter((p) => p.kind === "drink").sort((a, b) => a.unitPriceMinor - b.unitPriceMinor)[0];
      if (drink && items.length && fits(drink.unitPriceMinor * guests)) add(items, drink, guests);
      const dessert = pool.filter((p) => p.kind === "dessert").sort(byPreference)[0];
      if (dessert && items.length && guests >= 2 && fits(dessert.unitPriceMinor)) add(items, dessert, 1);
    }
  }

  // Güvenlik ağı: toplam bütçeyi asla aşamaz.
  while (budget !== null && sum(items) > budget && items.length) {
    const last = items[items.length - 1]!;
    if (last.quantity > 1) {
      last.quantity -= 1;
      last.lineTotalMinor = last.quantity * last.product.unitPriceMinor;
    } else items.pop();
  }
  const totalMinor = sum(items);
  const mainsCount = items.filter((i) => i.product.kind === "meal").reduce((s, i) => s + i.quantity, 0);
  return {
    items,
    totalMinor,
    guests,
    budgetMinor: budget,
    fitsBudget: kind === "meal" || kind === "any" || kind === "light" ? mainsCount >= guests : items.length > 0,
    empty: items.length === 0,
    unmetDiets,
    dietPicks: dietPicks.filter((d) => items.some((i) => i.product.key === d.product)),
  };
}

/** Konuşmadan bütçe ve kişi sayısı (deterministik; model aritmetiğine güvenilmez). */
const NUMBER_WORDS: Record<string, number> = {
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  один: 1, одна: 1, два: 2, двое: 2, две: 2, три: 3, трое: 3, четыре: 4, четверо: 4, пять: 5, пятеро: 5,
  واحد: 1, اثنين: 2, اثنان: 2, ثلاثة: 3, أربعة: 4, خمسة: 5,
  single: 1, couple: 2, pair: 2,
};

export function parseNumberWord(token: string): number | null {
  const t = token.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/^\d{1,2}$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
}

export function parseBudgetAndGuests(text: string): { budgetMinor: number | null; guests: number | null } {
  const t = text.toLocaleLowerCase("tr-TR");
  const money = t.match(/(\d[\d.,]*)\s*(₺|tl|try|lira|lirayı|liralık|ليرة|лир)|(?:₺|try)\s*(\d[\d.,]*)|(?:bütçe|budget|unter|under|до|под|ميزانية)[^\d]{0,15}(\d[\d.,]*)/);
  const raw = money ? (money[1] ?? money[3] ?? money[4] ?? "") : "";
  const budgetMinor = raw ? Math.round(Number(raw.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) * 100) || null : null;
  let guests: number | null = null;
  const g =
    t.match(/(\S+)\s*(kişiyiz|kişi|kişilik|people|persons|guests|personen|person|человек|гостя|гостей|أشخاص|شخص)/) ?? t.match(/(\S+)\s+of us/) ?? t.match(/нас\s+(\S+)/) ?? t.match(/wir sind\s+(\S+)/);
  if (g) guests = parseNumberWord(g[1]!.replace(/[^\p{L}\p{N}]/gu, ""));
  return { budgetMinor, guests: guests && guests > 0 && guests <= 20 ? guests : null };
}

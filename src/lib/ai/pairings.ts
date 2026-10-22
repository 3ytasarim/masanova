import { fold, type FlatProduct } from "@/lib/ai/menu-match";
import { buildLexicon, matchProduct, type VoiceLexicon } from "@/lib/ai/voice-lexicon";
import { isAlcoholicProduct } from "@/lib/ai/health-guide";

/**
 * İşletme yemek eşleştirmeleri (ana yemek → önerilecek meze / içecek) — SAF parçalar.
 * Panelde metin olarak girilir (her satır bir ana yemek); adlar menüdeki ÜRÜNLERE çözülür ve ürün anahtarı (slug)
 * olarak saklanır. Garson "yanına ne gider?" sorularında getPairings ile restoranın önerisini söyler; menüde olmayan
 * ürün asla dönmez (silinen / tükenen ürün otomatik düşer).
 *
 * Kabul edilen satır biçimleri (tablodan kopyala-yapıştır dahil):
 *   Levrek Izgara<TAB>Deniz Börülcesi, Fava<TAB>Çankaya Beyaz Şarap
 *   Levrek Izgara | Deniz Börülcesi, Fava | Çankaya Beyaz Şarap
 *   Levrek Izgara: Deniz Börülcesi, Fava | Çankaya Beyaz Şarap
 * Başlık satırı ("Ana yemek  Önerilecek meze  İçecek eşleştirmesi") ve boş satırlar yok sayılır.
 */
export type StoredPairing = { main: string; sides: string[]; drinks: string[]; desserts?: string[] };
export type ParsedPairingLine = { line: number; main: string; sides: string[]; drinks: string[]; desserts: string[] };

export const MAX_PAIRINGS = 80;
const HEADER = /^(ana\s*yemek|yemek|urun|main)\b/;

export function parsePairingText(text: string): ParsedPairingLine[] {
  const out: ParsedPairingLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let cols = line.includes("\t") ? line.split("\t") : line.split("|");
    if (cols.length === 1 && line.includes(":")) cols = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)];
    else if (cols.length >= 2 && cols[0]!.includes(":") && !line.includes("\t")) {
      const [main, ...rest] = cols[0]!.split(":");
      cols = [main!, rest.join(":"), ...cols.slice(1)];
    }
    cols = cols.map((c) => c.trim());
    const main = cols[0] ?? "";
    if (!main || HEADER.test(fold(main))) return;
    const list = (s: string | undefined) => (s ?? "").split(/[,;/]|\s+ve\s+/i).map((x) => x.trim()).filter(Boolean);
    out.push({ line: i + 1, main, sides: list(cols[1]), drinks: list(cols[2]), desserts: list(cols[3]) });
  });
  return out.slice(0, MAX_PAIRINGS);
}

export type ResolvedPairings = { pairings: StoredPairing[]; unmatched: { line: number; text: string }[] };

/** Adları menü ürünlerine çöz (tam ad ya da yüksek güvenli eşleşme). Çözülemeyenler raporlanır, saklanmaz. */
export function resolvePairings(lines: readonly ParsedPairingLine[], products: readonly FlatProduct[], lexicon: VoiceLexicon = buildLexicon(products)): ResolvedPairings {
  const unmatched: { line: number; text: string }[] = [];
  const byName = new Map(products.map((p) => [fold(p.name), p.key]));
  // "Beylerbeyi Göbek Rakı", "Çankaya Beyaz Şarap": sondaki kategori kelimeleri (rakı, şarap, beyaz …) ürün adında yoktur.
  const categoryWords = new Set(products.flatMap((p) => fold(p.categoryName).split(" ")).flatMap((w) => [w, w.replace(/(lar|ler)$/, "")]));
  const tryName = (name: string): string | null => {
    const exact = byName.get(fold(name));
    if (exact) return exact;
    const r = matchProduct(lexicon, name);
    return r.status === "high" || r.status === "sold_out" ? r.product.productKey : null;
  };
  const resolve = (name: string, line: number): string | null => {
    const direct = tryName(name);
    if (direct) return direct;
    const words = fold(name).split(" ");
    while (words.length > 1 && categoryWords.has(words[words.length - 1]!)) {
      words.pop();
      const hit = tryName(words.join(" "));
      if (hit) return hit;
    }
    unmatched.push({ line, text: name });
    return null;
  };
  const pairings: StoredPairing[] = [];
  for (const l of lines) {
    const main = resolve(l.main, l.line);
    const sides = l.sides.map((s) => resolve(s, l.line)).filter((k): k is string => !!k && k !== main);
    const drinks = l.drinks.map((d) => resolve(d, l.line)).filter((k): k is string => !!k && k !== main);
    const desserts = l.desserts.map((d) => resolve(d, l.line)).filter((k): k is string => !!k && k !== main);
    if (!main || (!sides.length && !drinks.length && !desserts.length)) continue;
    const existing = pairings.find((p) => p.main === main);
    if (existing) {
      existing.sides = [...new Set([...existing.sides, ...sides])];
      existing.drinks = [...new Set([...existing.drinks, ...drinks])];
      existing.desserts = [...new Set([...(existing.desserts ?? []), ...desserts])];
    } else pairings.push({ main, sides: [...new Set(sides)], drinks: [...new Set(drinks)], desserts: [...new Set(desserts)] });
  }
  return { pairings, unmatched };
}

/** Saklanan değer güvenli biçimde okunur (bozuk / eski JSON → boş). */
export function readStoredPairings(value: unknown): StoredPairing[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is StoredPairing => !!v && typeof v === "object" && typeof (v as StoredPairing).main === "string")
    .map((v) => {
      const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
      return { main: v.main, sides: strings(v.sides), drinks: strings(v.drinks), desserts: strings(v.desserts) };
    })
    .slice(0, MAX_PAIRINGS);
}

type Named = { name: string; price: string };
export type PairingView = { mainKey: string; main: string; category: string; price: string; sides: Named[]; drinks: Named[]; desserts: Named[]; popular?: Named[] };

/** Saklananları canlı menüyle birleştir: menüde olmayan / tükenen ürünler düşer; avoidAlcohol → alkollü içecekler çıkar. */
export function pairingViews(stored: readonly StoredPairing[], products: readonly FlatProduct[], options: { avoidAlcohol?: boolean } = {}): PairingView[] {
  const byKey = new Map(products.map((p) => [p.key, p]));
  const item = (k: string): Named | null => {
    const p = byKey.get(k);
    if (!p || p.soldOut || (options.avoidAlcohol && isAlcoholicProduct(p))) return null;
    return { name: p.name, price: p.priceLabel };
  };
  return stored
    .map((s) => {
      const m = byKey.get(s.main);
      if (!m || m.soldOut) return null;
      const pick = (keys: readonly string[] | undefined) => (keys ?? []).map(item).filter((x): x is Named => !!x);
      const sides = pick(s.sides);
      const drinks = pick(s.drinks);
      const desserts = pick(s.desserts);
      return sides.length || drinks.length || desserts.length ? { mainKey: m.key, main: m.name, category: m.categoryName, price: m.priceLabel, sides, drinks, desserts } : null;
    })
    .filter((x): x is PairingView => !!x);
}

/** Pano / panel için düz metin (yeniden düzenlenebilir biçim). */
export function pairingsToText(views: readonly PairingView[]): string {
  return views
    .map((v) => {
      const cols = [v.main, v.sides.map((s) => s.name).join(", "), v.drinks.map((d) => d.name).join(", ")];
      if (v.desserts.length) cols.push(v.desserts.map((d) => d.name).join(", "));
      return cols.join(" | ");
    })
    .join("\n");
}

/**
 * Garson aracı: ürün verilirse o ürünün eşleştirmesi; konu verilirse (ör. "balık", "kebap") ana yemek adı / kategorisi
 * eşleşenler; hiçbiri yoksa tümü (kısa). Ürün çözümü sözlükle (konuşulan ad).
 */
export function findPairings(views: readonly PairingView[], products: readonly FlatProduct[], lexicon: VoiceLexicon, input: { product?: string; topic?: string }): { match: "product" | "topic" | "all"; pairings: PairingView[] } {
  if (input.product?.trim()) {
    const r = matchProduct(lexicon, input.product);
    const name = r.status === "high" || r.status === "medium" || r.status === "sold_out" ? r.product.name : null;
    const hit = name ? views.filter((v) => v.main === name) : [];
    if (hit.length) return { match: "product", pairings: hit };
  }
  // 4 harflik kök: Türkçe ses değişimini tolere eder ("balığın" → "bali" ~ "Balıklar", "levreğin" → "levr" ~ "Levrek").
  const q = fold(`${input.topic ?? ""} ${input.product ?? ""}`).split(" ").filter((w) => w.length >= 4).map((w) => w.slice(0, 4));
  if (q.length) {
    const hit = views.filter((v) => {
      const t = fold(`${v.main} ${v.category}`);
      return q.some((w) => t.split(" ").some((x) => x.startsWith(w)));
    });
    if (hit.length) return { match: "topic", pairings: hit.slice(0, 12) };
  }
  void products;
  return { match: "all", pairings: views.slice(0, 12) };
}

/** Konu / ürün için menüdeki ana yemekler (kayıtlı eşleştirme olmasa da sipariş geçmişinden öneri kurmak için). */
export function menuMainsFor(products: readonly FlatProduct[], lexicon: VoiceLexicon, input: { product?: string; topic?: string }, max = 6): FlatProduct[] {
  const mains = products.filter((p) => p.kind === "meal" && !p.soldOut);
  if (input.product?.trim()) {
    const r = matchProduct(lexicon, input.product);
    if (r.status === "high" || r.status === "medium") {
      const hit = mains.find((p) => p.key === r.product.productKey);
      if (hit) return [hit];
    }
  }
  const q = fold(`${input.topic ?? ""} ${input.product ?? ""}`).split(" ").filter((w) => w.length >= 4).map((w) => w.slice(0, 4));
  if (!q.length) return [];
  return mains.filter((p) => q.some((w) => fold(`${p.name} ${p.categoryName}`).split(" ").some((x) => x.startsWith(w)))).slice(0, max);
}

/** Sipariş birlikteliği (co-orders) sonuçlarını görünümlere ekle: misafirlerin bu yemekle en çok birlikte istedikleri. */
export function withPopular(views: readonly PairingView[], coOrders: ReadonlyMap<string, readonly { slug: string; orders: number }[]>, products: readonly FlatProduct[], options: { avoidAlcohol?: boolean } = {}): PairingView[] {
  const byKey = new Map(products.map((p) => [p.key, p]));
  return views.map((v) => {
    const popular = (coOrders.get(v.mainKey) ?? [])
      .map((c) => byKey.get(c.slug))
      .filter((p): p is FlatProduct => !!p && !p.soldOut && !(options.avoidAlcohol && isAlcoholicProduct(p)))
      .slice(0, 3)
      .map((p) => ({ name: p.name, price: p.priceLabel }));
    return popular.length ? { ...v, popular } : v;
  });
}

/** Alkol almayan / diyabetli misafir için menüdeki alkolsüz içecekler (sade olanlar önce; uydurma yok). */
export function nonAlcoholicDrinks(products: readonly FlatProduct[], max = 4): { name: string; price: string }[] {
  const plain = /(^| )(ayran|soda|su|limonata|salgam|maden suyu|cay|turk kahvesi)( |$)/;
  return products
    .filter((p) => p.kind === "drink" && !p.soldOut && !isAlcoholicProduct(p))
    .sort((a, b) => Number(!plain.test(fold(a.name))) - Number(!plain.test(fold(b.name))))
    .slice(0, max)
    .map((p) => ({ name: p.name, price: p.priceLabel }));
}

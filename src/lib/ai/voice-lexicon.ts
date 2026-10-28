import { fold, type FlatProduct } from "@/lib/ai/menu-match";

/**
 * Sesli menü sözlüğü (kiracıya özel) — DETERMİNİSTİK, saf.
 *
 * Amaç: işletme sahibi telaffuz / takma ad girmeden, müşterinin söylediği ("fetuçini alfredo", "çizburger", "kebabı",
 * "ayranlar", tanıma hatalı "mercimek çorbasi") GERÇEK menü ürününe güvenle eşlensin; eşleşme güvenilir değilse ürün
 * UYDURULMASIN. Model ürün adı çözmez: söyleneni araca verir, eşleşmeyi bu modül yapar.
 *
 *   söylenen → normalleştirme → Türkçe ek atma → fonetik anahtar → aday arama (pencere benzerliği + ayırt edici kelime
 *   kapsaması) → güven (HIGH / MEDIUM / LOW / NONE) → güvenilir ürün anahtarı
 */

// ─── Normalleştirme ──────────────────────────────────────────────────────────

/** Ölçü / paket ifadeleri ("(33 cl.)", "500 ml", "6 adet") ad eşleşmesinde gürültüdür. */
const UNIT = /\(([^)]*)\)|\b\d+([.,]\d+)?\s*(cl|ml|lt|l|gr|g|kg|adet|li|lı)\b\.?/giu;

export function normalizeText(text: string): string {
  return fold(text.replace(UNIT, " ").replace(/&/g, " ve ").replace(/[-–—_/]+/g, " "));
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

/** Konuşmada ürün adı dışındaki dolgu sözcükleri (adet, istek kalıpları). Ürün adının parçası olabilecekler YOK. */
const FILLER = new Set(
  [
    "bir", "iki", "uc", "dort", "bes", "alti", "yedi", "sekiz", "dokuz", "on", "tane", "adet", "porsiyon", "tabak", "bardak", "sise",
    "istiyorum", "isterim", "istiyoruz", "alabilir", "alabilirmiyim", "miyim", "mi", "mu", "ekle", "ekler", "eklermisin", "misin", "lutfen", "bana", "bize",
    "de", "da", "ve", "ile", "bi", "bundan", "olsun", "getir", "getirir", "getirebilir", "siparis", "ver", "verelim", "sepete",
    "a", "an", "the", "one", "two", "three", "please", "add", "i", "want", "would", "like", "we", "can", "have", "get", "me", "us", "some", "of",
    "ein", "eine", "zwei", "bitte", "ich", "mochte", "noch",
  ].map(fold),
);

// ─── Türkçe ek atma + fonetik anahtar ─────────────────────────────────────────

const SUFFIXES = ["lerini", "larini", "lerin", "larin", "leri", "lari", "ler", "lar", "sini", "sunu", "si", "su", "yi", "yu", "ni", "nu", "li", "lu", "i", "u"].map(fold);

/** Türkçe çekim / iyelik eki atma + sondaki yumuşamayı geri alma ("kebabi" → "kebap", "mercimegi" → "mercimek"). */
export function stemToken(token: string): string {
  let t = token;
  if (t.length >= 5) {
    for (const s of SUFFIXES) {
      if (t.endsWith(s) && t.length - s.length >= 3) {
        t = t.slice(0, -s.length);
        break;
      }
    }
  }
  return t.replace(/b$/, "p").replace(/d$/, "t").replace(/g$/, "k");
}

/**
 * Yazımdan bağımsız kaba ses anahtarı (her iki tarafa AYNI uygulanır): yabancı yazım kalıpları Türkçe sese yaklaştırılır,
 * çift harfler teklenir. Türkçe ç/ş zaten "fold" ile c/s olur → "fettuccine" ≈ "fetuçini", "cheese" ≈ "çiz".
 */
export function phoneticToken(token: string): string {
  const s = stemToken(token)
    .replace(/sch/g, "s")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/ck/g, "k")
    .replace(/qu/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/gn/g, "ny")
    .replace(/gh/g, "g")
    .replace(/(ee|ea|ie)/g, "i")
    .replace(/(oo|ou)/g, "u")
    .replace(/ae/g, "e")
    .replace(/(ey|ei|ay)(?=[^aeiou]|$)/g, "e")
    .replace(/c(?=[aou])/g, "k")
    .replace(/z/g, "s")
    .replace(/h(?![aeiou])/g, "")
    .replace(/(.)\1+/g, "$1");
  // Sessiz son "e" (İngilizce / İtalyanca okunuşta düşer): yalnızca 5+ harfte ve her iki tarafa aynı.
  return s.length >= 5 ? s.replace(/([^aeiou])e$/, "$1") : s;
}

export function phoneticKey(text: string): string {
  return tokenize(text).map(phoneticToken).join(" ");
}

// ─── Telaffuz varyantları ─────────────────────────────────────────────────────

/** Yaygın yabancı yemek / içecek kelimelerinin Türkçe söylenişi (deterministik sözlük; model değil). */
const FOREIGN: Record<string, string[]> = {
  cheese: ["çiz"],
  cheeseburger: ["çizburger", "çizbörger"],
  burger: ["burger", "börger"],
  hamburger: ["hamburger"],
  cheesecake: ["çizkeyk", "çizkek"],
  cake: ["keyk", "kek"],
  milkshake: ["milkşeyk"],
  shake: ["şeyk"],
  fettuccine: ["fetuçini", "fetuçine"],
  spaghetti: ["spageti"],
  penne: ["pene"],
  cappuccino: ["kapuçino"],
  espresso: ["espresso", "ekspresso"],
  latte: ["latte"],
  mocha: ["moka"],
  macchiato: ["makiato"],
  croissant: ["kruvasan"],
  sandwich: ["sandviç"],
  chicken: ["çikın"],
  nugget: ["nagit", "nugget"],
  nuggets: ["nagit"],
  wrap: ["rep", "vrap"],
  coca: ["koka"],
  cola: ["kola"],
  sprite: ["sprayt"],
  fuse: ["fuz"],
  tea: ["ti"],
  ice: ["ays"],
  schnitzel: ["şinitzel"],
  pizza: ["pizza", "piza"],
  margherita: ["margarita"],
  pepperoni: ["peperoni"],
  caesar: ["sezar"],
  brownie: ["brauni"],
  waffle: ["vafıl", "vafl"],
  pancake: ["pankek"],
  mozzarella: ["mozarella"],
  cheddar: ["çedar"],
  steak: ["steyk"],
  nachos: ["naços"],
  tortilla: ["tortilya"],
  quesadilla: ["kesadiya"],
  sushi: ["suşi"],
  noodle: ["nudıl"],
  smoothie: ["smuti"],
  frappe: ["frape"],
  tiramisu: ["tiramisu"],
  alfredo: ["alfredo"],
  bolognese: ["bolonez"],
  carbonara: ["karbonara"],
  lasagna: ["lazanya"],
  lasagne: ["lazanya"],
  risotto: ["rizotto", "risoto"],
  "hot dog": ["hotdog"],
  bbq: ["barbekü"],
  barbecue: ["barbekü"],
};

/** Kelime yabancı yazım kalıbı taşıyor mu (Türkçede olmayan harf / harf öbekleri). */
const looksForeign = (word: string) => /[qwx]|cc|ch|sh|th|ph|ee|oo|gn|gh|tt|zz|pp|ll(?=[aeiou])/.test(word);

/** İtalyanca / İngilizce yazımdan Türkçe okunuşa kural tabanlı yaklaşım ("fettuccine" → "fetuçine"). */
function transliterate(word: string): string {
  return word
    .replace(/cc([ei])/g, "ç$1")
    .replace(/sc([ei])/g, "ş$1")
    .replace(/c([ei])/g, "ç$1")
    .replace(/ch/g, "k")
    .replace(/gn/g, "ny")
    .replace(/gli/g, "li")
    .replace(/gh/g, "g")
    .replace(/sh/g, "ş")
    .replace(/(ee|ea)/g, "i")
    .replace(/oo/g, "u")
    .replace(/w/g, "v")
    .replace(/x/g, "ks")
    .replace(/q/g, "k")
    .replace(/c(?=[aou])/g, "k")
    .replace(/([bcdfgklmnprstvz])\1/g, "$1");
}

/** Türkçe konuşurken söylenebilecek biçimler (metin). Kanonik ad her zaman ilk. */
export function pronunciationVariants(name: string): string[] {
  const words = tokenize(name);
  if (!words.length) return [];
  const out = new Set<string>([words.join(" ")]);
  const joined = words.join(" ");
  // Sözlük: tek kelime + iki kelimelik öbekler.
  const dict = words.map((w, i) => FOREIGN[`${w} ${words[i + 1] ?? ""}`.trim()] ?? FOREIGN[w] ?? null);
  if (dict.some(Boolean)) out.add(words.map((w, i) => dict[i]?.[0] ?? w).join(" "));
  // Kural tabanlı Türkçe okunuş (yalnızca yabancı görünen kelimelerde).
  if (words.some(looksForeign)) {
    const tr = words.map((w) => (FOREIGN[w]?.[0] ? FOREIGN[w]![0]! : looksForeign(w) ? transliterate(w) : w));
    out.add(tr.join(" "));
    // İtalyanca "-ine" sonu Türkçede çoğunlukla "-ini" söylenir.
    out.add(tr.map((w) => w.replace(/ine$/, "ini")).join(" "));
  }
  for (const [key, alts] of Object.entries(FOREIGN)) {
    if (key.includes(" ") && joined.includes(key)) for (const alt of alts) out.add(joined.replace(key, alt));
  }
  return [...out].filter((v) => v.length >= 2).slice(0, 8);
}

// ─── Sözlük ──────────────────────────────────────────────────────────────────

export type TermKind = "canonical" | "turkish" | "partial" | "ai";
export type LexiconTerm = { text: string; key: string; kind: TermKind };
export type LexiconOption = { ref: string; name: string; terms: string[] };
export type LexiconEntry = {
  productKey: string;
  name: string;
  category: string;
  soldOut: boolean;
  terms: LexiconTerm[];
  /** Ad içindeki ayırt edici (genel olmayan) kelimelerin anahtarları — kapsama puanı için. */
  coreKeys: string[];
  /**
   * Aynı ürünün başka ad biçimleri (parantez içi açıklama, başka dildeki ad): "Yaprak Sarma (Stuffed Vine Leaves)" →
   * "Stuffed Vine Leaves"; İngilizce menüde Türkçe "Çipura Izgara". Kapsama puanı en iyi biçimden alınır.
   */
  forms?: { coreKeys: string[]; nameKeys: string[] }[];
  variants: LexiconOption[];
  modifiers: (LexiconOption & { group: string; groupRef: string })[];
};
export type Ambiguity = { kind: "collision" | "generic" | "similar"; products: string[]; term: string | null; note: string };
export type VoiceLexicon = {
  entries: LexiconEntry[];
  ambiguities: Ambiguity[];
  stats: { products: number; variants: number; modifiers: number; terms: number; ambiguous: number };
};

/** Ad olarak tek başına anlamsız / genel isimler (manuel inceleme önerilir). */
const GENERIC_NAMES = new Set(["special", "ozel", "menu", "kampanya", "combo", "set", "firsat", "gunun", "sef", "chef", "tabak", "porsiyon", "yeni", "klasik", "tavsiye"].map(fold));

/**
 * Menüden sözlük üret. `extraTerms`: kalıcı dizinde saklanan ek söyleyişler (ör. yapay zekâ ile üretilmiş, doğrulanmış)
 * — ürün anahtarına göre eklenir; menüde olmayan ürün için asla kullanılmaz.
 */
/** Parantezli ad → [parantezsiz ad, parantez içi]; parantez yoksa boş (ek biçim yok). */
function parenForms(name: string): string[] {
  const inner = [...name.matchAll(/(([^)]+))/g)].map((m) => m[1]!.trim()).filter(Boolean);
  if (!inner.length) return [];
  return [name.replace(/([^)]*)/g, " ").replace(/s+/g, " ").trim(), ...inner].filter((f) => f.length >= 2);
}

export function buildLexicon(products: readonly FlatProduct[], extraTerms: Record<string, string[]> = {}, altNames: Record<string, string[]> = {}): VoiceLexicon {
  // Ek ad biçimleri: parantez içi + başka dildeki adlar (aynı ürünün; çakışma sayılmaz).
  const extraForms = products.map((p) => {
    const all = [...parenForms(p.name), ...(altNames[p.key] ?? []).flatMap((n) => [n, ...parenForms(n)])];
    const seen = new Set([phoneticKey(p.name)]);
    return all.filter((f) => {
      const k = phoneticKey(f);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
  // Kelime sıklığı: birçok üründe geçen kelime (çorbası, kebap, dürüm) ayırt edici değildir. Ürün başına bir kez sayılır.
  const tokenFreq = new Map<string, number>();
  const productTokens = products.map((p) => [...new Set(tokenize(p.name).map(phoneticToken))]);
  products.forEach((p, i) => {
    const all = new Set([...productTokens[i]!, ...extraForms[i]!.flatMap((f) => tokenize(f).map(phoneticToken))]);
    for (const t of all) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
  });
  const categoryKeys = new Set(products.flatMap((p) => tokenize(p.categoryName).map(phoneticToken)));
  const generic = (k: string) => (tokenFreq.get(k) ?? 0) >= 3 || categoryKeys.has(k) || [...categoryKeys].some((c) => c.length >= 4 && (k.startsWith(c) || c.startsWith(k)));

  const entries: LexiconEntry[] = products.map((p, i) => {
    const terms = new Map<string, LexiconTerm>();
    const add = (text: string, kind: TermKind) => {
      const key = phoneticKey(text);
      if (key.replace(/\s/g, "").length >= 2 && !terms.has(key)) terms.set(key, { text: normalizeText(text), key, kind });
    };
    const variants = pronunciationVariants(p.name);
    variants.forEach((v, vi) => add(v, vi === 0 ? "canonical" : "turkish"));
    // Ayırt edici tek kelimeler ("alfredo", "fetuçini", "ezogelin") — yalnızca bu üründe geçiyorsa.
    for (const v of variants)
      for (const w of tokenize(v)) {
        const k = phoneticToken(w);
        if (k.length >= 4 && (tokenFreq.get(k) ?? 0) <= 1 && !generic(k) && !GENERIC_NAMES.has(w)) add(w, "partial");
      }
    for (const extra of extraTerms[p.key] ?? []) add(extra, "ai");
    const forms = extraForms[i]!.map((form) => {
      const fv = pronunciationVariants(form);
      fv.forEach((v, vi) => add(v, vi === 0 ? "canonical" : "turkish"));
      for (const v of fv)
        for (const w of tokenize(v)) {
          const k = phoneticToken(w);
          if (k.length >= 4 && (tokenFreq.get(k) ?? 0) <= 1 && !generic(k) && !GENERIC_NAMES.has(w)) add(w, "partial");
        }
      const toks = [...new Set(tokenize(form).map(phoneticToken))];
      const core = toks.filter((k) => !generic(k) && k.length >= 2);
      return { coreKeys: core.length ? core : toks, nameKeys: phoneticKey(form).split(" ").filter(Boolean) };
    });
    const coreKeys = productTokens[i]!.filter((k) => !generic(k) && k.length >= 2);
    return {
      productKey: p.key,
      name: p.name,
      category: p.categoryName,
      soldOut: p.soldOut,
      terms: [...terms.values()],
      coreKeys: coreKeys.length ? coreKeys : productTokens[i]!,
      ...(forms.length ? { forms } : {}),
      variants: p.variants.map((v) => ({ ref: v.ref, name: v.name, terms: pronunciationVariants(v.name) })),
      modifiers: p.modifierGroups.flatMap((g) => g.modifiers.map((m) => ({ ref: m.ref, name: m.name, terms: pronunciationVariants(m.name), group: g.name, groupRef: g.ref }))),
    };
  });

  // Belirsizlikler: aynı söyleyiş iki üründe (çakışma) → o kısmi terim ikisinden de çıkarılır; genel isimler; çok benzer adlar.
  const ambiguities: Ambiguity[] = [];
  const owners = new Map<string, LexiconEntry[]>();
  for (const e of entries) for (const t of e.terms) owners.set(t.key, [...(owners.get(t.key) ?? []), e]);
  for (const [key, list] of owners) {
    if (list.length < 2) continue;
    // Gerçek ad çakışması yalnızca menüden türeyen (yapay zekâ olmayan) terimler çakışıyorsa: yapay zekâ söyleyişi başka
    // ürünle çakışırsa sessizce atılır, incelemeye düşmez (işletmeye gereksiz iş çıkmaz).
    const derived = list.filter((e) => e.terms.some((t) => t.key === key && t.kind !== "ai"));
    for (const e of list) e.terms = e.terms.filter((t) => t.key !== key || t.kind === "canonical");
    if (derived.length >= 2) ambiguities.push({ kind: "collision", products: derived.map((e) => e.name), term: key, note: "Aynı söyleyiş birden fazla ürüne uyuyor; müşteriye hangisi olduğu sorulur." });
  }
  for (const e of entries) {
    const words = tokenize(e.name);
    if (!words.length || words.every((w) => GENERIC_NAMES.has(w) || /^\d+$/.test(w)))
      ambiguities.push({ kind: "generic", products: [e.name], term: null, note: "Ad tek başına ürünü tarif etmiyor (ör. 'Special', 'Menü 1'); müşteri bu adı söylemekte zorlanabilir." });
  }
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!.terms[0]?.key.replace(/\s/g, "") ?? "";
      const b = entries[j]!.terms[0]?.key.replace(/\s/g, "") ?? "";
      if (a && b && a !== b && similarity(a, b) >= 0.9)
        ambiguities.push({ kind: "similar", products: [entries[i]!.name, entries[j]!.name], term: null, note: "Adlar söylenişte neredeyse aynı; eşleşmede onay sorulur." });
    }

  return {
    entries,
    ambiguities,
    stats: {
      products: entries.length,
      variants: entries.reduce((s, e) => s + e.variants.length, 0),
      modifiers: entries.reduce((s, e) => s + e.modifiers.length, 0),
      terms: entries.reduce((s, e) => s + e.terms.length, 0),
      ambiguous: ambiguities.length,
    },
  };
}

/** Menü özeti (dizin eskidi mi?): ad / kategori / varyant / ekstra / tükendi. */
export function menuFingerprint(products: readonly FlatProduct[]): string {
  const parts = products
    .map((p) => [p.key, p.name, p.categoryName, p.soldOut ? 1 : 0, p.variants.map((v) => v.name).join("|"), p.modifierGroups.map((g) => `${g.name}:${g.modifiers.map((m) => m.name).join("|")}`).join(";")].join("~"))
    .sort();
  let h = 2166136261;
  for (const ch of parts.join("\n")) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return `${products.length}-${h.toString(36)}`;
}

// ─── Eşleştirme ──────────────────────────────────────────────────────────────

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return 1 - row[b.length]! / Math.max(a.length, b.length);
}

const KIND_WEIGHT: Record<TermKind, number> = { canonical: 1, turkish: 1, ai: 0.97, partial: 0.93 };
export const MATCH_THRESHOLDS = { high: 0.86, margin: 0.06, medium: 0.7, low: 0.55 } as const;

export type MatchCandidate = { productKey: string; name: string; score: number; soldOut: boolean; via: string };
export type MatchResult =
  | { status: "high"; product: MatchCandidate; candidates: MatchCandidate[] }
  | { status: "medium"; product: MatchCandidate; candidates: MatchCandidate[] }
  | { status: "ambiguous"; candidates: MatchCandidate[] }
  | { status: "sold_out"; product: MatchCandidate; candidates: MatchCandidate[] }
  | { status: "low"; candidates: MatchCandidate[] }
  | { status: "none"; candidates: MatchCandidate[] };

/** Söylenen metindeki ürün adı adayları (dolgu sözcükleri atılmış fonetik kelimeler). */
function spokenKeys(spoken: string): string[] {
  return tokenize(spoken)
    .filter((w) => !FILLER.has(w) && !/^\d+$/.test(w))
    .map(phoneticToken)
    .filter(Boolean);
}

function scoreEntry(entry: LexiconEntry, keys: string[], vocabulary: ReadonlySet<string> = new Set()): { score: number; via: string } {
  let best = { score: 0, via: "" };
  // Başka dildeki biçimi olan üründe: söylenen ve menüde geçen bir kelime bu ürünün HİÇBİR adında yoksa ("sea BREAM" →
  // Sea Bass) ses benzerliği de güven kaybeder. Tek adlı (yalnızca varsayılan dil) menüde davranış değişmez.
  const allNameKeys = entry.forms?.length ? [...(entry.terms[0]?.key ?? "").split(" "), ...entry.forms.flatMap((f) => f.nameKeys)].filter(Boolean) : null;
  const windowPenalty = allNameKeys && keys.some((k) => vocabulary.has(k) && !allNameKeys.some((n) => similarity(k, n) >= 0.84)) ? 0.85 : 1;
  // 1) Pencere benzerliği: terimin kelime sayısı ±1 uzunluğundaki ardışık söylenen kelimeler (boşluksuz karşılaştırma).
  for (const term of entry.terms) {
    const n = term.key.split(" ").length;
    const flat = term.key.replace(/\s/g, "");
    for (let len = Math.max(1, n - 1); len <= Math.min(keys.length, n + 1); len++)
      for (let i = 0; i + len <= keys.length; i++) {
        const s = similarity(keys.slice(i, i + len).join(""), flat) * KIND_WEIGHT[term.kind] * windowPenalty;
        if (s > best.score) best = { score: s, via: term.text };
      }
  }
  // 2) Ayırt edici kelime kapsaması ("kelle paça" → "Kelle Paça Çorbası"; genel "çorbası" aranmaz).
  const forms = [{ coreKeys: entry.coreKeys, nameKeys: (entry.terms[0]?.key ?? "").split(" ").filter(Boolean) }, ...(entry.forms ?? [])];
  for (const form of forms) {
    if (!form.coreKeys.length) continue;
    const hits = form.coreKeys.filter((c) => keys.some((k) => similarity(k, c) >= 0.84)).length;
    // Söylenen ve menüde geçen başka bir kelime bu ürünün adında yoksa ("LEVREK buğulama" → Hamsi Buğulama) kapsam
    // güveni düşer: ortak kelimeli ürünler arasında söylenen ayırt edici kelimeyi taşıyan ürün öne geçer.
    const conflict = keys.some((k) => vocabulary.has(k) && !form.nameKeys.some((n) => similarity(k, n) >= 0.84));
    const coverage = (hits / form.coreKeys.length) * 0.95 * (conflict ? 0.7 : 1);
    if (hits && coverage > best.score) best = { score: coverage, via: `${hits}/${form.coreKeys.length} kelime` };
  }
  return best;
}

/**
 * Söyleneni menüye eşle. YÜKSEK → doğrudan; ORTA → onay sorulur; iki güçlü aday → hangisi diye sorulur; tükendi →
 * otomatik seçilmez; DÜŞÜK → tekrar istenir; YOK → "menüde yok" (ürün UYDURULMAZ). En fazla `limit` aday döner.
 */
export function matchProduct(lexicon: VoiceLexicon, spoken: string, limit = 5): MatchResult {
  const keys = spokenKeys(spoken);
  if (!keys.length) return { status: "none", candidates: [] };
  const vocabulary = new Set(lexicon.entries.flatMap((e) => [...(e.terms[0]?.key ?? "").split(" "), ...(e.forms ?? []).flatMap((f) => f.nameKeys)].filter(Boolean)));
  const scored = lexicon.entries
    .map((e) => {
      const s = scoreEntry(e, keys, vocabulary);
      return { productKey: e.productKey, name: e.name, score: Math.round(s.score * 1000) / 1000, soldOut: e.soldOut, via: s.via };
    })
    .filter((c) => c.score >= MATCH_THRESHOLDS.low * 0.9)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const [top, second] = scored;
  if (!top || top.score < MATCH_THRESHOLDS.medium) {
    // Söylenen kelimelerin TAMAMI yalnızca bir / birkaç ürünün adında geçiyorsa ("grilled sea bream" → Grilled Gilthead
    // Sea Bream): tek ürün → onay sorulur; birkaç ürün → hangisi diye sorulur. Ortak tek kelimeden daha isabetli.
    const nameKeysOf = (e: LexiconEntry) => [...(e.terms[0]?.key ?? "").split(" "), ...(e.forms ?? []).flatMap((f) => f.nameKeys)].filter(Boolean);
    const containsAll = lexicon.entries.filter((e) => keys.every((x) => nameKeysOf(e).some((k) => similarity(x, k) >= 0.9)));
    const asCandidate = (e: LexiconEntry): MatchCandidate => ({ productKey: e.productKey, name: e.name, score: MATCH_THRESHOLDS.medium, soldOut: e.soldOut, via: "tüm kelimeler" });
    if (containsAll.length === 1 && keys.length >= 2) {
      const only = asCandidate(containsAll[0]!);
      return only.soldOut ? { status: "sold_out", product: only, candidates: [only] } : { status: "medium", product: only, candidates: [only] };
    }
    if (containsAll.length >= 2 && containsAll.length <= limit) return { status: "ambiguous", candidates: containsAll.map(asCandidate) };
    // Yalnızca birden çok ürünün ortak kelimesi söylendi ("kebap", "kelle") → hangisi diye sorulur (tahmin yok).
    const shared = lexicon.entries.filter((e) => e.terms[0] && [...e.terms[0].key.split(" "), ...(e.forms ?? []).flatMap((f) => f.nameKeys)].some((k) => keys.some((x) => similarity(x, k) >= 0.9)));
    if (shared.length >= 2)
      return { status: "ambiguous", candidates: shared.slice(0, limit).map((e) => ({ productKey: e.productKey, name: e.name, score: MATCH_THRESHOLDS.medium, soldOut: e.soldOut, via: "ortak kelime" })) };
  }
  if (!top || top.score < MATCH_THRESHOLDS.low) return { status: "none", candidates: scored };
  if (top.score < MATCH_THRESHOLDS.medium) return { status: "low", candidates: scored };
  const close = second && top.score - second.score < MATCH_THRESHOLDS.margin && second.score >= MATCH_THRESHOLDS.medium;
  if (close) return { status: "ambiguous", candidates: scored.filter((c) => top.score - c.score < MATCH_THRESHOLDS.margin) };
  if (top.soldOut) return { status: "sold_out", product: top, candidates: scored };
  return top.score >= MATCH_THRESHOLDS.high ? { status: "high", product: top, candidates: scored } : { status: "medium", product: top, candidates: scored };
}

/** Söylenende geçen varyant / ekstra adları (sözlük terimleriyle; "büyük", "orta pişmiş"). */
export function detectOptions(entry: LexiconEntry, spoken: string): { variant: LexiconOption | null; modifiers: LexiconEntry["modifiers"] } {
  const keys = spokenKeys(` ${spoken} `.replace(/\s(bir|iki|uc)\s/g, " "));
  const flat = keys.join(" ");
  const hit = (terms: string[]) => terms.some((t) => {
    const k = phoneticKey(t);
    return !!k && (` ${flat} `.includes(` ${k} `) || keys.some((x) => similarity(x, k.replace(/\s/g, "")) >= 0.88));
  });
  return { variant: entry.variants.find((v) => hit(v.terms)) ?? null, modifiers: entry.modifiers.filter((m) => hit(m.terms)) };
}

export type SpokenResolution = { ok: true; product: FlatProduct; confidence: "exact" | "high" } | { ok: false; status: Exclude<MatchResult["status"], "high">; output: Record<string, unknown> };

/**
 * Söylenen ürün adını GÜVENİLİR ürüne çevir (araçlar bunu kullanır; model ürün adı çözmez). Tam anahtar / ad → doğrudan;
 * aksi halde sözlük eşleşmesi. YÜKSEK dışındaki her durumda ürün DÖNMEZ — araç modele ne söyleyeceğini döner.
 */
export function resolveSpokenProduct(lexicon: VoiceLexicon, products: readonly FlatProduct[], phrase: string): SpokenResolution {
  const norm = normalizeText(phrase);
  const exact = products.find((p) => p.key === phrase.trim().toLowerCase() || normalizeText(p.name) === norm);
  if (exact) return exact.soldOut ? { ok: false, status: "sold_out", output: { ok: false, reason: "sold_out", name: exact.name } } : { ok: true, product: exact, confidence: "exact" };
  const r = matchProduct(lexicon, phrase);
  const byKey = (key: string) => products.find((p) => p.key === key) ?? null;
  switch (r.status) {
    case "high": {
      const p = byKey(r.product.productKey);
      return p ? { ok: true, product: p, confidence: "high" } : { ok: false, status: "none", output: { ok: false, reason: "not_on_menu", say: "Menümüzde bu isimde bir ürün bulamadım." } };
    }
    case "medium":
      return { ok: false, status: "medium", output: { ok: false, needs: "confirm", candidate: r.product.name, say: `«${r.product.name}» mı demek istediniz?` } };
    case "ambiguous":
      return { ok: false, status: "ambiguous", output: { ok: false, needs: "choose", options: r.candidates.map((c) => c.name).slice(0, 4), say: "Hangisini istersiniz?" } };
    case "sold_out":
      return { ok: false, status: "sold_out", output: { ok: false, reason: "sold_out", name: r.product.name } };
    case "low":
      return { ok: false, status: "low", output: { ok: false, needs: "repeat", say: "Tam anlayamadım; ürünün adını tekrar eder misiniz?" } };
    case "none":
      return { ok: false, status: "none", output: { ok: false, reason: "not_on_menu", say: "Menümüzde bu isimde bir ürün bulamadım." } };
  }
}

/**
 * Müşterinin GERÇEKTE söylediği (konuşma tanıma metni) bu ürünü destekliyor mu? Model adı kendisi "düzeltmiş" olabilir
 * ("çökürtme kebi" → "çökertme kebabı"); bu durumda ürün onaysız eklenmez.
 *   strong: söylenen bu ürüne YÜKSEK güvenle uyuyor · weak: benziyor ama emin değil · none: hiç benzemiyor
 */
export function heardSupports(lexicon: VoiceLexicon, heard: string, productKey: string): "strong" | "weak" | "none" {
  const keys = spokenKeys(heard);
  const entry = lexicon.entries.find((e) => e.productKey === productKey);
  if (!keys.length || !entry) return "none";
  const s = scoreEntry(entry, keys).score;
  return s >= MATCH_THRESHOLDS.high ? "strong" : s >= MATCH_THRESHOLDS.low ? "weak" : "none";
}

/** Müşterinin son sözü açık bir onay mı ("evet", "olur", "aynen", "yes")? */
export function isAffirmative(text: string): boolean {
  return /\b(evet|olur|tamam|aynen|dogru|onayliyorum|o olsun|yes|yeah|yep|sure|correct|ja|genau|da|نعم)\b/u.test(fold(text));
}

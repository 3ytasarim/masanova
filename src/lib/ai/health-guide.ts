import { fold, type FlatProduct } from "@/lib/ai/menu-match";

/**
 * Sağlık durumuna göre menü rehberi — SAF ve deterministik. Müşteri "şeker hastasıyım", "tansiyonum var", "hamileyim"
 * dediğinde asistan bu rehberi kullanır: menüdeki GERÇEK ürünler genel beslenme kurallarıyla üç gruba ayrılır
 * (uygun / ölçülü / kaçınılmalı) ve her birine kısa gerekçe + mutfağa not edilebilecek değişiklik önerisi eklenir.
 *
 * Sınırlar (bilinçli): tıbbi teşhis / doz / tedavi yok; ürün içeriği restoranın girdiği bilgiden ve ad / kategoriden
 * çıkarılır (genel tarif varsayımı) — bu yüzden çıktı her zaman "genel bilgi" uyarısı ve personele danışma önerisi taşır.
 * Değişiklik önerileri (pilav yerine bulgur gibi) restoranın garantisi DEĞİLDİR: mutfağa not olarak iletilir.
 */
export const HEALTH_CONDITIONS = ["diabetes", "hypertension", "pregnancy", "heart", "celiac"] as const;
export type HealthCondition = (typeof HEALTH_CONDITIONS)[number];
export type HealthTier = "good" | "moderate" | "avoid";
export type HealthVerdict = { tier: HealthTier; why: string; swap?: string };

export const HEALTH_LABELS: Record<HealthCondition, string> = {
  diabetes: "Diyabet (şeker hastalığı)",
  hypertension: "Yüksek tansiyon",
  pregnancy: "Hamilelik",
  heart: "Kalp sağlığı / kolesterol",
  celiac: "Çölyak / gluten hassasiyeti",
};

const w = (words: string) => new RegExp(`(?:^| )(?:${words})(?= |$)`);

const SUGARY_DRINK = w("kola|cola|coca cola|fanta|sprite|gazoz|ice tea|icetea|cappy|meyve suyu|nektar|limonata|serbet|milkshake|frappe|sicak cikolata|cikolata|red ?bull|redbul|redbull|enerji icecegi|tonik|sira|portakal suyu|sikma portakal");
const BEER = w("bira|beer|efes|efes pilsen|tuborg|carlsberg|miller|corona|bomonti|amsterdam|malt|filtresiz|heineken|guinness");
const SWEET_ALCOHOL = w("aperol|spritz|likor|kokteyl|cocktail|mojito|margarita|baileys");
const ALCOHOL = w("raki|sarap|wine|viski|whisky|whiskey|votka|vodka|cin|gin|tekila|tequila|konyak|rom|sampanya|prosecco|shot|black label|red label|jim beam|smirnoff|absolut|finlandia|gordons|yeni raki|tekirdag|beylerbeyi|efe|kulup|altin seri|sari zeybek");
const FRUIT = w("meyve|meyve tabagi|karpuz|kavun|kiraz|erik|elma|cilek|uzum|incir|seftali|portakal");
const DOUGH = w("lahmacun|pide|durum|borek|boregi|manti|makarna|spagetti|pizza|hamburger|burger|sandvic|tost|lavas|ekmek|pogaca|simit|gozleme|pane|pacanga|sigara boregi|bazlama");
const RICE_POTATO = w("pilav|patates|patates tava|elma dilim|pure|kizartma patates");
const FRIED = w("tava|pane|kizartma|citir|mucver|sigara boregi|pacanga|nugget|schnitzel|sinitzel");
const GRILL = w("izgara|sis|kebap|kebab|kebabi|pirzola|kofte|biftek|bonfile|antrikot|bugulama|firinda|sote|kavurma|kanat|tavuk|adana|urfa|iskender|doner");
const FISH = w("balik|levrek|cipura|somon|hamsi|palamut|lufer|barbun|cinekop|mezgit|uskumru|sardalya|istavrit|ahtapot|kalamar|karides|midye|tekir|sarikanat|lakerda|ciroz|orkinos|ton balikli");
const SALAD_MEZE = w("salata|salatasi|salad|sogus|roka|cacik|haydari|yogurt|yogurtlu|ezme|piyaz|borulce|borulcesi|semizotu|enginar|fava|humus|patlican|zeytinyagli|pazi|tarator|muhammara|atom|borani|pilaki|sarma|biber|kabak cicegi|cibez|kaya korugu|mantar");
const LEGUME = w("fava|humus|piyaz|mercimek|nohut|barbunya|pilaki|borulce");
const SOUP = w("corba|corbasi|soup");
const GOOD_DRINK = w("su|kucuk su|maden suyu|soda|sade soda|ayran|kefir|turk kahvesi|espresso|americano|doppio|filtre kahve|cay|bardak cay|fincan cay|bitki cayi|ihlamur|nane limon|salgam|salgam acili|salgam acisiz");
const COFFEE = w("kahve|kahvesi|espresso|americano|doppio|latte|cappuccino|macchiato|nescafe|filtre kahve|mocha");
const SALTY = w("tursu|tursusu|pastirma|pastirmali|sucuk|salam|sosis|ciroz|lakerda|tuzlu|zeytin|beyaz peynir|peynir|kasar|kasarli|tulum|salgam|soya|cips|kaya korugu|kornison|isli|marin|kuru domatesli|cerez");
const RAW_CURED = w("lakerda|ciroz|marin|levrek marin|uskumru marin|tartar|carpaccio|susi|sushi|ceviche|cig|isli|isli hamsi|isli et|karides sogus");
const FATTY = w("tereyagli|tereyag|kavurma|doner|sucuk|pastirma|kuzu pirzola|kremali|kasarli|peynirli|kaymak|saç kavurma|sac kavurma");
const OILY_FISH = w("somon|uskumru|sardalya|hamsi|palamut|lufer|levrek|cipura");
const GLUTEN_WORDS = w("lahmacun|pide|durum|borek|boregi|manti|makarna|pizza|hamburger|burger|sandvic|tost|lavas|ekmek|bulgur|pane|un|irmik|kemalpasa|baklava|kadayif|kunefe|pacanga|bira|biralar|malt|kek|pasta|kurabiye|gozleme|bazlama|cerez");

type Classifier = (p: FlatProduct, t: string, cat: string) => HealthVerdict;

const isAlcohol = (t: string, cat: string) => BEER.test(t) || ALCOHOL.test(t) || SWEET_ALCOHOL.test(t) || /(raki|sarap|viski|votka|bira|cin|kokteyl|alkol)/.test(cat);
const isBeer = (t: string, cat: string) => BEER.test(t) || /bira/.test(cat);

const CLASSIFIERS: Record<HealthCondition, Classifier> = {
  diabetes(p, t, cat) {
    if (p.kind === "dessert" && FRUIT.test(t)) return { tier: "moderate", why: "Meyvede doğal şeker var; küçük porsiyon tercih edilmeli." };
    if (p.kind === "dessert") return { tier: "avoid", why: "Tatlılar yüksek şeker içerir, kan şekerini hızla yükseltir." };
    if (isBeer(t, cat)) return { tier: "avoid", why: "Bira arpa maltından yapılır; karbonhidratı yüksektir ve kan şekerini yükseltir." };
    if (SWEET_ALCOHOL.test(t)) return { tier: "avoid", why: "Likör ve kokteyller şeker şurubu içerir." };
    if (isAlcohol(t, cat)) return { tier: "avoid", why: "Alkol kan şekerinde dalgalanmaya, ilaç kullananlarda ani düşmeye yol açabilir; önerilmez." };
    if (p.kind === "drink" && /(zero|light|diyet|diet|sekersiz)/.test(t)) return { tier: "good", why: "Şekersiz seçenek." };
    if (SUGARY_DRINK.test(t)) return { tier: "avoid", why: "Şekerli içecekler kan şekerini çok hızlı yükseltir." };
    if (p.kind === "drink" && GOOD_DRINK.test(t)) return COFFEE.test(t) || /cay/.test(t) ? { tier: "good", why: "Şekersiz içilirse uygundur.", swap: "Şekersiz olsun" } : { tier: "good", why: "Şeker içermez." };
    if (p.kind === "drink") return { tier: "moderate", why: "Şeker içeriği belirtilmemiş; şekersiz seçenek sorulmalı." };
    // Hamur işi / pilav / kızartma ÜRÜNÜN KENDİSİ mi (ad), yoksa yalnızca garnitür mü (içindekiler)? Garnitürse değişiklik önerilir.
    const nm = fold(p.name);
    if (RICE_POTATO.test(nm) && !GRILL.test(nm) && !FISH.test(nm)) return { tier: "avoid", why: "Pilav ve patates rafine karbonhidrattır, kan şekerini hızlı yükseltir.", swap: "Yerine salata" };
    if (DOUGH.test(nm)) return { tier: "moderate", why: "Beyaz un / hamur işi kan şekerini hızlı yükseltir; porsiyon küçük tutulmalı.", swap: "Lavaş / ekmek az olsun, yanına salata" };
    if (FRIED.test(nm)) return { tier: "moderate", why: "Kızartma; ızgara seçenek daha uygundur." };
    if (GRILL.test(t) || FISH.test(t))
      return { tier: "good", why: "Protein ağırlıklı; kan şekerini yavaş etkiler.", swap: "Yanında pilav / patates varsa bulgur ya da salata ile değiştirilsin, lavaş az olsun" };
    if (LEGUME.test(t)) return { tier: "good", why: "Baklagil; lifli ve yavaş sindirilir." };
    if (SALAD_MEZE.test(t) || /(salata|meze)/.test(cat)) return { tier: "good", why: "Sebze ağırlıklı ve lifli; kan şekerini dengeler." };
    if (SOUP.test(t)) return { tier: "moderate", why: "Çorbanın içeriğine göre değişir; un / pirinç azsa uygundur." };
    return { tier: "moderate", why: "İçerik bilgisi sınırlı; porsiyon ve garnitür sorulmalı." };
  },
  hypertension(p, t, cat) {
    if (SALTY.test(t)) return { tier: "avoid", why: "Turşu, salamura, kurutulmuş / tütsülenmiş ve peynirli ürünler tuzu yüksektir." };
    if (isAlcohol(t, cat)) return { tier: "moderate", why: "Alkol tansiyonu yükseltebilir; ölçülü olunmalı." };
    if (p.kind === "drink" && /(maden suyu|soda|ayran)/.test(t)) return { tier: "moderate", why: "Sodyum (tuz) içerir." };
    if (p.kind === "drink" && GOOD_DRINK.test(t)) return { tier: "good", why: "Tuz içermez." };
    if (p.kind === "dessert") return { tier: "moderate", why: "Tuz az ama şeker / yağ yüksek; küçük porsiyon." };
    if (FRIED.test(t)) return { tier: "moderate", why: "Kızartma; ızgara daha uygundur." };
    if (GRILL.test(t) || FISH.test(t)) return { tier: "good", why: "Izgara / buğulama tuz eklenmeden hazırlanabilir.", swap: "Az tuzlu olsun" };
    if (SALAD_MEZE.test(t) || /(salata|meze)/.test(cat)) return { tier: "good", why: "Sebze ağırlıklı; tuzu ayrı istenebilir.", swap: "Tuz ve sos ayrı gelsin" };
    return { tier: "moderate", why: "Tuz miktarı belirtilmemiş; az tuzlu hazırlanması istenebilir.", swap: "Az tuzlu olsun" };
  },
  pregnancy(p, t, cat) {
    if (isAlcohol(t, cat)) return { tier: "avoid", why: "Hamilelikte alkol hiçbir miktarda önerilmez." };
    if (RAW_CURED.test(t)) return { tier: "avoid", why: "Çiğ, marine, tütsülenmiş ya da kurutulmuş balık / et hamilelikte önerilmez (listeria riski)." };
    if (COFFEE.test(t) || /(kola|cola|red ?bull|redbul)/.test(t)) return { tier: "moderate", why: "Kafein içerir; gün içinde sınırlı tüketilmeli." };
    if (p.kind === "dessert") return { tier: "moderate", why: "Şeker yüksek; küçük porsiyon." };
    if (GRILL.test(t) || FISH.test(t)) return { tier: "good", why: "Protein kaynağı; iyi pişmiş olması önemlidir.", swap: "İyi pişmiş olsun" };
    if (SALAD_MEZE.test(t) || /(salata|meze)/.test(cat)) return { tier: "good", why: "Lifli ve vitaminli; iyi yıkanmış sebze ile." };
    if (p.kind === "drink" && GOOD_DRINK.test(t)) return { tier: "good", why: "Uygundur." };
    return { tier: "moderate", why: "İçeriği personele sorulabilir." };
  },
  heart(p, t, cat) {
    if (FRIED.test(t)) return { tier: "avoid", why: "Kızartmalar doymuş / trans yağ açısından risklidir." };
    if (FATTY.test(t)) return { tier: "moderate", why: "Tereyağı, kavurma ve işlenmiş et yağlıdır; ölçülü olunmalı." };
    if (OILY_FISH.test(t)) return { tier: "good", why: "Omega-3 açısından zengin balık; kalp sağlığı için uygundur." };
    if (isAlcohol(t, cat)) return { tier: "moderate", why: "Alkol ölçülü tüketilmeli." };
    if (p.kind === "dessert") return { tier: "moderate", why: "Şeker ve yağ yüksek; küçük porsiyon." };
    if (GRILL.test(t) || FISH.test(t)) return { tier: "good", why: "Izgara, yağsız pişirme.", swap: "Tereyağı yerine zeytinyağı ile" };
    if (LEGUME.test(t) || SALAD_MEZE.test(t) || /(salata|meze)/.test(cat)) return { tier: "good", why: "Zeytinyağlı, sebze ve baklagil ağırlıklı." };
    if (p.kind === "drink" && GOOD_DRINK.test(t)) return { tier: "good", why: "Uygundur." };
    return { tier: "moderate", why: "Hazırlanışı personele sorulabilir." };
  },
  celiac(p, t) {
    if (p.allergens.some((a) => a.code === "gluten")) return { tier: "avoid", why: "Restoran bu üründe gluten olduğunu belirtmiş." };
    if (GLUTEN_WORDS.test(t) || BEER.test(t)) return { tier: "avoid", why: "Genel tarifinde buğday / arpa (gluten) bulunur." };
    if (GRILL.test(t) || FISH.test(t) || SALAD_MEZE.test(t))
      return { tier: "moderate", why: "Doğal olarak glutensiz olabilir; marine, sos ve çapraz bulaşma için personele danışılmalı.", swap: "Gluten hassasiyeti var, lavaş / ekmek gelmesin" };
    return { tier: "moderate", why: p.allergenInfoDeclared ? "Restoran gluten belirtmemiş; çapraz bulaşma için personele danışılmalı." : "Alerjen bilgisi girilmemiş; personele danışılmalı." };
  },
};

const GENERAL_TIPS: Record<HealthCondition, string[]> = {
  diabetes: [
    "Tabağın yarısı sebze / salata, çeyreği protein, çeyreği tam tahıl (bulgur gibi) olmalı.",
    "Beyaz pilav, patates, beyaz ekmek ve lavaş yerine bulgur ya da salata daha uygundur.",
    "Şekerli içecek, bira ve tatlı yerine su, maden suyu, ayran ya da şekersiz çay / kahve.",
  ],
  hypertension: ["Turşu, salamura, tütsülenmiş ürünler ve peynirlerde tuz yüksektir.", "Izgara ve buğulama 'az tuzlu' istenebilir; sos ve tuz ayrı gelebilir."],
  pregnancy: ["Alkol, çiğ / marine / tütsülenmiş balık ve az pişmiş et önerilmez.", "Kafein sınırlı tutulmalı; et ve balık iyi pişmiş olmalı."],
  heart: ["Kızartma yerine ızgara / buğulama, tereyağı yerine zeytinyağı.", "Yağlı balıklar (somon, uskumru, sardalya) omega-3 açısından iyidir."],
  celiac: ["Lavaş, ekmek, bulgur, hamur işi, pane ve bira gluten içerir.", "Çapraz bulaşma riski için mutlaka personele danışılmalı."],
};

export const HEALTH_DISCLAIMER = "Genel beslenme bilgisidir; doktorunuzun / diyetisyeninizin önerisi önceliklidir. İçerikler restoranın girdiği bilgiye ve genel tariflere dayanır.";

/** Alkollü içecek mi? (diyabet / hamilelik / "alkol almıyorum" tercihinde eşleştirmelerden çıkarılır) */
export function isAlcoholicProduct(p: FlatProduct): boolean {
  const t = fold(`${p.name} ${p.categoryName} ${p.shortDescription ?? ""}`);
  return p.kind === "drink" && isAlcohol(t, fold(p.categoryName));
}

export function classifyForHealth(p: FlatProduct, condition: HealthCondition): HealthVerdict {
  const text = fold([p.name, p.categoryName, p.shortDescription ?? "", p.description ?? "", ...p.ingredients].join(" "));
  return CLASSIFIERS[condition](p, text, fold(p.categoryName));
}

export type HealthGuideItem = { key: string; name: string; category: string; priceLabel: string; why: string; swap?: string };
export type HealthGuide = {
  condition: HealthCondition;
  label: string;
  good: HealthGuideItem[];
  moderate: HealthGuideItem[];
  avoid: HealthGuideItem[];
  swaps: string[];
  tips: string[];
  disclaimer: string;
};

/** Kategoriler arasında dönerek seç (yalnızca salata değil: ana yemek, meze, içecek karışık). */
function diverse<T extends { category: string }>(items: T[], limit: number): T[] {
  const byCat = new Map<string, T[]>();
  for (const i of items) byCat.set(i.category, [...(byCat.get(i.category) ?? []), i]);
  const out: T[] = [];
  const queues = [...byCat.values()];
  while (out.length < limit && queues.some((q) => q.length)) for (const q of queues) if (q.length && out.length < limit) out.push(q.shift()!);
  return out;
}

const KIND_ORDER: Record<FlatProduct["kind"], number> = { meal: 0, drink: 1, dessert: 2 };

export function buildHealthGuide(products: readonly FlatProduct[], condition: HealthCondition, options: { kind?: "meal" | "drink" | "dessert" | "any"; query?: string; limit?: number } = {}): HealthGuide {
  const limit = Math.min(Math.max(options.limit ?? 8, 3), 12);
  const q = options.query ? fold(options.query) : "";
  const pool = products
    .filter((p) => !p.soldOut)
    .filter((p) => !options.kind || options.kind === "any" || p.kind === options.kind)
    .filter((p) => !q || p.search.includes(q) || fold(p.name).includes(q) || fold(p.categoryName).includes(q))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(b.featured) - Number(a.featured));
  const rows = pool.map((p) => ({ p, v: classifyForHealth(p, condition) }));
  const item = ({ p, v }: (typeof rows)[number]): HealthGuideItem => ({ key: p.key, name: p.name, category: p.categoryName, priceLabel: p.priceLabel, why: v.why, ...(v.swap ? { swap: v.swap } : {}) });
  const tier = (t: HealthTier) => rows.filter((r) => r.v.tier === t).map(item);
  // "Uygun" listesinde önce ana yemekler (doyurucu öğün), sonra meze / salata, sonra içecek — kategori çeşitliliğiyle.
  const good = tier("good");
  const meals = diverse(good.filter((g) => products.find((p) => p.key === g.key)?.kind === "meal"), Math.ceil(limit * 0.6));
  // İçeceklerde önce sade seçenekler (su, soda, ayran, çay, kahve), sonra diğerleri.
  const plain = (g: HealthGuideItem) => (/(^| )(su|soda|ayran|cay|kahvesi|kahve)( |$)/.test(fold(g.name)) ? 0 : 1);
  const rest = diverse(good.filter((g) => !meals.includes(g)).sort((a, b) => plain(a) - plain(b)), limit - meals.length);
  return {
    condition,
    label: HEALTH_LABELS[condition],
    good: [...meals, ...rest],
    moderate: diverse(tier("moderate"), Math.min(5, limit)),
    avoid: diverse(tier("avoid"), limit),
    swaps: [...new Set(rows.filter((r) => r.v.tier !== "avoid" && r.v.swap).map((r) => r.v.swap!))].slice(0, 4),
    tips: GENERAL_TIPS[condition],
    disclaimer: HEALTH_DISCLAIMER,
  };
}

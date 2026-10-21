import { parseBudgetAndGuests, parseNumberWord } from "@/lib/ai/recommendation";

/**
 * Konuşma bağlamı (yapılandırılmış özet) — uzun oturumlarda sınırlı bağlam. Yalnızca öneri için gerekli tercihler;
 * gizli akıl yürütme, kişisel veri ya da konu dışı içerik YOK. Her kullanıcı ifadesinden deterministik güncellenir ve
 * kesintide de korunur ("800 liraya iki kişilik öner" → kesinti → "Birimiz vegan" → yeni öneri iki kısıtı birlikte kullanır).
 */
export type DietNeed = { tag: "vegan" | "vegetarian" | "gluten_free" | "halal"; guests: number };

export type ConversationContext = {
  guests: number | null;
  budgetMinor: number | null;
  diets: DietNeed[];
  spicy: "avoid" | "prefer" | null;
  /** Son konu: öneri ise kısıt bildiren kısa ifade öneriyi yeniler. */
  lastIntent: "recommend" | null;
};

export const EMPTY_CONTEXT: ConversationContext = { guests: null, budgetMinor: null, diets: [], spicy: null, lastIntent: null };

const DIETS: [DietNeed["tag"], RegExp][] = [
  ["vegan", /(vegan|веган|نباتي صرف)/i],
  ["vegetarian", /(vejetaryen|vegetarian|vegetarisch|вегетариан|نباتي)/i],
  ["gluten_free", /(glutensiz|gluten[- ]?free|glutenfrei|без глютена|خالي من الغلوتين)/i],
  ["halal", /(helal|halal|халяль|حلال)/i],
];
const SUBSET =
  /(birimiz|ikimiz|üçümüz|biri|one of us|two of us|einer von uns|eine von uns|zwei von uns|один из нас|одна из нас|двое из нас|أحدنا|واحد منا|اثنان منا)/i;
const AVOID_SPICY = /(ac[ıi](?: da| de)? (olmas[ıi]n|olmayan|istemiyoruz|sevmiyoruz)|ac[ıi]s[ıi]z|not spicy|no spice|non[- ]spicy|nicht scharf|ohne schärfe|не остр|без остр|غير حار|بدون حار)/i;
const PREFER_SPICY = /(ac[ıi]l[ıi] (olsun|olabilir)|spicy please|i like spicy|scharf bitte|остр(ое|ого) (можно|пожалуйста)|حار من فضلك)/i;
const RECOMMEND = /([oö]ner|tavsiye|recommend|suggest|empfehl|посовет|порекоменд|предлож|اقترح|انصح)/i;

function subsetCount(text: string): number {
  const m = text.match(SUBSET)?.[0]?.toLocaleLowerCase("tr-TR") ?? "";
  if (/iki|two|zwei|двое|اثنان/.test(m)) return 2;
  if (/üç/.test(m)) return 3;
  return 1;
}

/** İfadeden bağlam güncellemesi. Diyet tek başına söylenirse (alt küme yok) tüm grup için kabul edilir. */
export function updateContext(prev: ConversationContext, utterance: string): { context: ConversationContext; constraintOnly: boolean } {
  const ctx: ConversationContext = { ...prev, diets: [...prev.diets] };
  const { budgetMinor, guests } = parseBudgetAndGuests(utterance);
  let changed = false;
  if (budgetMinor) {
    ctx.budgetMinor = budgetMinor;
    changed = true;
  }
  if (guests) {
    ctx.guests = guests;
    changed = true;
  }
  for (const [tag, re] of DIETS) {
    if (!re.test(utterance)) continue;
    // "vegan" eşleşmesi "vegetarian"ı da tetiklemesin
    if (tag === "vegetarian" && /vegan|веган/i.test(utterance) && !/vejetaryen|vegetarian|vegetarisch|вегетариан/i.test(utterance)) continue;
    const count = SUBSET.test(utterance) ? subsetCount(utterance) : Math.max(1, ctx.guests ?? 1);
    ctx.diets = [...ctx.diets.filter((d) => d.tag !== tag), { tag, guests: count }];
    changed = true;
  }
  if (AVOID_SPICY.test(utterance)) {
    ctx.spicy = "avoid";
    changed = true;
  } else if (PREFER_SPICY.test(utterance)) {
    ctx.spicy = "prefer";
    changed = true;
  }
  const recommending = RECOMMEND.test(utterance) || (!!budgetMinor && !!guests);
  if (recommending) ctx.lastIntent = "recommend";
  // Kısıt bildiren kısa ifade ("Birimiz vegan", "Acı da olmasın") önceki öneriyi yeniler.
  const constraintOnly = changed && !recommending && prev.lastIntent === "recommend" && utterance.split(/\s+/).length <= 8;
  if (ctx.guests && ctx.diets.some((d) => d.guests > ctx.guests!)) ctx.diets = ctx.diets.map((d) => ({ ...d, guests: Math.min(d.guests, ctx.guests!) }));
  return { context: ctx, constraintOnly };
}

export function parseContext(value: unknown): ConversationContext {
  if (!value || typeof value !== "object") return EMPTY_CONTEXT;
  const v = value as Partial<ConversationContext>;
  return {
    guests: typeof v.guests === "number" ? v.guests : null,
    budgetMinor: typeof v.budgetMinor === "number" ? v.budgetMinor : null,
    diets: Array.isArray(v.diets) ? v.diets.filter((d): d is DietNeed => !!d && typeof d.guests === "number" && ["vegan", "vegetarian", "gluten_free", "halal"].includes(d.tag)) : [],
    spicy: v.spicy === "avoid" || v.spicy === "prefer" ? v.spicy : null,
    lastIntent: v.lastIntent === "recommend" ? "recommend" : null,
  };
}

/** Modele giden kısa özet satırı (güvenilir bağlam katmanı). */
export function contextSummary(ctx: ConversationContext): string | null {
  const parts = [
    ctx.guests ? `kişi sayısı = ${ctx.guests}` : null,
    ctx.budgetMinor ? `bütçe = ${ctx.budgetMinor / 100}` : null,
    ...ctx.diets.map((d) => `${d.guests} kişi ${d.tag}`),
    ctx.spicy === "avoid" ? "acı olmasın" : ctx.spicy === "prefer" ? "acı tercih" : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

export { parseNumberWord };

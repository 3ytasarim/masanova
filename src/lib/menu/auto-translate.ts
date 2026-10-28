/**
 * Menünün yapay zekâyla otomatik çevirisi — saf yardımcılar (istem + yanıt doğrulama). Ağ / veritabanı yok.
 *
 * Kaynak her zaman ana satırdır (kiracının varsayılan dili). Yalnızca EKSİK çeviriler üretilir; işletmenin elle girdiği
 * çeviri asla ezilmez. Model çıktısı güvenilmez veri sayılır: yalnızca istenen kimlikler + istenen alanlar alınır,
 * uzunluklar şema sınırlarına kırpılır, boş değer atılır.
 */
export type TranslatableKind = "category" | "product" | "variant" | "modifierGroup" | "modifier" | "ingredient";

export type TranslationSource = { name: string; shortDescription?: string | null; description?: string | null };

export type TranslationItem = { kind: TranslatableKind; id: string; source: TranslationSource };

export type TranslatedText = { name: string; shortDescription: string | null; description: string | null };

/** Şema / form sınırları (product.name 80, category.name 60; açıklamalar geniş). */
const LIMITS = { name: 80, shortDescription: 200, description: 1200 } as const;

const LOCALE_NAMES: Record<string, string> = { tr: "Turkish", en: "English", de: "German", ar: "Arabic", ru: "Russian", fr: "French" };

export function localeName(locale: string): string {
  return LOCALE_NAMES[locale] ?? locale;
}

/** Modelin gördüğü kısa anahtar (iç kimlik dışarı sızmaz, çıktı küçük kalır). */
export function itemRef(index: number): string {
  return `i${index}`;
}

export function translationSystemPrompt(sourceLocale: string, targetLocale: string): string {
  return [
    `You translate a restaurant menu from ${localeName(sourceLocale)} to ${localeName(targetLocale)} for guests reading a QR menu.`,
    "Rules:",
    `- EVERY item must be translated into ${localeName(targetLocale)}. Never return the ${localeName(sourceLocale)} text unchanged unless it is only a brand name or a number/unit.`,
    "- Natural, appetizing menu language a native speaker would expect; keep it short. Do not add information that is not in the source.",
    `- Ordinary dishes and words are fully translated (e.g. "Somon Izgara" → "Grilled Salmon" / "Lachs vom Grill", "Salatalık Söğüş" → "Sliced Cucumber" / "Gurkenscheiben", "Porsiyon" → "Portion", "Kadeh" → "Glass").`,
    `- Traditional Turkish dishes with no real equivalent keep the Turkish name followed by a short ${localeName(targetLocale)} explanation in parentheses (e.g. "Yaprak Sarma (Stuffed Vine Leaves)", "Sigara Böreği (Crispy Cheese Rolls)", "Mantı (Turkish Dumplings)").`,
    `- Brand / label names (e.g. Coca-Cola, Fanta, Efes, Yeni Rakı, Tekirdağ, Buzbağ, Cappy) stay unchanged, but the descriptive words around them ARE translated (e.g. "Buzbağ Kırmızı" → "Buzbağ Red" / "Buzbağ Rot", "Cappy Vişne" → "Cappy Sour Cherry" / "Cappy Sauerkirsche").`,
    "- Keep numbers, units and sizes (cl, ml, gr) correct.",
    targetLocale === "ar"
      ? "- Arabic: write EVERYTHING in Arabic script (Modern Standard Arabic) — translate dishes (\"Somon Izgara\" → \"سلمون مشوي\"); traditional names and brands are transliterated into Arabic letters (\"Yaprak Sarma\" → \"يبرق سارما (ورق عنب محشي)\", \"Fanta\" → \"فانتا\"). Never leave Latin-script words except units like cl / ml."
      : "",
    "Return ONLY a JSON object: { \"<ref>\": { \"name\": \"...\", \"shortDescription\": \"...\", \"description\": \"...\" } } — include shortDescription / description only when the source has them.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function translationUserPrompt(items: readonly TranslationItem[]): string {
  const payload: Record<string, TranslationSource> = {};
  items.forEach((item, i) => {
    const src: TranslationSource = { name: item.source.name };
    if (item.source.shortDescription?.trim()) src.shortDescription = item.source.shortDescription.trim();
    if (item.source.description?.trim()) src.description = item.source.description.trim();
    payload[itemRef(i)] = src;
  });
  return JSON.stringify(payload);
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/**
 * Model yanıtını doğrular: yalnızca istenen ref'ler, yalnızca kaynakta olan alanlar. Adı olmayan kayıt atlanır
 * (bir sonraki çalıştırmada yeniden denenir). Dönen dizi, items ile aynı sırada; çevrilemeyen için null.
 */
export function parseTranslationResponse(raw: unknown, items: readonly TranslationItem[]): (TranslatedText | null)[] {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return items.map((item, i) => {
    const entry = obj[itemRef(i)];
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    const name = clean(e.name, LIMITS.name);
    if (!name) return null;
    return {
      name,
      shortDescription: item.source.shortDescription?.trim() ? clean(e.shortDescription, LIMITS.shortDescription) : null,
      description: item.source.description?.trim() ? clean(e.description, LIMITS.description) : null,
    };
  });
}

/** Sağlayıcıya gidecek parçalar: ürün açıklamaları uzun olabilir → karakter bütçesiyle de bölünür. */
export function chunkItems(items: readonly TranslationItem[], maxItems = 25, maxChars = 6000): TranslationItem[][] {
  const chunks: TranslationItem[][] = [];
  let current: TranslationItem[] = [];
  let size = 0;
  for (const item of items) {
    const len = item.source.name.length + (item.source.shortDescription?.length ?? 0) + (item.source.description?.length ?? 0) + 40;
    if (current.length && (current.length >= maxItems || size + len > maxChars)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

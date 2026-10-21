import { z } from "zod";

/**
 * Asistan araçları — TEK sözleşme (sağlayıcıdan bağımsız). Argümanlar Zod ile doğrulanır; sağlayıcıya JSON Schema olarak
 * verilir. Bilinçli olarak YOK: kiracı / şube / masa / ürün iç kimliği argümanı (bağlam sunucuda), sipariş gönderme aracı
 * (submitOrder / placeOrder / confirmOrder ASLA yok). "prepare*" araçları hiçbir şeyi değiştirmez: yalnızca doğrulanmış
 * bir öneri kartı üretir; değişikliği müşteri düğmeyle onaylar ve MEVCUT iş mantığı uygular.
 */
const productRef = z.string().trim().min(1).max(80).describe("Ürün adı ya da menü anahtarı (müşterinin söylediği gibi)");
const allergenList = z.array(z.string().trim().min(1).max(40)).max(10);

export const AI_TOOLS = {
  searchMenu: {
    description: "Menüde ara (ad, malzeme, kategori, diyet etiketi). Tükenenler varsayılan olarak hariç.",
    schema: z.object({
      query: z.string().trim().max(80).optional(),
      category: z.string().trim().max(60).optional(),
      dietaryTag: z.string().trim().max(40).optional().describe("Yalnızca restoranın açıkça işaretlediği etiket (vegan, vegetarian, gluten_free …)"),
      excludeAllergens: allergenList.optional(),
      maxPriceMinor: z.number().int().min(0).max(100_000_000).optional(),
      includeSoldOut: z.boolean().optional(),
      sort: z.enum(["relevance", "price_asc", "price_desc"]).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    }),
  },
  getProductDetails: { description: "Ürünün açıklaması, içindekiler, restoranın belirttiği alerjen ve diyet bilgisi, seçenekleri.", schema: z.object({ product: productRef }) },
  getProductAvailability: { description: "Ürün şu anda sipariş edilebilir mi (tükendi mi).", schema: z.object({ product: productRef }) },
  getProductPrice: { description: "Ürünün güncel fiyatı (şube fiyatı dahil); varyant adı verilebilir.", schema: z.object({ product: productRef, variant: z.string().trim().max(60).optional() }) },
  getRecommendationCandidates: {
    description: "Kişi sayısı / bütçe / tercihlere göre DETERMİNİSTİK öneri (toplam sunucuda hesaplanır, bütçe aşılmaz).",
    schema: z.object({
      guests: z.number().int().min(1).max(20).optional(),
      budgetMinor: z.number().int().min(0).max(100_000_000).optional().describe("Kuruş cinsinden toplam bütçe (ör. 600 TL = 60000)"),
      kind: z.enum(["meal", "dessert", "drink", "light", "any"]).optional(),
      query: z.string().trim().max(60).optional(),
      dietaryTag: z.string().trim().max(40).optional(),
      avoidAllergens: allergenList.optional(),
      spicy: z.enum(["avoid", "prefer"]).optional(),
    }),
  },
  getGuidance: {
    description:
      "Platform eğitim bilgisi: müşteri bir sağlık / diyet durumu (şeker, tansiyon, hamilelik, kalp, çölyak, kilo, kalori …) ya da eğitim dizinindeki bir konuyu söylerse ÇAĞIR. Eğitim metninden konuyla ilgili bölümleri ve işletmenin menüsünden uygun / ölçülü / kaçınılmalı ürünleri (kalorileriyle) döndürür.",
    schema: z.object({
      topic: z.string().trim().min(2).max(120).describe("Müşterinin söylediği durum / konu (ör. 'şeker hastasıyım', 'kilo veriyorum')"),
      kind: z.enum(["meal", "drink", "dessert", "any"]).optional().describe("Yalnızca yemek / içecek / tatlı istenirse"),
      query: z.string().trim().max(60).optional().describe("Belirli bir istek (ör. kebap, balık)"),
    }),
  },
  planMealByCalories: {
    description:
      "Kalori hedefiyle öğün kur: müşteri bir kalori sınırı söylerse ya da eğitim bilgisi kalori sınırı öneriyorsa ÇAĞIR. Yalnızca menüde kalorisi girilmiş ürünlerle ana yemek + yan + kalorisiz içecek planları ve toplam kaloriyi döndürür (tahmin yok).",
    schema: z.object({
      maxCalories: z.number().int().min(100).max(4000).describe("Kişi başı üst kalori sınırı (kcal)"),
      topic: z.string().trim().max(120).optional().describe("Varsa sağlık durumu (kaçınılması gereken ürünler çıkarılır)"),
      query: z.string().trim().max(60).optional().describe("İstenen ana yemek türü (ör. balık)"),
    }),
  },
  getCartSummary: { description: "Müşterinin mevcut sepetinin sunucuda doğrulanmış özeti (fiyatlar güncel).", schema: z.object({}) },
  getOrderStatus: { description: "Bu tarayıcıdan verilen son siparişlerin durumu (yalnızca bu masa, son 24 saat).", schema: z.object({}) },
  prepareCartAddition: {
    description: "Sepete ekleme ÖNERİSİ hazırla (sepeti değiştirmez). Zorunlu seçim varsa ürün yapılandırıcısı önerilir.",
    schema: z.object({ product: productRef, quantity: z.number().int().min(1).max(20).default(1), variant: z.string().trim().max(60).optional() }),
  },
  prepareCartChange: {
    description: "Sepetteki bir satırın adedini değiştirme ÖNERİSİ (0 = çıkar). Satır, sepet özetindeki ada göre bulunur.",
    schema: z.object({ product: productRef, quantity: z.number().int().min(0).max(20) }),
  },
  prepareServiceRequest: { description: "Garson / su / peçete / hesap talebi ÖNERİSİ (müşteri onaylar).", schema: z.object({ type: z.enum(["WAITER", "WATER", "NAPKIN", "BILL"]) }) },
  openCartReview: { description: "Müşteri siparişi göndermek isterse: sepeti / son onayı açma önerisi. Sipariş GÖNDERMEZ.", schema: z.object({}) },
} as const;

export type AiToolName = keyof typeof AI_TOOLS;
export const AI_TOOL_NAMES = Object.keys(AI_TOOLS) as AiToolName[];
export type AiToolArgs<N extends AiToolName> = z.infer<(typeof AI_TOOLS)[N]["schema"]>;

/** Sağlayıcıya verilecek araç tanımları (JSON Schema). */
export function toolDefinitions(names: readonly AiToolName[] = AI_TOOL_NAMES) {
  return names.map((name) => ({ name, description: AI_TOOLS[name].description, parameters: z.toJSONSchema(AI_TOOLS[name].schema, { target: "draft-7" }) as Record<string, unknown> }));
}

/** Model çıktısındaki araç argümanını doğrula (geçersizse null — araç çalışmaz). */
export function parseToolArgs<N extends AiToolName>(name: N, raw: unknown): AiToolArgs<N> | null {
  const parsed = AI_TOOLS[name].schema.safeParse(raw ?? {});
  return parsed.success ? (parsed.data as AiToolArgs<N>) : null;
}

export function isAiToolName(value: string): value is AiToolName {
  return value in AI_TOOLS;
}

/** İşletme ayarına ve PAKETE göre etkin araçlar (öneri / sepet / servis kapatılabilir; Sesli Menü paketinde sepet yok). */
export function enabledTools(settings: { allowRecommendations: boolean; allowCartActions: boolean; allowServiceActions: boolean }, capabilities: { ordering: boolean; service: boolean } = { ordering: true, service: true }): AiToolName[] {
  return AI_TOOL_NAMES.filter((n) => {
    if (n === "getRecommendationCandidates" || n === "getGuidance" || n === "planMealByCalories") return settings.allowRecommendations;
    if (n === "prepareCartAddition" || n === "prepareCartChange" || n === "openCartReview") return settings.allowCartActions && capabilities.ordering;
    if (n === "prepareServiceRequest") return settings.allowServiceActions && capabilities.service;
    return true;
  });
}

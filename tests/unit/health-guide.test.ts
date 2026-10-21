import { describe, expect, it } from "vitest";
import type { FlatProduct } from "@/lib/ai/menu-match";
import { buildHealthGuide, classifyForHealth } from "@/lib/ai/health-guide";
import { AI_TOOLS, parseToolArgs } from "@/lib/ai/tools";
import { buildGuidance, detectCondition, knowledgeIndex, planMealByCalories, retrieveKnowledge } from "@/lib/ai/knowledge";
import { buildRealtimeInstructions, enabledRealtimeTools } from "@/lib/ai/realtime-voice";

let n = 0;
function product(name: string, categoryName: string, kind: FlatProduct["kind"], extra: Partial<FlatProduct> = {}): FlatProduct {
  n++;
  return {
    key: `p${n}`,
    categoryKey: categoryName.toLowerCase(),
    name,
    shortDescription: null,
    description: null,
    featured: false,
    soldOut: false,
    priceLabel: "₺100,00",
    startingFrom: false,
    preparationMinutes: null,
    images: [],
    currency: "TRY",
    basePriceMinor: 10000,
    variants: [],
    modifierGroups: [],
    ingredients: [],
    allergens: [],
    allergenInfoDeclared: false,
    dietaryTags: [],
    nutrition: null,
    search: name.toLowerCase(),
    categoryName,
    directlyAddable: true,
    unitPriceMinor: 10000,
    kind,
    light: false,
    ...extra,
  };
}

const menu: FlatProduct[] = [
  product("Adana Kebap", "Kırmızı Et", "meal", { ingredients: ["Kıyma", "Pilav", "Lavaş"] }),
  product("Kuzu Şiş", "Kırmızı Et", "meal"),
  product("Levrek Izgara", "Balıklar", "meal"),
  product("Somon Izgara", "Balıklar", "meal"),
  product("Hamsi Tava", "Balıklar", "meal"),
  product("Lahmacun", "Kırmızı Et", "meal"),
  product("Patates Tava", "Ara Sıcaklar", "meal"),
  product("Pilav", "Ara Sıcaklar", "meal"),
  product("Çoban Salata", "Salatalar", "meal"),
  product("Haydari", "Mezeler", "meal"),
  product("Fava", "Mezeler", "meal"),
  product("Lakerda", "Mezeler", "meal"),
  product("Biber Turşusu", "Mezeler", "meal"),
  product("Künefe", "Tatlılar", "dessert"),
  product("Karpuz", "Tatlılar", "dessert"),
  product("Efes Pilsen", "Bira", "drink"),
  product("Yeni Rakı", "Rakı", "drink"),
  product("Coca Cola", "Soğuk İçecekler", "drink"),
  product("Coca Cola Zero", "Soğuk İçecekler", "drink"),
  product("Su", "Soğuk İçecekler", "drink"),
  product("Ayran", "Soğuk İçecekler", "drink"),
  product("Türk Kahvesi", "Sıcak İçecekler", "drink"),
];
const by = (name: string) => menu.find((p) => p.name === name)!;
const names = (items: { name: string }[]) => items.map((i) => i.name);

describe("sağlık rehberi — diyabet", () => {
  const g = buildHealthGuide(menu, "diabetes");

  it("bira, rakı, tatlı ve şekerli içecek önerilmez; gerekçe söylenebilir", () => {
    for (const x of ["Efes Pilsen", "Yeni Rakı", "Künefe", "Coca Cola", "Pilav"]) expect(names(g.avoid)).toContain(x);
    expect(classifyForHealth(by("Efes Pilsen"), "diabetes").why).toMatch(/arpa/);
    for (const x of ["Efes Pilsen", "Yeni Rakı", "Künefe", "Coca Cola"]) expect(names(g.good)).not.toContain(x);
  });

  it("yalnızca salata değil: önce doyurucu ana yemekler (kebap, ızgara balık), sonra meze / içecek", () => {
    expect(names(g.good)).toEqual(expect.arrayContaining(["Adana Kebap", "Levrek Izgara", "Çoban Salata", "Su"]));
    expect(g.good[0]!.category).toMatch(/Kırmızı Et|Balıklar/);
    expect(classifyForHealth(by("Coca Cola Zero"), "diabetes").tier).toBe("good");
    expect(classifyForHealth(by("Türk Kahvesi"), "diabetes").swap).toMatch(/Şekersiz/);
  });

  it("kebap için pilav yerine bulgur / salata değişikliği not olarak önerilir; hamur işi ve kızartma ölçülü", () => {
    expect(classifyForHealth(by("Adana Kebap"), "diabetes").swap).toMatch(/bulgur/);
    expect(g.swaps.join(" ")).toMatch(/bulgur/);
    expect(classifyForHealth(by("Lahmacun"), "diabetes").tier).toBe("moderate");
    expect(classifyForHealth(by("Hamsi Tava"), "diabetes").tier).toBe("moderate");
    expect(classifyForHealth(by("Karpuz"), "diabetes").tier).toBe("moderate");
    expect(g.disclaimer).toMatch(/doktor/);
  });
});

describe("sağlık rehberi — diğer durumlar", () => {
  it("tansiyon: turşu / lakerda kaçınılmalı, ızgaraya 'az tuzlu' notu", () => {
    const g = buildHealthGuide(menu, "hypertension");
    expect(names(g.avoid)).toEqual(expect.arrayContaining(["Biber Turşusu", "Lakerda"]));
    expect(classifyForHealth(by("Levrek Izgara"), "hypertension").swap).toMatch(/tuz/i);
  });

  it("hamilelik: tüm alkol ve marine / tütsülenmiş balık kaçınılmalı; kahve ölçülü", () => {
    const g = buildHealthGuide(menu, "pregnancy");
    expect(names(g.avoid)).toEqual(expect.arrayContaining(["Efes Pilsen", "Yeni Rakı", "Lakerda"]));
    expect(classifyForHealth(by("Türk Kahvesi"), "pregnancy").tier).toBe("moderate");
  });

  it("kalp: kızartma kaçınılmalı, yağlı balık uygun; çölyak: lahmacun ve bira kaçınılmalı, gluten beyanı esas", () => {
    expect(classifyForHealth(by("Hamsi Tava"), "heart").tier).toBe("avoid");
    expect(classifyForHealth(by("Somon Izgara"), "heart").tier).toBe("good");
    expect(classifyForHealth(by("Lahmacun"), "celiac").tier).toBe("avoid");
    expect(classifyForHealth(by("Efes Pilsen"), "celiac").tier).toBe("avoid");
    expect(classifyForHealth(product("Ev Yapımı Köfte", "Et", "meal", { allergens: [{ code: "gluten", name: "Gluten" }], allergenInfoDeclared: true }), "celiac").tier).toBe("avoid");
  });

  it("tükenen ürün önerilmez; tür filtresi çalışır", () => {
    const sold = [...menu, product("Çipura Izgara", "Balıklar", "meal", { soldOut: true })];
    expect(names(buildHealthGuide(sold, "diabetes").good)).not.toContain("Çipura Izgara");
    const drinks = buildHealthGuide(menu, "diabetes", { kind: "drink" });
    expect([...drinks.good, ...drinks.avoid].every((i) => /İçecek|Bira|Rakı/.test(i.category))).toBe(true);
  });
});

describe("yapay zeka eğitimi — serbest metin + kalori", () => {
  const docs = [
    {
      id: "d1",
      title: "Diyabet ve beslenme",
      content:
        `Diyabet hastaları için genel kurallar:
Tabağın yarısı sebze olmalı. Beyaz pilav yerine bulgur tercih edilir.

Bira arpa maltından yapılır, kan şekerini yükseltir; önerilmez.

Öğün başına 600 kaloriyi aşmamak önerilir.`,
      active: true,
      sortOrder: 10,
    },
    { id: "d2", title: "Hamilelikte beslenme", content: "Hamile misafirlere alkol ve çiğ balık önerilmez. Et iyi pişmiş olmalıdır.", active: true, sortOrder: 20 },
    { id: "d3", title: "Pasif metin", content: "Diyabet hastalarına tatlı önerin.", active: false, sortOrder: 30 },
  ];

  it("konuya göre metnin ilgili bölümleri gelir; pasif metin yok sayılır; ilgisiz konuda boş", () => {
    const k = retrieveKnowledge(docs, "ben şeker hastasıyım");
    expect(k.length).toBeGreaterThan(0);
    expect(k.map((s) => s.text).join(" ")).toMatch(/bulgur/);
    expect(k.every((s) => s.document !== "Pasif metin")).toBe(true);
    expect(retrieveKnowledge(docs, "hamileyim").map((s) => s.document)).toContain("Hamilelikte beslenme");
    expect(retrieveKnowledge(docs, "bugün hava güzel")).toEqual([]);
  });

  it("rehber: yerleşik sınıflandırma + metin bölümleri + kaloriler", () => {
    const withCal = menu.map((p) => (p.name === "Adana Kebap" ? { ...p, nutrition: { calories: 520, proteinGrams: null, carbohydrateGrams: null, fatGrams: null } } : p));
    const g = buildGuidance(withCal, docs, "şekerim var");
    expect(g.condition).toBe("diabetes");
    expect(g.knowledge.map((s) => s.text).join(" ")).toMatch(/Bira/);
    expect(names(g.avoid)).toEqual(expect.arrayContaining(["Efes Pilsen", "Künefe"]));
    expect(g.good.find((i) => i.name === "Adana Kebap")?.calories).toBe(520);
    expect(g.productsWithCalories).toBe(1);
    expect(g.disclaimer).toMatch(/doktor/);
  });

  it("kaloriye göre öğün: yalnızca kalorisi girilmiş ürünler; sınır aşılmaz; sağlık durumunda kaçınılanlar çıkar", () => {
    const cal = (name: string, kcal: number) => ({ ...by(name), nutrition: { calories: kcal, proteinGrams: null, carbohydrateGrams: null, fatGrams: null } });
    const m = [cal("Adana Kebap", 520), cal("Levrek Izgara", 380), cal("Çoban Salata", 90), cal("Haydari", 160), cal("Künefe", 650), by("Su"), by("Kuzu Şiş")];
    const r = planMealByCalories(m, { maxCalories: 600 });
    expect(r.plans.length).toBe(2);
    for (const p of r.plans) expect(p.totalCalories).toBeLessThanOrEqual(600);
    expect(r.plans[0]!.items.map((i) => i.name)).toEqual(["Levrek Izgara", "Haydari", "Su"]);
    expect(r.plans[1]!.items.map((i) => i.name)).toEqual(["Adana Kebap", "Su"]); // 520 + salata 90 = 610 > 600 → yan yok
    expect(r.productsWithoutCalories).toBeGreaterThan(0);
    const d = planMealByCalories([cal("Künefe", 300), cal("Levrek Izgara", 380)], { maxCalories: 900, condition: "diabetes" });
    expect(d.plans.flatMap((p) => p.items.map((i) => i.name))).not.toContain("Künefe");
  });

  it("dizin talimata girer; araçlar doğrulanır; öneri kapalıysa araçlar kapalı", () => {
    const idx = knowledgeIndex(docs);
    expect(idx).toMatch(/Diyabet ve beslenme/);
    expect(idx).not.toMatch(/Pasif metin/);
    expect(detectCondition("tansiyonum yüksek")).toBe("hypertension");
    expect(parseToolArgs("getGuidance", { topic: "şeker hastasıyım" })).toEqual({ topic: "şeker hastasıyım" });
    expect(parseToolArgs("planMealByCalories", { maxCalories: 600 })).toEqual({ maxCalories: 600 });
    expect(parseToolArgs("planMealByCalories", { maxCalories: 10 })).toBeNull();
    const off = { allowRecommendations: false, allowCartActions: true, allowServiceActions: true };
    expect(enabledRealtimeTools(off, true)).not.toContain("getGuidance");
    expect(enabledRealtimeTools(off, true)).not.toContain("planMealByCalories");
    const text = buildRealtimeInstructions({ restaurantName: "X", assistantName: "Y", tableName: "Masa 1", tone: "WARM", ordering: true, currency: "TRY", catalog: "", customInstructions: null, knowledge: idx });
    expect(text).toMatch(/Diyabet ve beslenme/);
    expect(text).toMatch(/planMealByCalories/);
    expect(text).toMatch(/Yalnızca salata ve su önerme/);
  });
});

describe("kalori planı — sağlık durumunda uygun ürün önceliği", () => {
  it("diyabette 'uygun' ana yemek (ızgara) 'ölçülü' olandan (dürüm) önce gelir", () => {
    const cal = (p: FlatProduct, kcal: number) => ({ ...p, nutrition: { calories: kcal, proteinGrams: null, carbohydrateGrams: null, fatGrams: null } });
    const durum = cal(product("Dana Şiş Dürüm", "Dürümler", "meal"), 580);
    const levrek = cal(product("Levrek Izgara", "Balıklar", "meal"), 380);
    const r = planMealByCalories([durum, levrek, by("Su")], { maxCalories: 600, condition: "diabetes" });
    expect(r.plans.map((p) => p.items[0]!.name)).toEqual(["Levrek Izgara", "Dana Şiş Dürüm"]);
  });
});

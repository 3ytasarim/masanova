import { describe, expect, it } from "vitest";
import type { FlatProduct } from "@/lib/ai/menu-match";
import { buildLexicon } from "@/lib/ai/voice-lexicon";
import { findPairings, menuMainsFor, pairingViews, pairingsToText, parsePairingText, readStoredPairings, resolvePairings, withPopular } from "@/lib/ai/pairings";
import { AI_TOOLS, enabledTools, parseToolArgs } from "@/lib/ai/tools";
import { buildRealtimeInstructions, enabledRealtimeTools } from "@/lib/ai/realtime-voice";

let n = 0;
const p = (name: string, categoryName: string, kind: FlatProduct["kind"] = "meal", extra: Partial<FlatProduct> = {}): FlatProduct => {
  n++;
  const key = name.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
  return {
    key, categoryKey: categoryName, name, shortDescription: null, description: null, featured: false, soldOut: false, priceLabel: `₺${n}00,00`, startingFrom: false,
    preparationMinutes: null, images: [], currency: "TRY", basePriceMinor: n * 10000, variants: [], modifierGroups: [], ingredients: [], allergens: [], allergenInfoDeclared: false,
    dietaryTags: [], nutrition: null, search: name.toLowerCase(), categoryName, directlyAddable: true, unitPriceMinor: n * 10000, kind, light: false, ...extra,
  };
};

const menu: FlatProduct[] = [
  p("Levrek Izgara", "Balıklar"), p("Çipura Izgara", "Balıklar"), p("Palamut Izgara", "Balıklar"), p("Adana Kebap", "Kırmızı Et"),
  p("Deniz Börülcesi", "Mezeler"), p("Fava", "Mezeler"), p("Haydari", "Mezeler"), p("Roka Salata", "Salatalar"), p("Acılı Ezme", "Mezeler"), p("Patlıcan Söğürme", "Mezeler"),
  p("Çankaya", "Beyaz Şarap", "drink"), p("Angora Beyaz", "Beyaz Şarap", "drink"), p("Tekirdağ", "Rakı", "drink"), p("Ayran", "Soğuk İçecekler", "drink"),
];
const lexicon = buildLexicon(menu);

describe("eşleştirme metni", () => {
  it("tablodan yapıştırma (TAB), | ve : biçimleri; başlık / boş satır yok sayılır", () => {
    const text = [
      "Ana yemek\tÖnerilecek meze\tİçecek eşleştirmesi",
      "Levrek Izgara\tDeniz Börülcesi, Fava\tÇankaya Beyaz Şarap",
      "",
      "Çipura Izgara | Haydari, Roka Salata | Angora Beyaz",
      "Palamut Izgara: Acılı Ezme ve Patlıcan Söğürme | Tekirdağ Rakı",
    ].join("\n");
    const lines = parsePairingText(text);
    expect(lines.map((l) => l.main)).toEqual(["Levrek Izgara", "Çipura Izgara", "Palamut Izgara"]);
    expect(lines[2]).toMatchObject({ sides: ["Acılı Ezme", "Patlıcan Söğürme"], drinks: ["Tekirdağ Rakı"] });
  });

  it("adlar menü ürünlerine çözülür (\"Tekirdağ Rakı\" → Tekirdağ, \"Çankaya Beyaz Şarap\" → Çankaya); bulunamayan raporlanır", () => {
    const r = resolvePairings(parsePairingText("Levrek Izgara | Deniz Börülcesi, Fava | Çankaya Beyaz Şarap\nPalamut Izgara | Acılı Ezme, Lakerda | Tekirdağ Rakı"), menu, lexicon);
    expect(r.pairings).toEqual([
      { main: "levrek-izgara", sides: ["deniz-borulcesi", "fava"], drinks: ["cankaya"], desserts: [] },
      { main: "palamut-izgara", sides: ["acili-ezme"], drinks: ["tekirdag"], desserts: [] },
    ]);
    expect(r.unmatched).toEqual([{ line: 2, text: "Lakerda" }]);
  });

  it("canlı menüyle birleşir: tükenen / silinen ürün düşer; metne geri yazılabilir; bozuk JSON güvenli", () => {
    const stored = [{ main: "levrek-izgara", sides: ["fava", "silinmis"], drinks: ["cankaya"] }, { main: "yok-boyle", sides: ["fava"], drinks: [] }];
    const sold = menu.map((x) => (x.key === "cankaya" ? { ...x, soldOut: true } : x));
    const views = pairingViews(stored, sold);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ main: "Levrek Izgara", sides: [{ name: "Fava" }], drinks: [] });
    expect(pairingsToText(views)).toBe("Levrek Izgara | Fava | ");
    expect(readStoredPairings("bozuk")).toEqual([]);
    expect(readStoredPairings([{ main: 1 }, { main: "a", sides: ["b", 2] }])).toEqual([{ main: "a", sides: ["b"], drinks: [], desserts: [] }]);
  });
});

describe("tatlı sütunu, kategori kelimesi ve alkol filtresi", () => {
  const extra = [...menu, p("Kabak Tatlısı", "Tatlılar", "dessert"), p("Beylerbeyi Göbek", "Rakı", "drink")];
  const lx = buildLexicon(extra);
  it("4. sütun tatlı; 'Beylerbeyi Göbek Rakı' → Beylerbeyi Göbek (sondaki kategori kelimesi tolere edilir)", () => {
    const r = resolvePairings(parsePairingText("Levrek Izgara | Fava | Beylerbeyi Göbek Rakı, Ayran | Kabak Tatlısı"), extra, lx);
    expect(r.unmatched).toEqual([]);
    expect(r.pairings[0]).toEqual({ main: "levrek-izgara", sides: ["fava"], drinks: ["beylerbeyi-gobek", "ayran"], desserts: ["kabak-tatlisi"] });
    const views = pairingViews(r.pairings, extra);
    expect(pairingsToText(views)).toBe("Levrek Izgara | Fava | Beylerbeyi Göbek, Ayran | Kabak Tatlısı");
    // Diyabet / alkol almıyorum: rakı çıkar, ayran ve tatlı (ayrıca sağlık kuralı uygular) kalır
    expect(pairingViews(r.pairings, extra, { avoidAlcohol: true })[0]!.drinks.map((d) => d.name)).toEqual(["Ayran"]);
  });

  it("müşteri davranışı: en çok birlikte sipariş edilenler eklenir (tükenen / alkollü elenebilir); kayıt yoksa menüden ana yemek bulunur", () => {
    const views = pairingViews(resolvePairings(parsePairingText("Levrek Izgara | Fava | Çankaya"), extra, lx).pairings, extra);
    const co = new Map([["levrek-izgara", [{ slug: "roka-salata", orders: 9 }, { slug: "tekirdag", orders: 7 }, { slug: "haydari", orders: 3 }]]]);
    expect(withPopular(views, co, extra)[0]!.popular!.map((x) => x.name)).toEqual(["Roka Salata", "Tekirdağ", "Haydari"]);
    expect(withPopular(views, co, extra, { avoidAlcohol: true })[0]!.popular!.map((x) => x.name)).toEqual(["Roka Salata", "Haydari"]);
    expect(menuMainsFor(extra, lx, { topic: "balığın yanına ne gider" }).map((m) => m.name).sort()).toEqual(["Levrek Izgara", "Palamut Izgara", "Çipura Izgara"].sort());
  });
});

describe("garson aracı getPairings", () => {
  const { pairings } = resolvePairings(
    parsePairingText("Levrek Izgara | Deniz Börülcesi, Fava | Çankaya\nÇipura Izgara | Haydari | Angora Beyaz\nAdana Kebap | Acılı Ezme | Ayran"),
    menu,
    lexicon,
  );
  const views = pairingViews(pairings, menu);

  it("ürün sorulursa o ürünün önerisi (konuşulan ad: 'levreğin', 'levrek ızgara')", () => {
    expect(findPairings(views, menu, lexicon, { product: "levrek ızgara" })).toMatchObject({ match: "product", pairings: [{ main: "Levrek Izgara" }] });
  });

  it("'balığın yanına hangi meze gider' → yalnızca balıklar (kategori), kebap gelmez", () => {
    const r = findPairings(views, menu, lexicon, { topic: "balığın yanına hangi meze gider" });
    expect(r.match).toBe("topic");
    expect(r.pairings.map((x) => x.main).sort()).toEqual(["Levrek Izgara", "Çipura Izgara"].sort());
    expect(findPairings(views, menu, lexicon, { topic: "levreğin yanına ne içilir" }).pairings.map((x) => x.main)).toEqual(["Levrek Izgara"]);
  });

  it("araç sözleşmesi ve talimat", () => {
    expect(parseToolArgs("getPairings", { topic: "balık" })).toEqual({ topic: "balık" });
    expect(AI_TOOLS.getPairings.description).toMatch(/yanına/);
    const settings = { allowRecommendations: true, allowCartActions: true, allowServiceActions: true };
    expect(enabledRealtimeTools(settings, true)).toContain("getPairings");
    expect(enabledTools(settings)).toContain("getPairings");
    expect(enabledRealtimeTools({ ...settings, allowRecommendations: false }, true)).not.toContain("getPairings");
    const text = buildRealtimeInstructions({ restaurantName: "X", assistantName: "Y", tableName: "Masa 1", tone: "WARM", ordering: true, currency: "TRY", catalog: "", customInstructions: null });
    expect(text).toMatch(/getPairings/);
    expect(text).toMatch(/restoranımızın önerisi/);
  });
});

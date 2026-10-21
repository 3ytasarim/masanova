import { describe, expect, it, vi } from "vitest";
import type { FlatProduct } from "@/lib/ai/menu-match";

vi.mock("server-only", () => ({}));
const { heardSupports, isAffirmative, buildLexicon, matchProduct, detectOptions, pronunciationVariants, phoneticKey, stemToken, resolveSpokenProduct, menuFingerprint, normalizeText } = await import("@/lib/ai/voice-lexicon");
const { plausibleVariant } = await import("@/server/services/ai/voice-index.service");

/** Gerçekçi bir menü: Türkçe + yabancı adlar, varyant, zorunlu seçim, tükenen, genel ad, ortak kelimeli ürünler. */
const P = (key: string, name: string, categoryName: string, extra: Partial<FlatProduct> = {}) =>
  ({ key, name, categoryName, soldOut: false, featured: false, variants: [], modifierGroups: [], ...extra }) as unknown as FlatProduct;
const v = (ref: string, name: string) => ({ ref, name, priceLabel: "", priceMinor: 0, isDefault: false });
const menu: FlatProduct[] = [
  P("cokertme-kebabi", "Çökertme Kebabı", "Kebaplar"),
  P("adana-kebap", "Adana Kebap", "Kebaplar"),
  P("urfa-kebap", "Urfa Kebap", "Kebaplar"),
  P("fettuccine-alfredo", "Fettuccine Alfredo", "Makarnalar"),
  P("mercimek-corbasi", "Mercimek Çorbası", "Çorbalar"),
  P("ezogelin-corbasi", "Ezogelin Çorbası", "Çorbalar"),
  P("kelle-paca", "Kelle Paça Çorbası", "Çorbalar"),
  P("kelle-ayak", "Kelle Paça - Ayak Paça Çorbası", "Çorbalar"),
  P("cheeseburger", "Cheeseburger", "Burgerler", {
    variants: [v("t", "Tek"), v("c", "Çift")],
    modifierGroups: [{ ref: "g", name: "Pişirme Derecesi", required: true, minSelect: 1, maxSelect: 1, modifiers: [{ ref: "o", name: "Orta", priceDeltaMinor: 0, priceDeltaLabel: null }, { ref: "i", name: "İyi Pişmiş", priceDeltaMinor: 0, priceDeltaLabel: null }] }],
  }),
  P("ayran", "Ayran (30 cl.)", "İçecekler", { variants: [v("k", "Küçük"), v("b", "Büyük")] }),
  P("coca-cola", "Coca-Cola (33 cl.)", "İçecekler"),
  P("su", "Su (50 cl.)", "İçecekler"),
  P("tavuk-sis", "Tavuk Şiş", "Izgaralar", { soldOut: true }),
  P("special", "Special", "Burgerler"),
];
const lex = buildLexicon(menu);
const top = (s: string) => {
  const r = matchProduct(lex, s);
  return { status: r.status, name: "product" in r ? r.product.name : null, options: r.candidates.map((c) => c.name) };
};

describe("normalleştirme ve okunuş", () => {
  it("Türkçe ek atma ve yumuşama: kebabı → kebap, mercimeği → mercimek, ayranlar → ayran", () => {
    expect(stemToken("kebabi")).toBe("kebap");
    expect(stemToken("mercimegi")).toBe("mercimek");
    expect(stemToken("ayranlar")).toBe("ayran");
    expect(normalizeText("Coca-Cola (33 cl.)")).toBe("coca cola");
  });
  it("yabancı ad okunuşları kendiliğinden üretilir (takma ad girilmez)", () => {
    expect(pronunciationVariants("Fettuccine Alfredo")).toEqual(expect.arrayContaining(["fettuccine alfredo", "fetuçini alfredo"]));
    expect(pronunciationVariants("Cheeseburger")).toEqual(expect.arrayContaining(["çizburger"]));
    expect(phoneticKey("Coca-Cola")).toBe(phoneticKey("koka kola"));
    expect(phoneticKey("Cheeseburger").replace(" ", "")).toBe(phoneticKey("cheeseburger"));
  });
  it("ayırt edici kısmi adlar: 'alfredo', 'ezogelin' tek başına terim; ortak 'çorbası' / 'kebap' değil", () => {
    const fett = lex.entries.find((e) => e.productKey === "fettuccine-alfredo")!;
    expect(fett.terms.some((t) => t.kind === "partial" && t.text === "alfredo")).toBe(true);
    expect(lex.entries.flatMap((e) => e.terms).some((t) => t.kind === "partial" && (t.text === "corbasi" || t.text === "kebap"))).toBe(false);
  });
});

describe("eşleştirme — güven düzeyleri", () => {
  it.each([
    ["çökertme kebabı", "Çökertme Kebabı"],
    ["adana kebabı", "Adana Kebap"],
    ["mercimek çorbası", "Mercimek Çorbası"],
    ["ezo gelin", "Ezogelin Çorbası"],
    ["kelle paça", "Kelle Paça Çorbası"],
  ])("Türkçe ad: %s → %s (YÜKSEK)", (spoken, name) => expect(top(spoken)).toMatchObject({ status: "high", name }));

  it.each([
    ["fetuçini alfredo", "Fettuccine Alfredo"],
    ["fetuçini", "Fettuccine Alfredo"],
    ["çizburger", "Cheeseburger"],
    ["koka kola", "Coca-Cola (33 cl.)"],
  ])("yabancı ad: %s → %s (YÜKSEK)", (spoken, name) => expect(top(spoken)).toMatchObject({ status: "high", name }));

  it.each([
    ["mercimek çorbasi", "Mercimek Çorbası"],
    ["çökerme kebap", "Çökertme Kebabı"],
    ["fettucine alfredi", "Fettuccine Alfredo"],
    ["mercimik", "Mercimek Çorbası"],
  ])("konuşma tanıma hatası: %s → %s", (spoken, name) => expect(top(spoken)).toMatchObject({ status: "high", name }));

  it("tekil / çoğul ve adet sözcükleri: 'iki ayranlar', 'bir su'", () => {
    expect(top("iki ayranlar")).toMatchObject({ status: "high", name: "Ayran (30 cl.)" });
    expect(top("bir su")).toMatchObject({ status: "high", name: "Su (50 cl.)" });
  });

  it("ORTA güven → onay sorulur ('fetuççi', 'alfreda makarna')", () => {
    expect(top("fetuççi")).toMatchObject({ status: "medium", name: "Fettuccine Alfredo" });
    expect(top("alfreda makarna")).toMatchObject({ status: "medium", name: "Fettuccine Alfredo" });
  });

  it("belirsiz: yalnızca ortak kelime ('kebap', 'kelle') → seçenekler sorulur, tahmin YOK", () => {
    const k = top("kebap");
    expect(k.status).toBe("ambiguous");
    expect(k.options).toEqual(expect.arrayContaining(["Çökertme Kebabı", "Adana Kebap", "Urfa Kebap"]));
    expect(top("kelle").status).toBe("ambiguous");
  });

  it("tükenen ürün otomatik seçilmez", () => {
    expect(top("tavuk şiş")).toMatchObject({ status: "sold_out", name: "Tavuk Şiş" });
    const r = resolveSpokenProduct(lex, menu, "tavuk şiş");
    expect(r.ok).toBe(false);
  });

  it("menüde olmayan ürün UYDURULMAZ → 'Menümüzde bu isimde bir ürün bulamadım.'", () => {
    for (const s of ["lahmacun", "suşi", "ezoglu", "merci"]) expect(top(s).status, s).toBe("none");
    const r = resolveSpokenProduct(lex, menu, "lahmacun");
    expect(r).toMatchObject({ ok: false, status: "none", output: { reason: "not_on_menu", say: "Menümüzde bu isimde bir ürün bulamadım." } });
  });

  it("DÜŞÜK güven → tekrar istenir, ürün dönmez", () => {
    expect(top("çeesbur").status).toBe("low");
    expect(resolveSpokenProduct(lex, menu, "çeesbur")).toMatchObject({ ok: false, output: { needs: "repeat" } });
  });

  it("tam ad / anahtar doğrudan çözülür; orta güvende ürün dönmez (yalnızca onay metni)", () => {
    expect(resolveSpokenProduct(lex, menu, "Cheeseburger")).toMatchObject({ ok: true, confidence: "exact" });
    expect(resolveSpokenProduct(lex, menu, "adana-kebap")).toMatchObject({ ok: true, confidence: "exact" });
    expect(resolveSpokenProduct(lex, menu, "fetuççi")).toMatchObject({ ok: false, output: { needs: "confirm", candidate: "Fettuccine Alfredo" } });
  });
});

describe("varyant ve ekstra tanıma", () => {
  const burger = lex.entries.find((e) => e.productKey === "cheeseburger")!;
  const ayran = lex.entries.find((e) => e.productKey === "ayran")!;
  it("'iki büyük ayran' → Büyük varyantı", () => expect(detectOptions(ayran, "iki büyük ayran").variant?.name).toBe("Büyük"));
  it("'çift çizburger orta pişmiş' → Çift + Orta", () => {
    const o = detectOptions(burger, "çift çizburger orta pişmiş");
    expect(o.variant?.name).toBe("Çift");
    expect(o.modifiers.map((m) => m.name)).toEqual(["Orta"]);
  });
  it("söylenmeyen varyant uydurulmaz", () => expect(detectOptions(burger, "bir çizburger").variant).toBeNull());
});

describe("belirsiz isimler ve dizin özeti", () => {
  it("genel ad ('Special') incelemeye düşer; normal ürünler düşmez", () => {
    expect(lex.ambiguities.some((a) => a.kind === "generic" && a.products.includes("Special"))).toBe(true);
    expect(lex.ambiguities.some((a) => a.products.includes("Mercimek Çorbası"))).toBe(false);
  });
  it("söylenişte aynı / neredeyse aynı iki ürün → incelemeye düşer + eşleşmede seçenek sorulur", () => {
    const twin = buildLexicon([P("kofte-1", "Kasap Köfte", "Izgaralar"), P("kofte-2", "Kasap Köftesi", "Izgaralar"), P("pilav", "Pilav", "Yanlar")]);
    // Ek atma sonrası birebir aynı söyleyiş → "collision"; çok yakın → "similar". İkisinde de seçenek sorulur.
    expect(twin.ambiguities.some((a) => a.kind === "similar" || a.kind === "collision")).toBe(true);
    expect(matchProduct(twin, "kasap köfte").status).toBe("ambiguous");
  });
  it("istatistik: ürün / varyant / ekstra / terim / belirsiz", () => {
    expect(lex.stats).toMatchObject({ products: menu.length, variants: 4, modifiers: 2, ambiguous: lex.ambiguities.length });
    expect(lex.stats.terms).toBeGreaterThan(menu.length);
  });
  it("menü özeti ad / tükendi değişince değişir (eskimiş dizin tespiti)", () => {
    const base = menuFingerprint(menu);
    expect(menuFingerprint([...menu])).toBe(base);
    expect(menuFingerprint(menu.map((p) => (p.key === "ayran" ? ({ ...p, soldOut: true } as FlatProduct) : p)))).not.toBe(base);
    expect(menuFingerprint(menu.map((p) => (p.key === "ayran" ? ({ ...p, name: "Yayık Ayranı" } as FlatProduct) : p)))).not.toBe(base);
  });
  it("kayıtlı ek söyleyiş yalnızca kendi ürününe eklenir", () => {
    const withAi = buildLexicon(menu, { "fettuccine-alfredo": ["fetuçini alfredo makarna"], "olmayan-urun": ["hayalet"] });
    expect(withAi.entries.find((e) => e.productKey === "fettuccine-alfredo")!.terms.some((t) => t.kind === "ai")).toBe(true);
    expect(matchProduct(withAi, "hayalet").status).toBe("none");
  });
});

describe("yapay zekâ söyleyişi doğrulama (uydurma elenir)", () => {
  it("ada benzeyen kabul, benzemeyen reddedilir", () => {
    expect(plausibleVariant("Fettuccine Alfredo", "fetuçini alfredo")).toBe(true);
    expect(plausibleVariant("Fettuccine Alfredo", "fetuçini")).toBe(true);
    expect(plausibleVariant("Fettuccine Alfredo", "lazanya")).toBe(false);
    expect(plausibleVariant("Cheeseburger", "çizburger")).toBe(true);
    expect(plausibleVariant("Cheeseburger", "tavuk dürüm")).toBe(false);
  });
});

describe("model adı kendisi düzeltirse (söylenen ≠ gönderilen)", () => {
  it("söylenen ürünü güçlü destekliyorsa 'strong'; bozuk söylenişte 'weak'; ilgisizse 'none'", () => {
    expect(heardSupports(lex, "Bir çökertme kebabı ekler misin?", "cokertme-kebabi")).toBe("strong");
    // Tek harflik kayma ("çökürtme") yüksek güvenle tanınır (tıpkı "mercimik" gibi); daha bozuk söyleyiş zayıf.
    expect(heardSupports(lex, "Bir tane de çökürtme kebi ekler misin?", "cokertme-kebabi")).toBe("strong");
    expect(heardSupports(lex, "Bir tane de çökürme kebi ekler misin?", "cokertme-kebabi")).toBe("weak");
    expect(heardSupports(lex, "Bir lahmacun alabilir miyim?", "cokertme-kebabi")).toBe("none");
  });
  it("aynı cümlede iki ürün: ikisi de desteklenir", () => {
    expect(heardSupports(lex, "iki büyük ayran ve bir çizburger", "ayran")).toBe("strong");
    expect(heardSupports(lex, "iki büyük ayran ve bir çizburger", "cheeseburger")).toBe("strong");
  });
  it("onay kelimeleri", () => {
    for (const t of ["Evet, o.", "Olur", "aynen öyle", "Yes please", "Ja, genau"]) expect(isAffirmative(t), t).toBe(true);
    for (const t of ["Hayır", "lahmacun istiyorum", "bir dakika"]) expect(isAffirmative(t), t).toBe(false);
  });
});

describe("ortak kelimeli ürünler — söylenen ayırt edici kelime kazanır", () => {
  it("levrek buğulama ≠ hamsi buğulama; çoban salatası ≠ çoban kavurma", async () => {
    const { buildLexicon, matchProduct } = await import("@/lib/ai/voice-lexicon");
    const names = ["Levrek Buğulama", "Hamsi Buğulama", "Levrek Izgara", "Levrek Fileto", "Levrek Kavurma", "Hamsi Izgara", "Hamsi Tava", "Hamsi Pane", "Çoban Salata", "Çoban Kavurma", "Balık Kavurma", "Mantar Kavurma", "Mevsim Salata", "Roka Salata"];
    const products = names.map((name, i) => ({ key: `p${i}`, name, categoryName: /Salata/.test(name) ? "Salatalar" : "Balıklar", soldOut: false, variants: [], modifierGroups: [] })) as unknown as Parameters<typeof buildLexicon>[0];
    const lex = buildLexicon(products);
    const top = (q: string) => {
      const r = matchProduct(lex, q);
      return `${r.status}:${r.status === "high" || r.status === "medium" ? r.product.name : r.candidates.map((c) => c.name).join("/")}`;
    };
    expect(top("levrek buğulama")).toBe("high:Levrek Buğulama");
    expect(top("bir hamsi buğulama")).toBe("high:Hamsi Buğulama");
    expect(top("çoban salatası duble")).toBe("high:Çoban Salata");
    expect(top("çoban kavurma")).toBe("high:Çoban Kavurma");
    // Yalnızca ortak kelime söylenirse yine sorulur (tahmin yok)
    expect(top("buğulama")).toMatch(/^ambiguous:/);
  });
});

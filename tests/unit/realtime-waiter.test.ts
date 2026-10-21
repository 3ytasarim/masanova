import { describe, expect, it } from "vitest";
import { fakeView } from "../support/fake-menu";

const { flattenMenu } = await import("@/lib/ai/menu-match");
const { resolveSelection, resolveBySound, soundKey, mentions, menuCatalog, buildRealtimeInstructions, greetingInstruction, enabledRealtimeTools, realtimeToolDefinitions, parseRealtimeArgs } = await import("@/lib/ai/realtime-voice");

const products = flattenMenu(fakeView());
const burger = products.find((p) => p.key === "cheeseburger")!;
const settings = { allowRecommendations: true, allowCartActions: true, allowServiceActions: true };

describe("sesten sese garson — seçim çözümleme", () => {
  it("varyant ve zorunlu seçim söylenince çözülür", () => {
    const r = resolveSelection(burger, { phrase: "cheeseburger", variant: "çift", options: ["orta"] });
    expect(r.ok && r.variant?.name).toBe("Çift");
    expect(r.ok && r.modifiers.map((m) => m.name)).toEqual(["Orta"]);
  });

  it("varyant ürün ifadesinin içinde de bulunur ve diller arası karşılık tanınır", () => {
    expect(mentions("double cheeseburger", "Çift")).toBe(true);
    const r = resolveSelection(burger, { phrase: "double cheeseburger medium", heard: "a double cheeseburger, medium please" });
    expect(r.ok && r.variant?.name).toBe("Çift");
  });

  it("şişe hacmi Türkçe söylenişiyle eşlenir (yetmişlik → 70 cl, yüzlük → 100 cl, 35'lik → 35 cl, duble)", () => {
    const raki = { ...burger, name: "Yeni Rakı", modifierGroups: [], variants: ["Tek", "Duble", "20 cl", "35 cl", "70 cl", "100 cl", "37.5 cl"].map((name) => ({ ...burger.variants[0]!, ref: name, name })) };
    const pick = (heard: string, variant?: string) => {
      const r = resolveSelection(raki, { phrase: "yeni rakı", variant, heard });
      return r.ok ? r.variant?.name : r.needs;
    };
    expect(pick("bir yetmişlik Yeni Rakı istiyorum", "70 cl")).toBe("70 cl");
    expect(pick("Yeni Rakı yetmişlik olsun")).toBe("70 cl");
    expect(pick("yüzlük yeni rakı")).toBe("100 cl");
    expect(pick("bir litrelik yeni rakı")).toBe("100 cl");
    expect(pick("35'lik yeni rakı")).toBe("35 cl");
    expect(pick("otuz beşlik yeni rakı")).toBe("35 cl");
    expect(pick("yarım şişe yeni rakı")).toBe("37.5 cl");
    expect(pick("duble yeni rakı")).toBe("Duble");
    expect(pick("bir yeni rakı")).toBe("variant");
    // Model "70 cl" uydursa da müşteri hacim söylemediyse kabul edilmez
    expect(pick("bir yeni rakı alalım", "70 cl")).toBe("variant");
  });

  it("varyant söylenmediyse TAHMİN yok → seçenekler döner", () => {
    const r = resolveSelection(burger, { phrase: "cheeseburger" });
    expect(r).toMatchObject({ ok: false, needs: "variant" });
  });

  it("model varyant uydursa da müşterinin söylediği metinde yoksa yok sayılır", () => {
    const r = resolveSelection(burger, { phrase: "cheeseburger", variant: "Tek", options: ["Orta"], heard: "Merhaba, bir çizburger istiyorum, orta pişmiş olsun." });
    expect(r).toMatchObject({ ok: false, needs: "variant" });
  });

  it("zorunlu seçim eksikse grup ve seçenekler döner", () => {
    const r = resolveSelection(burger, { phrase: "cheeseburger", variant: "Tek" });
    expect(r).toMatchObject({ ok: false, needs: "options", group: "Pişirme Derecesi", min: 1 });
  });
});

describe("sesten sese garson — fonetik eşleşme", () => {
  it("Türkçe söyleniş menüdeki yabancı ada eşlenir", () => {
    expect(soundKey("çizburger")).toBe(soundKey("Cheeseburger").replace("se", "s"));
    expect(resolveBySound(products, "çizburger")?.key).toBe("cheeseburger");
  });
  it("benzemeyen ifade eşlenmez (yanlış ürün riski yok)", () => {
    expect(resolveBySound(products, "lahmacun")).toBeNull();
  });
});

describe("sesten sese garson — talimat ve araçlar", () => {
  it("katalog fiyat, varyant, zorunlu seçim ve tükendi bilgisini içerir", () => {
    const c = menuCatalog(products);
    expect(c).toContain("Cheeseburger | Tek ₺380,00 / Çift ₺500,00");
    expect(c).toContain("seçim gerekli: Pişirme Derecesi (Orta)");
    expect(c).toMatch(/Köfte .*TÜKENDİ/);
  });

  it("talimat: Türkçe okunuş, tahmin yasağı, sesli onaylı sipariş", () => {
    const text = buildRealtimeInstructions({ restaurantName: "Lezzet Durağı", tableName: "Masa 4", assistantName: "Garson", tone: "WARM", customInstructions: null, currency: "TRY", catalog: "- X", ordering: true });
    expect(text).toContain("Lezzet Durağı");
    expect(text).toContain("'çizburger'");
    expect(text).toContain("ASLA tahmin etme");
    expect(text).toContain("placeOrder'ı YALNIZCA");
    const closed = buildRealtimeInstructions({ restaurantName: "R", tableName: "M", assistantName: "G", tone: "WARM", customInstructions: null, currency: "TRY", catalog: "", ordering: false });
    expect(closed).not.toContain("placeOrder");
  });

  it("karşılama restoran adını açıkça içerir (yanıt talimatı oturum talimatının yerine geçer)", () => {
    expect(greetingInstruction({ restaurantName: "Lezzet Durağı", welcomeMessage: null })).toContain('TAM OLARAK "Lezzet Durağı"');
    expect(greetingInstruction({ restaurantName: "R", welcomeMessage: "Hoş geldiniz!" })).toContain("«Hoş geldiniz!»");
  });

  it("sipariş paketi yoksa sepet / sipariş araçları verilmez; placeOrder açık onay ister", () => {
    expect(enabledRealtimeTools(settings, false)).not.toContain("placeOrder");
    expect(enabledRealtimeTools(settings, true)).toContain("placeOrder");
    expect(enabledRealtimeTools({ ...settings, allowServiceActions: false }, true)).not.toContain("callService");
    expect(parseRealtimeArgs("placeOrder", {})).toBeNull();
    expect(parseRealtimeArgs("placeOrder", { confirmed: true })).toEqual({ confirmed: true });
    expect(realtimeToolDefinitions(["addToCart"])[0]).toMatchObject({ type: "function", name: "addToCart" });
  });
});

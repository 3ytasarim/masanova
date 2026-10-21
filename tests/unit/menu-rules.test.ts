import { describe, expect, it } from "vitest";
import { menuLocalesFor, textDirection, translatableLocales } from "@/config/menu";
import { resolveAvailability } from "@/lib/menu/availability";
import { productCompleteness } from "@/lib/menu/completeness";
import { minorToInput, parsePriceToMinor } from "@/lib/menu/money";
import { resolveProductPrice, resolveStartingPrice, totalWithModifiers } from "@/lib/menu/pricing";
import { validateCategoryParent, validateModifierGroupRules, validateModifierSelection } from "@/lib/menu/rules";
import { isTranslationMissing, pickTranslated, translatedName } from "@/lib/menu/translation";
import { hasPermission } from "@/lib/permissions/roles";
import { externalUrlProvider } from "@/lib/storage/external-url-provider";
import { categorySchema, modifierGroupSchema, modifierSchema, productContentSchema, productImageSchema, menuSlugSchema, variantSchema } from "@/lib/validation/menu";

const product = { basePriceMinor: 9000, currency: "TRY" };

describe("para (tamsayı kuruş)", () => {
  it.each([
    ["89", 8900],
    ["89,9", 8990],
    ["89,90", 8990],
    ["89.90", 8990],
    [" 1250 ", 125000],
    ["0", 0],
  ])("%s → %d", (input, expected) => expect(parsePriceToMinor(input)).toBe(expected));

  it.each(["", "abc", "-5", "1.250,00", "89,999", "1e3", "10000000000"])("geçersiz: %s", (input) => expect(parsePriceToMinor(input)).toBeNull());

  it("girdi biçimi Intl'siz ve kararlı", () => {
    expect(minorToInput(8990)).toBe("89,90");
    expect(minorToInput(5)).toBe("0,05");
    expect(minorToInput(null)).toBe("");
  });
});

describe("fiyat çözümleyici", () => {
  it("varyantsız: şube fiyatı → taban fiyat", () => {
    expect(resolveProductPrice({ product })).toEqual({ amountMinor: 9000, currency: "TRY", source: "product" });
    expect(resolveProductPrice({ product, branchProduct: { priceMinor: 8000 } })).toMatchObject({ amountMinor: 8000, source: "branch_product" });
    expect(resolveProductPrice({ product, branchProduct: { priceMinor: null } })).toMatchObject({ amountMinor: 9000, source: "product" });
  });

  it("varyant: şube varyant fiyatı en yüksek öncelik", () => {
    const r = resolveProductPrice({ product, variant: { priceMinor: 12000 }, branchProduct: { priceMinor: 8000 }, branchVariant: { priceMinor: 11000 } });
    expect(r).toMatchObject({ amountMinor: 11000, source: "branch_variant" });
  });

  it("varyantın kendi fiyatı şube ÜRÜN fiyatından önce gelir (taban fiyatı ezmez)", () => {
    expect(resolveProductPrice({ product, variant: { priceMinor: 12000 }, branchProduct: { priceMinor: 8000 } })).toMatchObject({ amountMinor: 12000, source: "variant" });
  });

  it("fiyatsız varyant şube fiyatını, o da yoksa taban fiyatı miras alır", () => {
    expect(resolveProductPrice({ product, variant: { priceMinor: null }, branchProduct: { priceMinor: 8000 } })).toMatchObject({ amountMinor: 8000, source: "branch_product" });
    expect(resolveProductPrice({ product, variant: { priceMinor: null } })).toMatchObject({ amountMinor: 9000, source: "product" });
  });

  it("ekstralar tamsayı olarak eklenir; negatif fark yok sayılır", () => {
    expect(totalWithModifiers(resolveProductPrice({ product }), [3000, 2000, -500]).amountMinor).toBe(14000);
  });

  it("başlangıç fiyatı en düşük çözülmüş varyant", () => {
    const start = resolveStartingPrice({ product, variants: [{ id: "a", priceMinor: 12000 }, { id: "b", priceMinor: null }], branchVariantPrices: new Map([["a", 7000]]) });
    expect(start).toMatchObject({ amountMinor: 7000, source: "branch_variant" });
  });
});

describe("erişilebilirlik çözümleyici", () => {
  const p = { active: true, soldOut: false, archivedAt: null };
  it("varsayılan: satışta", () => expect(resolveAvailability({ product: p })).toEqual({ status: "available", visible: true, orderable: true, reason: null }));
  it("arşiv / pasif ürün / pasif kategori / pasif üst kategori / pasif şube → görünmez", () => {
    expect(resolveAvailability({ product: { ...p, archivedAt: new Date() } }).reason).toBe("archived");
    expect(resolveAvailability({ product: { ...p, active: false } }).reason).toBe("product_inactive");
    expect(resolveAvailability({ product: p, category: { active: false } }).reason).toBe("category_inactive");
    expect(resolveAvailability({ product: p, category: { active: true, parent: { active: false } } }).reason).toBe("category_inactive");
    expect(resolveAvailability({ product: p, branch: { active: false } }).reason).toBe("branch_inactive");
  });
  it("şube 'satılmıyor' → görünmez; seçili varyant pasif → görünmez", () => {
    expect(resolveAvailability({ product: p, branchProduct: { available: false, soldOut: null } }).visible).toBe(false);
    expect(resolveAvailability({ product: p, variant: { active: false, archivedAt: null } }).reason).toBe("variant_inactive");
  });
  it("tükendi: şube geçersiz kılması üründen önce gelir", () => {
    expect(resolveAvailability({ product: { ...p, soldOut: true } })).toMatchObject({ status: "sold_out", visible: true, orderable: false });
    expect(resolveAvailability({ product: { ...p, soldOut: true }, branchProduct: { available: null, soldOut: false } }).status).toBe("available");
    expect(resolveAvailability({ product: p, branchProduct: { available: true, soldOut: true } })).toMatchObject({ status: "sold_out", reason: "branch_sold_out" });
  });
});

describe("ekstra grubu kuralları", () => {
  it("zorunlu ⇔ en az ≥ 1; en fazla ≥ en az", () => {
    expect(validateModifierGroupRules({ required: true, minSelect: 1, maxSelect: 1 })).toBeNull();
    expect(validateModifierGroupRules({ required: false, minSelect: 0, maxSelect: 3 })).toBeNull();
    expect(validateModifierGroupRules({ required: true, minSelect: 0, maxSelect: 1 })).not.toBeNull();
    expect(validateModifierGroupRules({ required: false, minSelect: 2, maxSelect: 3 })).not.toBeNull();
    expect(validateModifierGroupRules({ required: true, minSelect: 3, maxSelect: 2 })).not.toBeNull();
    expect(validateModifierGroupRules({ required: false, minSelect: 0, maxSelect: 0 })).not.toBeNull();
  });
  it("Zod şeması aynı kuralları uygular", () => {
    expect(modifierGroupSchema.safeParse({ name: "X", required: true, minSelect: "0", maxSelect: "1", active: true }).success).toBe(false);
    expect(modifierGroupSchema.safeParse({ name: "X", required: true, minSelect: "1", maxSelect: "2", active: true }).success).toBe(true);
  });
  it("seçim doğrulaması (gelecekteki sipariş motoru)", () => {
    const rule = { required: true, minSelect: 1, maxSelect: 2 };
    expect(validateModifierSelection(rule, 0, 5)).not.toBeNull();
    expect(validateModifierSelection(rule, 2, 5)).toBeNull();
    expect(validateModifierSelection(rule, 3, 5)).not.toBeNull();
    expect(validateModifierSelection({ required: false, minSelect: 0, maxSelect: 5 }, 3, 2)).not.toBeNull(); // aktif seçenekten fazla seçilemez
  });
  it("negatif ekstra fiyatı reddedilir", () => {
    expect(modifierSchema.safeParse({ name: "X", priceDelta: "-5", active: true }).success).toBe(false);
    expect(modifierSchema.parse({ name: "X", priceDelta: "30", active: true }).priceDelta).toBe(3000);
  });
});

describe("çeviri yedeği", () => {
  const base = { name: "Mercimek Çorbası", shortDescription: "Kısa", description: null };
  const translations = [
    { locale: "en", name: "Lentil Soup", shortDescription: "", description: null },
    { locale: "ar", name: "شوربة العدس", shortDescription: null, description: null },
  ];
  it("istenen dil varsa onu, alan boşsa varsayılanı kullanır", () => {
    const en = pickTranslated(base, translations, "en", "tr");
    expect(en.values).toEqual({ name: "Lentil Soup", shortDescription: "Kısa", description: null });
    expect(en.fallback).toBe(false);
  });
  it("çeviri yoksa varsayılan dile düşer", () => {
    expect(pickTranslated(base, translations, "de", "tr")).toMatchObject({ values: base, fallback: true, locale: "tr" });
  });
  it("varsayılan dil istenirse ana satır döner", () => expect(pickTranslated(base, translations, "tr", "tr").values).toBe(base));
  it("ad kısa yolu ve eksik çeviri tespiti", () => {
    expect(translatedName("Milk", [{ locale: "tr", name: "Süt" }, { locale: "de", name: "Milch" }], "de", "tr")).toBe("Milch");
    expect(translatedName("Milk", [{ locale: "tr", name: "Süt" }], "en", "tr")).toBe("Süt");
    expect(translatedName("Milk", [], "en", "tr")).toBe("Milk");
    expect(isTranslationMissing([{ locale: "en", name: " " }], "en")).toBe(true);
  });
  it("dil yapılandırması + RTL", () => {
    expect(menuLocalesFor("tr")).toEqual(["tr", "en", "de", "ar"]);
    expect(translatableLocales("en")).toEqual(["tr", "de", "ar"]);
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("de")).toBe("ltr");
  });
});

describe("ürün bütünlüğü (uyarı, engel değil)", () => {
  const complete = {
    basePriceMinor: 9000,
    shortDescription: "x",
    description: null,
    imageCount: 1,
    variantPrices: [],
    allergensConfirmedAt: new Date(),
    allergenCount: 0,
    translations: [{ locale: "en", name: "A" }, { locale: "de", name: "B" }, { locale: "ar", name: "ج" }],
    translatableLocales: ["en", "de", "ar"],
  };
  it("eksiksiz ürün %100", () => expect(productCompleteness(complete)).toEqual({ issues: [], score: 100 }));
  it("eksikleri listeler", () => {
    const r = productCompleteness({ ...complete, imageCount: 0, shortDescription: null, basePriceMinor: 0, allergensConfirmedAt: null, translations: [] });
    expect(r.issues.map((i) => i.code)).toEqual(["missing_image", "missing_description", "missing_price", "missing_allergen_data", "missing_translation", "missing_translation", "missing_translation"]);
    expect(r.score).toBe(0);
  });
  it("varyant fiyatı varsa taban 0 olsa da fiyat eksik sayılmaz", () => {
    expect(productCompleteness({ ...complete, basePriceMinor: 0, variantPrices: [5000] }).issues).toEqual([]);
  });
});

describe("kategori hiyerarşisi", () => {
  const nodes = [
    { id: "food", parentId: null },
    { id: "burgers", parentId: "food" },
    { id: "drinks", parentId: null },
  ];
  it("tek seviye alt kategori serbest", () => expect(validateCategoryParent(null, "food", nodes)).toBeNull());
  it("kendine üst olamaz, ikinci seviye yok, döngü imkânsız", () => {
    expect(validateCategoryParent("food", "food", nodes)).toBe("self_parent");
    expect(validateCategoryParent(null, "burgers", nodes)).toBe("parent_is_child");
    expect(validateCategoryParent("food", "drinks", nodes)).toBe("has_children"); // altı olan kategori taşınamaz
    expect(validateCategoryParent("drinks", "burgers", nodes)).toBe("parent_is_child");
  });
  it("başka kiracının kategorisi (listede yok) üst olamaz", () => expect(validateCategoryParent(null, "other-tenant-cat", nodes)).toBe("parent_not_found"));
});

describe("doğrulama şemaları", () => {
  it("kısa ad: küçük harf, URL güvenli, ayrılmış kelime kontrolü yok (kiracı içi)", () => {
    expect(menuSlugSchema.parse("Cheese-Burger")).toBe("cheese-burger");
    for (const bad of ["a", "çorba", "a b", "-x", "x--y"]) expect(menuSlugSchema.safeParse(bad).success).toBe(false);
    expect(menuSlugSchema.safeParse("admin").success).toBe(true);
  });
  it("görsel URL: yalnızca https, yerel/özel ağ yok, kimlik bilgisi yok", () => {
    expect(externalUrlProvider.validateKey("https://cdn.example.com/a.webp")).toMatchObject({ ok: true });
    for (const bad of ["http://cdn.example.com/a.webp", "https://localhost/a.png", "https://192.168.1.2/a.png", "https://user:pw@cdn.example.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAA"]) {
      expect(externalUrlProvider.validateKey(bad).ok).toBe(false);
    }
    expect(productImageSchema.safeParse({ url: "https://cdn.example.com/a.webp", altText: "x".repeat(161) }).success).toBe(false);
  });
  it("besin değerleri sınırlı tam sayı", () => {
    const base = { ingredientIds: [], allergenIds: [], dietaryTagIds: [], allergensConfirmed: false };
    expect(productContentSchema.parse({ ...base, calories: "520" }).calories).toBe(520);
    expect(productContentSchema.safeParse({ ...base, calories: "-1" }).success).toBe(false);
    expect(productContentSchema.safeParse({ ...base, proteinGrams: "12.5" }).success).toBe(false);
  });
  it("çeviriler yalnızca desteklenen menü dilleri", () => {
    const base = { name: "A", slug: "a1", active: true, featured: false };
    expect(categorySchema.safeParse({ ...base, translations: { en: { name: "A" }, ar: { name: "أ" } } }).success).toBe(true);
    expect(categorySchema.safeParse({ ...base, translations: { xx: { name: "A" } } }).success).toBe(false);
  });
  it("varyant fiyatı boş → null (miras), geçersiz → hata", () => {
    expect(variantSchema.parse({ name: "Büyük", price: "", active: true, isDefault: false }).price).toBeNull();
    expect(variantSchema.safeParse({ name: "Büyük", price: "abc", active: true, isDefault: false }).success).toBe(false);
  });
  it("şema tenantId alanı taşımaz", () => {
    const parsed = categorySchema.parse({ name: "A", slug: "a1", active: true, featured: false, tenantId: "evil" });
    expect(parsed).not.toHaveProperty("tenantId");
  });
});

describe("menü yetkileri", () => {
  it("sahip ve şube müdürü düzenler; operasyon rolleri yalnızca görür", () => {
    expect(hasPermission("TENANT_OWNER", "menu.manage")).toBe(true);
    expect(hasPermission("BRANCH_MANAGER", "menu.manage")).toBe(true);
    for (const role of ["WAITER", "CASHIER", "KITCHEN", "BAR"] as const) {
      expect(hasPermission(role, "menu.view")).toBe(true);
      expect(hasPermission(role, "menu.manage")).toBe(false);
    }
    expect(hasPermission("SUPER_ADMIN", "menu.manage")).toBe(false);
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { StableEntryRecord } from "@/lib/tables/resolve-stable-entry";
import type { PublishedMenu } from "@/server/services/menu/public-menu.service";
import type { PublishedProduct } from "@/server/services/menu/public-menu.service";
import type { PublicPresentation } from "@/server/services/public-menu/public-menu-cache";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { textDirection } = await import("@/config/menu");
const { buildStableQrUrl, resolveQrEntryOrigin } = await import("@/lib/domain/qr-entry");
const { pickTranslated, translatedName } = await import("@/lib/menu/translation");
const { LOCALE_BADGES, pickPublicLocale, publicStrings, turkishAblative } = await import("@/lib/public-menu/i18n");
const { POPULAR_KEY, buildCategoryNav } = await import("@/lib/public-menu/navigation");
const { EMPTY_FILTERS, filterProducts, hasActiveFilters, matchesQuery, normalizeSearchText } = await import("@/lib/public-menu/search");
const { DEFAULT_BRAND, resolvePublicTheme } = await import("@/lib/public-menu/theme");
const { contrastRatio } = await import("@/lib/tables/contrast");
const { issueQrToken } = await import("@/lib/tables/qr-token");
const { currentTenantHostname, resolveStableQrEntry } = await import("@/lib/tables/resolve-stable-entry");
const { shouldCountScan } = await import("@/lib/tables/scan-count");
const { publicMenuCacheKey, publicMenuTag } = await import("@/server/services/public-menu/public-menu-cache");
const { toPublicMenuView } = await import("@/server/services/public-menu/serialize");


const refOf = (id: string) => createHash("sha256").update(id).digest("base64url").slice(0, 12);
const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

// ─── Kararlı QR girişi ──────────────────────────────────────────────────────

describe("kararlı QR adresi", () => {
  it("etiket adresi = <QR_ENTRY_ORIGIN>/q/<token> (kiracı alan adı içermez)", () => {
    expect(buildStableQrUrl("AbCdEfGhIjKlMnOpQrStUv", "https://go.masanovai.com")).toBe("https://go.masanovai.com/q/AbCdEfGhIjKlMnOpQrStUv");
  });

  it("QR_ENTRY_ORIGIN doğrulaması: boşsa platform; yol/sorgu yok; üretimde https", () => {
    expect(resolveQrEntryOrigin(undefined, "http://localhost:3000/")).toBe("http://localhost:3000");
    expect(resolveQrEntryOrigin(" https://go.masanovai.com ", "x", true)).toBe("https://go.masanovai.com");
    expect(() => resolveQrEntryOrigin("https://go.masanovai.com/q", "x")).toThrow();
    expect(() => resolveQrEntryOrigin("http://go.masanovai.com", "x", true)).toThrow();
    expect(() => resolveQrEntryOrigin("ftp://go.masanovai.com", "x")).toThrow();
    expect(() => resolveQrEntryOrigin("bozuk adres", "x")).toThrow();
  });
});

const domains = (list: Partial<StableEntryRecord["table"]["tenant"]["domains"][number]>[]) =>
  list.map((d) => ({ hostname: "demo.masanovai.com", type: "SUBDOMAIN" as const, verified: false, isPrimary: false, ...d }));

function entry(overrides: Partial<StableEntryRecord> = {}, table: Partial<StableEntryRecord["table"]> = {}): StableEntryRecord {
  return {
    active: true,
    revokedAt: null,
    expiresAt: null,
    ...overrides,
    table: {
      active: true,
      branch: { active: true },
      area: { active: true },
      tenant: { status: "ACTIVE", domains: domains([{ isPrimary: true }]) },
      ...table,
    },
  };
}
const lookup = (rec: StableEntryRecord | null) => {
  const calls: string[] = [];
  return { calls, findByTokenHash: async (h: string) => (calls.push(h), rec) };
};

describe("resolveStableQrEntry", () => {
  const { token } = issueQrToken(SECRET);

  it("geçerli token → kiracının o anki birincil alan adındaki /t/<token>", async () => {
    expect(await resolveStableQrEntry({ token }, { lookup: lookup(entry()) })).toEqual({ ok: true, hostname: "demo.masanovai.com", path: `/t/${token}` });
  });

  it("birincil alan adı değişince yönlendirme yeni alan adına gider; doğrulanmamış özel alan adına asla gitmez", () => {
    expect(currentTenantHostname(domains([{ hostname: "eski.masanovai.com" }, { hostname: "menu.restoran.com", type: "CUSTOM_DOMAIN", verified: true, isPrimary: true }]))).toBe("menu.restoran.com");
    expect(currentTenantHostname(domains([{ hostname: "yeni.masanovai.com", isPrimary: true }, { hostname: "menu.restoran.com", type: "CUSTOM_DOMAIN", verified: false }]))).toBe("yeni.masanovai.com");
    expect(currentTenantHostname(domains([{ hostname: "menu.restoran.com", type: "CUSTOM_DOMAIN", verified: false, isPrimary: true }, { hostname: "a.masanovai.com" }]))).toBe("a.masanovai.com");
    expect(currentTenantHostname([])).toBeNull();
  });

  it.each([
    ["iptal edilmiş", entry({ active: false, revokedAt: new Date() }), "revoked"],
    ["süresi dolmuş", entry({ expiresAt: new Date(Date.now() - 1) }), "expired"],
    ["pasif masa", entry({}, { active: false }), "inactive"],
    ["pasif bölge", entry({}, { area: { active: false } }), "inactive"],
    ["pasif şube", entry({}, { branch: { active: false } }), "inactive"],
    ["askıdaki kiracı", entry({}, { tenant: { status: "SUSPENDED", domains: domains([{ isPrimary: true }]) } }), "tenant_unavailable"],
    ["iptal edilmiş kiracı", entry({}, { tenant: { status: "CANCELLED", domains: domains([{ isPrimary: true }]) } }), "tenant_unavailable"],
    ["yayın alan adı yok", entry({}, { tenant: { status: "ACTIVE", domains: [] } }), "no_domain"],
    ["bilinmeyen token", null, "unknown"],
  ] as const)("%s → reddedilir", async (_l, rec, reason) => {
    expect(await resolveStableQrEntry({ token }, { lookup: lookup(rec) })).toEqual({ ok: false, reason });
  });

  it("biçimsiz değer veritabanına gitmez (sayım/tarama yüzeyi yok)", async () => {
    const l = lookup(entry());
    for (const bad of ["", "a", "../../etc", "x".repeat(200)]) expect(await resolveStableQrEntry({ token: bad }, { lookup: l })).toEqual({ ok: false, reason: "malformed" });
    expect(l.calls).toHaveLength(0);
  });

  it("başarılı sonuç masa / şube / kiracı kimliği ya da adı içermez", async () => {
    const result = await resolveStableQrEntry({ token }, { lookup: lookup(entry()) });
    expect(Object.keys(result).sort()).toEqual(["hostname", "ok", "path"]);
  });
});

describe("okutma sayımı (kanonik olay)", () => {
  const h = (values: Record<string, string>) => ({ get: (k: string) => values[k.toLowerCase()] ?? null });
  it("belge açılışı sayılır; RSC gezinmesi, ön yükleme ve alt kaynaklar sayılmaz", () => {
    expect(shouldCountScan(h({ "sec-fetch-dest": "document" }))).toBe(true);
    expect(shouldCountScan(h({}))).toBe(true);
    expect(shouldCountScan(h({ rsc: "1", "sec-fetch-dest": "empty" }))).toBe(false);
    expect(shouldCountScan(h({ "next-router-prefetch": "1" }))).toBe(false);
    expect(shouldCountScan(h({ "sec-purpose": "prefetch;prerender", "sec-fetch-dest": "document" }))).toBe(false);
    expect(shouldCountScan(h({ "sec-fetch-dest": "image" }))).toBe(false);
  });
});

// ─── Tema ───────────────────────────────────────────────────────────────────

describe("public menü teması", () => {
  it("geçersiz renk / düzen → güvenli varsayılan", () => {
    const theme = resolvePublicTheme({ primaryColor: "red; background:url(x)", style: "NEON" as "VISUAL" });
    expect(theme.brand).toBe(DEFAULT_BRAND);
    expect(theme.style).toBe("MODERN");
  });

  it("marka üstü metin ve vurgu metni her zaman ≥ 4,5:1", () => {
    for (const primary of ["#fde047", "#1e3a8a", "#ffffff", "#ea580c", "#000000"]) {
      for (const accent of [null, "#facc15", "#0f766e"]) {
        const theme = resolvePublicTheme({ primaryColor: primary, accentColor: accent });
        expect(contrastRatio(theme.brand, theme.onBrand)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(theme.accentText, "#faf8f5")).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("karşılama metni kırpılır ve boşluklar sadeleşir; görünürlük varsayılanı açık", () => {
    const theme = resolvePublicTheme({ welcomeText: `  Merhaba \n\n ${"x".repeat(300)}` });
    expect(theme.welcomeText!.length).toBe(160);
    expect(theme.show).toEqual({ nutrition: true, allergens: true, ingredients: true, preparationTime: true, poweredBy: true });
  });
});

// ─── Dil / çeviri / RTL ─────────────────────────────────────────────────────

describe("dil seçimi, çeviri yedeği ve RTL", () => {
  it("URL → çerez → kiracı varsayılanı; desteklenmeyen değer yok sayılır", () => {
    expect(pickPublicLocale({ query: "de", cookie: "en", tenantDefault: "tr" })).toBe("de");
    expect(pickPublicLocale({ query: "fr", cookie: "en", tenantDefault: "tr" })).toBe("en");
    expect(pickPublicLocale({ query: null, cookie: "xx", tenantDefault: "ar" })).toBe("ar");
    expect(pickPublicLocale({ tenantDefault: "zz" })).toBe("tr");
  });

  it("eksik çeviri varsayılan içeriğe düşer; boş / undefined gösterilmez", () => {
    expect(pickTranslated({ name: "Çorba", description: "Sıcak" }, [{ locale: "de", name: "Suppe", description: "  " }], "de", "tr").values).toEqual({ name: "Suppe", description: "Sıcak" });
    expect(pickTranslated({ name: "Çorba" }, [], "de", "tr")).toMatchObject({ values: { name: "Çorba" }, fallback: true });
    expect(translatedName("Gluten", [{ locale: "ar", name: " " }], "ar", "tr")).toBe("Gluten");
  });

  it("arayüz metinleri dört dilde tam; Arapça RTL", () => {
    for (const locale of ["tr", "en", "de", "ar"]) {
      const s = publicStrings(locale);
      for (const [key, value] of Object.entries(s)) {
        if (typeof value === "string") expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
      expect(LOCALE_BADGES[locale as "tr"]).toMatch(/^[A-Z]{2}$/);
    }
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("de")).toBe("ltr");
    expect(publicStrings("xx").searchPlaceholder).toBe("Menüde ara");
  });

  it("Türkçe başlangıç fiyatı eki okunuşa göre", () => {
    expect(turkishAblative("₺50,00")).toBe("'dan");
    expect(turkishAblative("₺49,91")).toBe("'den");
    expect(turkishAblative("₺12,75")).toBe("'ten");
    expect(publicStrings("tr").startingAt("₺380,00")).toBe("₺380,00'dan başlayan");
    expect(publicStrings("en").startingAt("£5.00")).toBe("from £5.00");
  });
});

// ─── Serileştirme, arama, filtreler, gezinme ────────────────────────────────

function product(overrides: Partial<PublishedProduct> = {}): PublishedProduct {
  return {
    id: "cm_internal_product_id",
    slug: "cheeseburger",
    name: "Cheeseburger",
    shortDescription: "Dana köfte, cheddar",
    description: "Izgara dana köfte",
    translationFallback: false,
    featured: false,
    availability: "available",
    price: { amountMinor: 38000, currency: "TRY", startingFrom: false },
    preparationMinutes: 15,
    images: [],
    variants: [],
    modifierGroups: [],
    ingredients: ["Dana köfte", "Cheddar peyniri"],
    allergens: [{ code: "gluten", name: "Gluten" }],
    allergensDeclared: true,
    dietaryTags: [],
    nutrition: { calories: 650, proteinGrams: 30, carbohydrateGrams: 40, fatGrams: 35 },
    declaredByRestaurant: true,
    ...overrides,
  };
}

const presentation: PublicPresentation = {
  restaurantName: "Demo",
  defaultLocale: "tr",
  logoUrl: null,
  logoExternalUrl: null,
  logoManaged: false,
  primaryColor: "#1e3a8a",
  accentColor: null,
  style: "VISUAL",
  welcomeText: null,
      googleReviewUrl: null,
  heroImageUrl: null,
  heroExternalUrl: null,
  heroManaged: false,
  showNutrition: true,
  showAllergens: true,
  showIngredients: true,
  showPreparationTime: true,
  showPoweredBy: true,
};

const menu: PublishedMenu = {
  locale: "tr",
  defaultLocale: "tr",
  direction: "ltr",
  currency: "TRY",
  branch: { id: "cm_internal_branch_id", name: "Kadıköy" },
  categories: [
    {
      id: "cm_cat_burger",
      slug: "burgerler",
      name: "Burgerler",
      description: null,
      imageUrl: null,
      featured: false,
      children: [],
      products: [
        product({
          featured: true,
          variants: [
            { id: "v1", name: "Tek", priceMinor: 38000, isDefault: true },
            { id: "v2", name: "Çift", priceMinor: 52000, isDefault: false },
          ],
          price: { amountMinor: 38000, currency: "TRY", startingFrom: true },
          modifierGroups: [{ id: "g1", name: "Sos", required: false, minSelect: 0, maxSelect: 2, modifiers: [{ id: "m1", name: "Ranch", priceDeltaMinor: 1500 }, { id: "m2", name: "Ketçap", priceDeltaMinor: 0 }] }],
        }),
        product({ slug: "vegan-burger", name: "Vegan Burger", dietaryTags: [{ code: "vegan", name: "Vegan" }], allergens: [], allergensDeclared: true, availability: "sold_out" }),
        product({ slug: "gizemli", name: "Gizemli Burger", allergens: [], allergensDeclared: false }),
      ],
    },
    {
      id: "cm_cat_drinks",
      slug: "icecekler",
      name: "İçecekler",
      description: null,
      imageUrl: null,
      featured: false,
      products: [],
      children: [
        { id: "cm_cat_hot", slug: "sicak", name: "Sıcak İçecekler", description: null, imageUrl: null, featured: false, children: [], products: [product({ slug: "turk-kahvesi", name: "Türk Kahvesi", ingredients: ["Kahve"], allergens: [] })] },
      ],
    },
  ],
};

describe("public görünüm serileştirmesi", () => {
  const view = toPublicMenuView(menu, presentation, { table: { name: "Masa 12", area: "Teras" }, refOf, ordering: null });

  it("iç kimlik, SKU, kiracı/şube kimliği tarayıcıya gitmez", () => {
    const json = JSON.stringify(view);
    for (const secret of ["cm_internal_product_id", "cm_internal_branch_id", "cm_cat_burger", "\"v1\"", "\"m1\"", "tenantId", "sku", "declaredByRestaurant"]) expect(json).not.toContain(secret);
    expect(view.table).toEqual({ name: "Masa 12", area: "Teras" });
    expect(view.branch).toEqual({ name: "Kadıköy" });
  });

  it("fiyatlar sunucudaki çözülmüş değerden biçimlenir (istemci hesaplamaz)", () => {
    const burger = view.categories[0]!.products[0]!;
    expect(burger.priceLabel).toBe("₺380,00");
    expect(burger.startingFrom).toBe(true);
    expect(burger.variants.map((v) => v.priceLabel)).toEqual(["₺380,00", "₺520,00"]);
    expect(burger.modifierGroups[0]!.modifiers.map((m) => m.priceDeltaLabel)).toEqual(["+₺15,00", null]);
  });

  it("tükendi görünür ama işaretli; öne çıkanlar 'Popüler'e; alt kategoriler düzleşir", () => {
    expect(view.categories[0]!.products[1]!.soldOut).toBe(true);
    expect(view.featuredKeys).toEqual(["cheeseburger"]);
    expect(view.categories.map((c) => [c.key, c.parentKey])).toEqual([
      ["burgerler", null],
      ["icecekler", null],
      ["sicak", "icecekler"],
    ]);
    expect(buildCategoryNav(view, "Popüler")).toEqual([
      { key: POPULAR_KEY, name: "Popüler", child: false },
      { key: "burgerler", name: "Burgerler", child: false },
      { key: "icecekler", name: "İçecekler", child: false },
      { key: "sicak", name: "Sıcak İçecekler", child: true },
    ]);
  });

  it("görünürlük kapalıysa alanlar tarayıcıya gönderilmez; alerjen gizliyse hiçbir ürün 'içermez' sayılmaz", () => {
    const hidden = toPublicMenuView(menu, { ...presentation, showAllergens: false, showIngredients: false, showNutrition: false, showPreparationTime: false }, { table: null, refOf, ordering: null });
    const p = hidden.categories[0]!.products[0]!;
    expect(p.allergens).toEqual([]);
    expect(p.allergenInfoDeclared).toBe(false);
    expect(p.ingredients).toEqual([]);
    expect(p.nutrition).toBeNull();
    expect(p.preparationMinutes).toBeNull();
    expect(hidden.filters.allergens).toEqual([]);
    expect(p.search).not.toContain("cheddar peyniri");
  });

  it("arama: Türkçe/aksan duyarsız, çok kelimeli, malzeme ve kategori adıyla", () => {
    expect(normalizeSearchText("TÜRK KAHVESİ")).toBe("turk kahvesi");
    const all = view.categories.flatMap((c) => c.products);
    expect(filterProducts(all, { ...EMPTY_FILTERS, query: "kahve" }).map((p) => p.key)).toEqual(["turk-kahvesi"]);
    expect(filterProducts(all, { ...EMPTY_FILTERS, query: "sicak icecek" }).map((p) => p.key)).toEqual(["turk-kahvesi"]);
    expect(filterProducts(all, { ...EMPTY_FILTERS, query: "cheddar dana" }).map((p) => p.key)).toContain("cheeseburger");
    expect(filterProducts(all, { ...EMPTY_FILTERS, query: "pizza" })).toEqual([]);
    expect(matchesQuery("cheeseburger", "  ")).toBe(true);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("diyet filtresi beyana göre; 'içermesin' filtresi bilgisi olmayan ürünü asla güvenli göstermez", () => {
    const all = view.categories.flatMap((c) => c.products);
    expect(filterProducts(all, { ...EMPTY_FILTERS, dietary: ["vegan"] }).map((p) => p.key)).toEqual(["vegan-burger"]);
    const noGluten = filterProducts(all, { ...EMPTY_FILTERS, excludeAllergens: ["gluten"] }).map((p) => p.key);
    expect(noGluten).toEqual(["vegan-burger", "turk-kahvesi"]);
    expect(noGluten).not.toContain("gizemli");
    expect(view.filters.dietary).toEqual([{ code: "vegan", name: "Vegan" }]);
    expect(view.filters.allergens).toEqual([{ code: "gluten", name: "Gluten" }]);
  });

  it("RTL ve boş menü durumu", () => {
    const ar = toPublicMenuView({ ...menu, locale: "ar", direction: "rtl", categories: [] }, presentation, { table: null, refOf, ordering: null });
    expect(ar.direction).toBe("rtl");
    expect(ar.locale).toBe("ar");
    expect(ar.categories).toEqual([]);
    expect(buildCategoryNav(ar, "x")).toEqual([]);
  });
});

describe("önbellek anahtarı (kiracılar arası sızıntı yok)", () => {
  it("anahtar kiracı + şube + dil içerir; etiket kiracıya özel", () => {
    const a = publicMenuCacheKey("tenantA", "branch1", "tr").join("|");
    expect(new Set([a, publicMenuCacheKey("tenantB", "branch1", "tr").join("|"), publicMenuCacheKey("tenantA", "branch2", "tr").join("|"), publicMenuCacheKey("tenantA", "branch1", "en").join("|")]).size).toBe(4);
    expect(a).toContain("tenantA");
    expect(publicMenuTag("tenantA")).not.toBe(publicMenuTag("tenantB"));
  });
});

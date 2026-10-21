import type { PublicMenuView, PublicProductView } from "@/lib/public-menu/types";

/** Birim testleri için küçük, gerçekçi menü görünümü (PublicMenuView sözleşmesi). */
type P = Partial<PublicProductView> & { key: string; name: string; categoryKey: string; basePriceMinor: number };

const money = (minor: number) => `₺${(minor / 100).toFixed(2).replace(".", ",")}`;

export function product(p: P): PublicProductView {
  return {
    shortDescription: null,
    description: null,
    featured: false,
    soldOut: false,
    priceLabel: money(p.basePriceMinor),
    startingFrom: false,
    preparationMinutes: null,
    images: [],
    currency: "TRY",
    variants: [],
    modifierGroups: [],
    ingredients: [],
    allergens: [],
    allergenInfoDeclared: false,
    dietaryTags: [],
    nutrition: null,
    search: `${p.name} ${(p.ingredients ?? []).join(" ")}`.toLocaleLowerCase("tr-TR"),
    ...p,
  };
}

export function fakeView(): PublicMenuView {
  const corba = product({ key: "mercimek-corbasi", name: "Mercimek Çorbası", categoryKey: "corbalar", basePriceMinor: 12000, ingredients: ["Kırmızı mercimek", "Tereyağı", "Limon"], allergenInfoDeclared: true, allergens: [{ code: "milk", name: "Süt ve süt ürünleri" }], dietaryTags: [{ code: "vegetarian", name: "Vejetaryen" }] });
  const tavuk = product({ key: "izgara-tavuk", name: "Izgara Tavuk", categoryKey: "ana-yemekler", basePriceMinor: 34000, ingredients: ["Tavuk göğsü", "Yoğurt"], allergenInfoDeclared: true, allergens: [{ code: "milk", name: "Süt ve süt ürünleri" }], search: "izgara tavuk tavuk gogsu chicken" });
  const burger = product({
    key: "cheeseburger",
    name: "Cheeseburger",
    categoryKey: "burgerler",
    basePriceMinor: 38000,
    featured: true,
    startingFrom: true,
    allergenInfoDeclared: true,
    allergens: [{ code: "gluten", name: "Gluten" }],
    variants: [
      { ref: "v-tek", name: "Tek", priceLabel: money(38000), priceMinor: 38000, isDefault: true },
      { ref: "v-cift", name: "Çift", priceLabel: money(50000), priceMinor: 50000, isDefault: false },
    ],
    modifierGroups: [{ ref: "g-pisirme", name: "Pişirme Derecesi", required: true, minSelect: 1, maxSelect: 1, modifiers: [{ ref: "m-orta", name: "Orta", priceDeltaMinor: 0, priceDeltaLabel: null }] }],
  });
  const tukenen = product({ key: "kofte", name: "Köfte", categoryKey: "ana-yemekler", basePriceMinor: 30000, soldOut: true });
  const cheesecake = product({ key: "san-sebastian-cheesecake", name: "San Sebastian Cheesecake", categoryKey: "tatlilar", basePriceMinor: 22000, featured: true });
  const ayran = product({ key: "ayran", name: "Ayran", categoryKey: "icecekler", basePriceMinor: 5000, allergenInfoDeclared: true, allergens: [{ code: "milk", name: "Süt ve süt ürünleri" }] });
  const kahve = product({ key: "turk-kahvesi", name: "Türk Kahvesi", categoryKey: "sicak-icecekler", basePriceMinor: 9000, variants: [{ ref: "v-orta", name: "Orta", priceLabel: money(9000), priceMinor: 9000, isDefault: true }] });
  return {
    locale: "tr",
    defaultLocale: "tr",
    direction: "ltr",
    availableLocales: ["tr", "en", "de", "ar"],
    restaurant: { name: "Test Restoran" },
    branch: { name: "Merkez" },
    table: { name: "Masa 1", area: null },
    categories: [
      { key: "corbalar", name: "Çorbalar", description: null, imageUrl: null, parentKey: null, products: [corba] },
      { key: "ana-yemekler", name: "Ana Yemekler", description: null, imageUrl: null, parentKey: null, products: [tavuk, tukenen] },
      { key: "burgerler", name: "Burgerler", description: null, imageUrl: null, parentKey: null, products: [burger] },
      { key: "tatlilar", name: "Tatlılar", description: null, imageUrl: null, parentKey: null, products: [cheesecake] },
      { key: "icecekler", name: "İçecekler", description: null, imageUrl: null, parentKey: null, products: [ayran, kahve] },
    ],
    featuredKeys: ["cheeseburger", "san-sebastian-cheesecake"],
    filters: { dietary: [], allergens: [] },
    theme: { style: "COMPACT", brand: "#000", onBrand: "#fff", accentText: "#000", welcomeText: null, heroImageUrl: null, logoUrl: null, show: { nutrition: true, allergens: true, ingredients: true, preparationTime: true, poweredBy: true } },
    ordering: null,
  };
}

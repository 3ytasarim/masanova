/**
 * Demo restoran menüsü (idempotent). Var olan kayıtların üzerine YAZMAZ (update: {}) — işletmenin panelde
 * yaptığı değişiklikler yeniden seed'de korunur. Görsel eklenmez (telifli fotoğraf kullanılmaz); ürünler bu
 * yüzden "görsel yok" uyarısı gösterir. Arapça çeviriler örnek amaçlıdır, yayından önce gözden geçirilmeli.
 */
import type { PrismaClient } from "@prisma/client";

type T = { en: string; de: string; ar: string };
type L = "en" | "de" | "ar";
const LOCALES: L[] = ["en", "de", "ar"];

const CATEGORIES: { slug: string; name: string; t: T; parent?: string }[] = [
  { slug: "corbalar", name: "Çorbalar", t: { en: "Soups", de: "Suppen", ar: "الشوربات" } },
  { slug: "ana-yemekler", name: "Ana Yemekler", t: { en: "Main Courses", de: "Hauptgerichte", ar: "الأطباق الرئيسية" } },
  { slug: "burgerler", name: "Burgerler", t: { en: "Burgers", de: "Burger", ar: "البرغر" } },
  { slug: "tatlilar", name: "Tatlılar", t: { en: "Desserts", de: "Desserts", ar: "الحلويات" } },
  { slug: "icecekler", name: "İçecekler", t: { en: "Drinks", de: "Getränke", ar: "المشروبات" } },
  { slug: "sicak-icecekler", name: "Sıcak İçecekler", t: { en: "Hot Drinks", de: "Heiße Getränke", ar: "المشروبات الساخنة" }, parent: "icecekler" },
  { slug: "soguk-icecekler", name: "Soğuk İçecekler", t: { en: "Cold Drinks", de: "Kalte Getränke", ar: "المشروبات الباردة" }, parent: "icecekler" },
];

const INGREDIENTS: { name: string; t: T }[] = [
  { name: "Kırmızı mercimek", t: { en: "Red lentils", de: "Rote Linsen", ar: "عدس أحمر" } },
  { name: "Soğan", t: { en: "Onion", de: "Zwiebel", ar: "بصل" } },
  { name: "Tereyağı", t: { en: "Butter", de: "Butter", ar: "زبدة" } },
  { name: "Dana köfte", t: { en: "Beef patty", de: "Rindfleisch-Patty", ar: "قرص لحم بقري" } },
  { name: "Cheddar peyniri", t: { en: "Cheddar cheese", de: "Cheddar-Käse", ar: "جبنة شيدر" } },
  { name: "Brioche ekmek", t: { en: "Brioche bun", de: "Brioche-Brötchen", ar: "خبز بريوش" } },
  { name: "Tavuk göğsü", t: { en: "Chicken breast", de: "Hähnchenbrust", ar: "صدر دجاج" } },
  { name: "Krem peynir", t: { en: "Cream cheese", de: "Frischkäse", ar: "جبنة كريمية" } },
  { name: "Yumurta", t: { en: "Egg", de: "Ei", ar: "بيض" } },
  { name: "Yoğurt", t: { en: "Yogurt", de: "Joghurt", ar: "زبادي" } },
  { name: "Marul", t: { en: "Lettuce", de: "Salat", ar: "خس" } },
  { name: "Domates", t: { en: "Tomato", de: "Tomate", ar: "طماطم" } },
];

const GROUPS: { name: string; t: T; required: boolean; min: number; max: number; modifiers: { name: string; t: T; price: number }[] }[] = [
  {
    name: "Pişirme Derecesi",
    t: { en: "Doneness", de: "Garstufe", ar: "درجة الطهي" },
    required: true,
    min: 1,
    max: 1,
    modifiers: [
      { name: "Az Pişmiş", t: { en: "Rare", de: "Blutig", ar: "قليل الاستواء" }, price: 0 },
      { name: "Orta", t: { en: "Medium", de: "Medium", ar: "متوسط الاستواء" }, price: 0 },
      { name: "İyi Pişmiş", t: { en: "Well done", de: "Durchgebraten", ar: "مستوٍ جيدًا" }, price: 0 },
    ],
  },
  {
    name: "Ekstra Malzemeler",
    t: { en: "Extra Toppings", de: "Extra Beläge", ar: "إضافات" },
    required: false,
    min: 0,
    max: 3,
    modifiers: [
      { name: "Cheddar", t: { en: "Cheddar", de: "Cheddar", ar: "شيدر" }, price: 3000 },
      { name: "Dana Füme", t: { en: "Smoked beef", de: "Geräuchertes Rindfleisch", ar: "لحم بقري مدخن" }, price: 5000 },
      { name: "Jalapeno", t: { en: "Jalapeño", de: "Jalapeño", ar: "هالبينو" }, price: 2000 },
    ],
  },
  {
    name: "İçecek Seçimi",
    t: { en: "Drink choice", de: "Getränkewahl", ar: "اختيار المشروب" },
    required: true,
    min: 1,
    max: 1,
    modifiers: [
      { name: "Kola", t: { en: "Cola", de: "Cola", ar: "كولا" }, price: 0 },
      { name: "Ayran", t: { en: "Ayran", de: "Ayran", ar: "عيران" }, price: 0 },
      { name: "Su", t: { en: "Water", de: "Wasser", ar: "ماء" }, price: 0 },
    ],
  },
];

type ProductSeed = {
  slug: string;
  name: string;
  category: string;
  price: number;
  short: string;
  t: { en: [string, string]; de: [string, string]; ar: [string, string | null] };
  prep?: number;
  calories?: number;
  ingredients: string[];
  allergens: string[];
  tags: string[];
  variants?: { name: string; t: T; price: number | null; isDefault?: boolean }[];
  groups?: string[];
  featured?: boolean;
};

const PRODUCTS: ProductSeed[] = [
  {
    slug: "mercimek-corbasi",
    name: "Mercimek Çorbası",
    category: "corbalar",
    price: 12000,
    short: "Kırmızı mercimek, tereyağlı sos ve limon ile.",
    t: { en: ["Lentil Soup", "Red lentils with butter sauce and lemon."], de: ["Linsensuppe", "Rote Linsen mit Buttersoße und Zitrone."], ar: ["شوربة العدس", null] },
    prep: 5,
    calories: 220,
    ingredients: ["Kırmızı mercimek", "Soğan", "Tereyağı"],
    allergens: ["milk", "celery"],
    tags: ["vegetarian"],
  },
  {
    slug: "cheeseburger",
    name: "Cheeseburger",
    category: "burgerler",
    price: 38000,
    short: "Izgara dana köfte, cheddar, marul ve domates; brioche ekmekte.",
    t: { en: ["Cheeseburger", "Grilled beef patty, cheddar, lettuce and tomato in a brioche bun."], de: ["Cheeseburger", "Gegrilltes Rindfleisch-Patty mit Cheddar, Salat und Tomate im Brioche-Brötchen."], ar: ["تشيز برجر", null] },
    prep: 15,
    calories: 780,
    ingredients: ["Dana köfte", "Cheddar peyniri", "Brioche ekmek", "Marul", "Domates"],
    allergens: ["gluten", "milk", "eggs", "sesame"],
    tags: ["popular"],
    featured: true,
    variants: [
      { name: "Tek", t: { en: "Single", de: "Einfach", ar: "فردي" }, price: null, isDefault: true },
      { name: "Çift", t: { en: "Double", de: "Doppelt", ar: "مزدوج" }, price: 52000 },
    ],
    groups: ["Pişirme Derecesi", "Ekstra Malzemeler"],
  },
  {
    slug: "tavuk-burger-menu",
    name: "Tavuk Burger Menü",
    category: "burgerler",
    price: 42000,
    short: "Tavuk burger ve seçeceğiniz bir içecek.",
    t: { en: ["Chicken Burger Meal", "Chicken burger with a drink of your choice."], de: ["Chicken-Burger-Menü", "Chicken-Burger mit einem Getränk Ihrer Wahl."], ar: ["وجبة برجر الدجاج", null] },
    prep: 15,
    ingredients: ["Tavuk göğsü", "Brioche ekmek", "Marul"],
    allergens: ["gluten", "eggs", "sesame"],
    tags: [],
    groups: ["İçecek Seçimi", "Ekstra Malzemeler"],
  },
  {
    slug: "izgara-tavuk",
    name: "Izgara Tavuk",
    category: "ana-yemekler",
    price: 34000,
    short: "Marine edilmiş tavuk göğsü, yoğurtlu sos ile.",
    t: { en: ["Grilled Chicken", "Marinated chicken breast with yogurt sauce."], de: ["Gegrilltes Hähnchen", "Marinierte Hähnchenbrust mit Joghurtsoße."], ar: ["دجاج مشوي", null] },
    prep: 20,
    calories: 520,
    ingredients: ["Tavuk göğsü", "Yoğurt", "Domates"],
    allergens: ["milk"],
    tags: ["chef_recommendation"],
  },
  {
    slug: "san-sebastian-cheesecake",
    name: "San Sebastian Cheesecake",
    category: "tatlilar",
    price: 21000,
    short: "Yanık üstlü, kremamsı Bask usulü cheesecake.",
    t: { en: ["San Sebastian Cheesecake", "Creamy Basque-style burnt cheesecake."], de: ["San-Sebastián-Käsekuchen", "Cremiger Käsekuchen nach baskischer Art."], ar: ["تشيز كيك سان سيباستيان", null] },
    prep: 5,
    calories: 480,
    ingredients: ["Krem peynir", "Yumurta"],
    allergens: ["milk", "eggs", "gluten"],
    tags: ["popular"],
    featured: true,
  },
  {
    slug: "ayran",
    name: "Ayran",
    category: "soguk-icecekler",
    price: 4500,
    short: "Taze, köpüklü ayran.",
    t: { en: ["Ayran", "Fresh, frothy yogurt drink."], de: ["Ayran", "Frisches, schaumiges Joghurtgetränk."], ar: ["عيران", null] },
    ingredients: ["Yoğurt"],
    allergens: ["milk"],
    tags: ["vegetarian"],
    variants: [
      { name: "Küçük", t: { en: "Small", de: "Klein", ar: "صغير" }, price: null, isDefault: true },
      { name: "Büyük", t: { en: "Large", de: "Groß", ar: "كبير" }, price: 6500 },
    ],
  },
  {
    slug: "turk-kahvesi",
    name: "Türk Kahvesi",
    category: "sicak-icecekler",
    price: 7000,
    short: "Geleneksel usulde, lokum ile.",
    t: { en: ["Turkish Coffee", "Traditionally brewed, served with Turkish delight."], de: ["Türkischer Mokka", "Traditionell zubereitet, mit Lokum serviert."], ar: ["قهوة تركية", null] },
    ingredients: [],
    allergens: [],
    tags: ["vegan"],
  },
];

export async function seedDemoMenu(prisma: PrismaClient, tenantId: string): Promise<{ products: number }> {
  // Kategoriler
  const categoryIds = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const parentId = c.parent ? categoryIds.get(c.parent) ?? null : null;
    const cat = await prisma.menuCategory.upsert({
      where: { tenantId_slug: { tenantId, slug: c.slug } },
      update: {},
      create: { tenantId, slug: c.slug, name: c.name, parentId, sortOrder: (i + 1) * 10 },
      select: { id: true },
    });
    categoryIds.set(c.slug, cat.id);
    for (const locale of LOCALES) {
      await prisma.menuCategoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: cat.id, locale } },
        update: {},
        create: { tenantId, categoryId: cat.id, locale, name: c.t[locale] },
      });
    }
  }

  // Malzemeler
  const ingredientIds = new Map<string, string>();
  for (const ing of INGREDIENTS) {
    const row = await prisma.ingredient.upsert({
      where: { tenantId_name: { tenantId, name: ing.name } },
      update: {},
      create: { tenantId, name: ing.name },
      select: { id: true },
    });
    ingredientIds.set(ing.name, row.id);
    for (const locale of LOCALES) {
      await prisma.ingredientTranslation.upsert({
        where: { ingredientId_locale: { ingredientId: row.id, locale } },
        update: {},
        create: { tenantId, ingredientId: row.id, locale, name: ing.t[locale] },
      });
    }
  }

  // Ekstra grupları
  const groupIds = new Map<string, string>();
  for (const [gi, g] of GROUPS.entries()) {
    const group = await prisma.modifierGroup.upsert({
      where: { tenantId_name: { tenantId, name: g.name } },
      update: {},
      create: { tenantId, name: g.name, required: g.required, minSelect: g.min, maxSelect: g.max, sortOrder: (gi + 1) * 10 },
      select: { id: true },
    });
    groupIds.set(g.name, group.id);
    for (const locale of LOCALES) {
      await prisma.modifierGroupTranslation.upsert({
        where: { modifierGroupId_locale: { modifierGroupId: group.id, locale } },
        update: {},
        create: { tenantId, modifierGroupId: group.id, locale, name: g.t[locale] },
      });
    }
    for (const [mi, m] of g.modifiers.entries()) {
      const modifier = await prisma.modifier.upsert({
        where: { modifierGroupId_name: { modifierGroupId: group.id, name: m.name } },
        update: {},
        create: { tenantId, modifierGroupId: group.id, name: m.name, priceDeltaMinor: m.price, sortOrder: (mi + 1) * 10 },
        select: { id: true },
      });
      for (const locale of LOCALES) {
        await prisma.modifierTranslation.upsert({
          where: { modifierId_locale: { modifierId: modifier.id, locale } },
          update: {},
          create: { tenantId, modifierId: modifier.id, locale, name: m.t[locale] },
        });
      }
    }
  }

  const [allergens, tags] = await Promise.all([
    prisma.allergen.findMany({ where: { tenantId: null }, select: { id: true, code: true } }),
    prisma.dietaryTag.findMany({ where: { tenantId: null }, select: { id: true, code: true } }),
  ]);
  const allergenId = new Map(allergens.map((a) => [a.code, a.id]));
  const tagId = new Map(tags.map((t) => [t.code, t.id]));

  // Ürünler
  const productIds = new Map<string, { id: string; variants: Map<string, string> }>();
  for (const [pi, p] of PRODUCTS.entries()) {
    const existing = await prisma.product.findUnique({ where: { tenantId_slug: { tenantId, slug: p.slug } }, select: { id: true } });
    const product =
      existing ??
      (await prisma.product.create({
        data: {
          tenantId,
          slug: p.slug,
          name: p.name,
          categoryId: categoryIds.get(p.category)!,
          basePriceMinor: p.price,
          currency: "TRY",
          shortDescription: p.short,
          preparationMinutes: p.prep ?? null,
          calories: p.calories ?? null,
          featured: p.featured ?? false,
          allergensConfirmedAt: new Date(),
          sortOrder: (pi + 1) * 10,
        },
        select: { id: true },
      }));
    const variants = new Map<string, string>();
    if (!existing) {
      for (const locale of LOCALES) {
        const [name, short] = p.t[locale];
        await prisma.productTranslation.create({ data: { tenantId, productId: product.id, locale, name, shortDescription: short } });
      }
      await prisma.productIngredient.createMany({
        data: p.ingredients.map((name, i) => ({ tenantId, productId: product.id, ingredientId: ingredientIds.get(name)!, sortOrder: (i + 1) * 10 })),
        skipDuplicates: true,
      });
      await prisma.productAllergen.createMany({ data: p.allergens.map((code) => ({ tenantId, productId: product.id, allergenId: allergenId.get(code)! })), skipDuplicates: true });
      await prisma.productDietaryTag.createMany({ data: p.tags.map((code) => ({ tenantId, productId: product.id, dietaryTagId: tagId.get(code)! })), skipDuplicates: true });
      for (const [gi, name] of (p.groups ?? []).entries()) {
        await prisma.productModifierGroup.create({ data: { tenantId, productId: product.id, modifierGroupId: groupIds.get(name)!, sortOrder: (gi + 1) * 10 } });
      }
      for (const [vi, v] of (p.variants ?? []).entries()) {
        const variant = await prisma.productVariant.create({
          data: { tenantId, productId: product.id, name: v.name, priceMinor: v.price, isDefault: v.isDefault ?? false, sortOrder: (vi + 1) * 10 },
          select: { id: true },
        });
        variants.set(v.name, variant.id);
        await prisma.productVariantTranslation.createMany({ data: LOCALES.map((locale) => ({ tenantId, variantId: variant.id, locale, name: v.t[locale] })) });
      }
    } else {
      for (const v of await prisma.productVariant.findMany({ where: { productId: product.id }, select: { id: true, name: true } })) variants.set(v.name, v.id);
    }
    productIds.set(p.slug, { id: product.id, variants });
  }

  // İkinci şube + şubeye özel fiyat/tükendi örneği
  const kadikoy = await prisma.branch.upsert({
    where: { tenantId_slug: { tenantId, slug: "kadikoy" } },
    update: {},
    create: { tenantId, slug: "kadikoy", name: "Kadıköy Şube", city: "İstanbul", district: "Kadıköy", country: "TR", timezone: "Europe/Istanbul", currency: "TRY", locale: "tr" },
    select: { id: true },
  });
  const ayran = productIds.get("ayran")!;
  await prisma.branchProduct.upsert({
    where: { branchId_productId: { branchId: kadikoy.id, productId: ayran.id } },
    update: {},
    create: { tenantId, branchId: kadikoy.id, productId: ayran.id, priceMinor: 5000 },
  });
  const buyuk = ayran.variants.get("Büyük");
  if (buyuk) {
    await prisma.branchVariantPrice.upsert({
      where: { branchId_variantId: { branchId: kadikoy.id, variantId: buyuk } },
      update: {},
      create: { tenantId, branchId: kadikoy.id, variantId: buyuk, priceMinor: 7000 },
    });
  }
  const kahve = productIds.get("turk-kahvesi")!;
  await prisma.branchProduct.upsert({
    where: { branchId_productId: { branchId: kadikoy.id, productId: kahve.id } },
    update: {},
    create: { tenantId, branchId: kadikoy.id, productId: kahve.id, soldOut: true },
  });

  return { products: productIds.size };
}

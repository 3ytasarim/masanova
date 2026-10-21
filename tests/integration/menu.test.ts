import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createTenantScope } from "@/lib/tenant/scope";
import {
  branchOverrideSchema,
  categorySchema,
  modifierGroupSchema,
  modifierSchema,
  productContentSchema,
  productCreateSchema,
  productGeneralSchema,
  variantSchema,
} from "@/lib/validation/menu";
import { saveBranchOverride } from "@/server/services/menu/branch-override.service";
import { createCategory, moveCategory, setCategoryFlag, updateCategory } from "@/server/services/menu/category.service";
import { createLibraryItem, updateLibraryItem } from "@/server/services/menu/library.service";
import type { MenuActor } from "@/server/services/menu/menu-common";
import { attachModifierGroup, createModifier, createModifierGroup, updateModifierGroup } from "@/server/services/menu/modifier.service";
import {
  bulkUpdateProducts,
  createProduct,
  moveProduct,
  replaceProductContentTx,
  saveProductTranslations,
  setProductArchived,
  setProductFlag,
  updateProductContent,
  updateProductGeneral,
} from "@/server/services/menu/product.service";
import { getPublishedMenu } from "@/server/services/menu/public-menu.service";
import { archiveVariant, createVariant, updateVariant } from "@/server/services/menu/variant.service";

/**
 * Menü — gerçek PostgreSQL (Neon). İki geçici kiracı (A, B) oluşturulur ve sonunda silinir.
 * Zorunlu IDOR senaryoları: A kiracısı B'nin kategori/ürün/varyant/grup/malzeme/alerjen/şube/çeviri/sıralama
 * kayıtlarına hiçbir yoldan dokunamaz.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };

type Fixture = { tenantId: string; branchId: string; actor: MenuActor };
let A: Fixture;
let B: Fixture;

async function makeTenant(label: string): Promise<Fixture> {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Menü ${label} ${run}`,
      slug: `menu-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr", defaultCurrency: "TRY" } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }] },
      users: { create: { email: `menu-${label}-${run}@masanovai.test`, firstName: "M", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, branches: { select: { id: true } }, users: { select: { id: true } } },
  });
  return { tenantId: tenant.id, branchId: tenant.branches[0]!.id, actor: { userId: tenant.users[0]!.id, scope: createTenantScope(tenant.id), meta } };
}

const cat = (name: string, slug: string, extra: Record<string, unknown> = {}) => categorySchema.parse({ name, slug, active: true, featured: false, ...extra });
const createdId = (r: { ok: boolean; data?: unknown }) => {
  if (!r.ok) throw new Error(`beklenmeyen hata: ${JSON.stringify(r)}`);
  return (r.data as { id: string }).id;
};

let catA = "";
let catB = "";
let productA = "";
let productB = "";

beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
  catA = createdId(await createCategory(A.actor, cat("Burgerler", "burgerler")));
  catB = createdId(await createCategory(B.actor, cat("Burgerler", "burgerler")));
  productA = createdId(await createProduct(A.actor, productCreateSchema.parse({ name: "Cheeseburger", slug: "cheeseburger", categoryId: catA, basePrice: "380" })));
  productB = createdId(await createProduct(B.actor, productCreateSchema.parse({ name: "Cheeseburger", slug: "cheeseburger", categoryId: catB, basePrice: "400" })));
});

afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("kategori", () => {
  it("aynı kısa ad farklı kiracılarda serbest, aynı kiracıda yasak", async () => {
    expect(catA).toBeTruthy();
    expect(catB).toBeTruthy();
    await expect(createCategory(A.actor, cat("Burger 2", "burgerler"))).resolves.toMatchObject({ ok: false, fieldErrors: { slug: expect.any(String) } });
  });

  it("tek seviye: alt kategori oluşur; ikinci seviye ve başka kiracının üst kategorisi reddedilir", async () => {
    const child = createdId(await createCategory(A.actor, cat("Smash", "smash", { parentId: catA })));
    await expect(createCategory(A.actor, cat("Torun", "torun", { parentId: child }))).resolves.toMatchObject({ ok: false });
    await expect(createCategory(A.actor, cat("Yabancı", "yabanci", { parentId: catB }))).resolves.toMatchObject({ ok: false });
    await expect(updateCategory(A.actor, catA, cat("Burgerler", "burgerler", { parentId: catA }))).resolves.toMatchObject({ ok: false });
  });

  it("IDOR: A, B'nin kategorisini düzenleyemez / sıralayamaz / pasifleştiremez", async () => {
    await expect(updateCategory(A.actor, catB, cat("Ele geçirildi", "x1"))).resolves.toMatchObject({ ok: false });
    await expect(setCategoryFlag(A.actor, catB, "active", false)).resolves.toMatchObject({ ok: false });
    await expect(moveCategory(A.actor, catB, "up")).resolves.toMatchObject({ ok: false });
    await expect(prisma.menuCategory.findUniqueOrThrow({ where: { id: catB } })).resolves.toMatchObject({ name: "Burgerler", active: true });
  });

  it("güncelleme, çeviri ve sıralama", async () => {
    const drinks = createdId(await createCategory(A.actor, cat("İçecekler", "icecekler")));
    await expect(updateCategory(A.actor, drinks, cat("İçecekler", "icecekler", { translations: { en: { name: "Drinks" }, ar: { name: "المشروبات" } } }))).resolves.toMatchObject({ ok: true });
    const tr = await prisma.menuCategoryTranslation.findMany({ where: { categoryId: drinks }, orderBy: { locale: "asc" } });
    expect(tr.map((t) => [t.locale, t.name])).toEqual([
      ["ar", "المشروبات"],
      ["en", "Drinks"],
    ]);
    await moveCategory(A.actor, drinks, "up");
    const roots = await prisma.menuCategory.findMany({ where: { tenantId: A.tenantId, parentId: null }, orderBy: { sortOrder: "asc" }, select: { id: true } });
    expect(roots[0]!.id).toBe(drinks);
  });
});

describe("ürün", () => {
  it("aynı kısa ad farklı kiracılarda serbest; kategori başka kiracının olamaz", async () => {
    expect(productA).toBeTruthy();
    expect(productB).toBeTruthy();
    await expect(createProduct(A.actor, productCreateSchema.parse({ name: "X", slug: "x-urun", categoryId: catB, basePrice: "10" }))).resolves.toMatchObject({ ok: false });
  });

  it("genel bilgiler + durum değişikliği denetlenir", async () => {
    const input = productGeneralSchema.parse({ name: "Cheeseburger", slug: "cheeseburger", categoryId: catA, shortDescription: "Klasik", featured: true, active: true, soldOut: true });
    await expect(updateProductGeneral(A.actor, productA, input)).resolves.toMatchObject({ ok: true });
    const audits = await prisma.auditLog.findMany({ where: { tenantId: A.tenantId, entityId: productA }, select: { action: true } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["PRODUCT_CREATED", "PRODUCT_UPDATED", "PRODUCT_SOLD_OUT_CHANGED"]));
    await setProductFlag(A.actor, productA, "soldOut", false);
  });

  it("IDOR: A, B'nin ürününü düzenleyemez / taşıyamaz / işaretleyemez / çevirisini değiştiremez / arşivleyemez", async () => {
    const input = productGeneralSchema.parse({ name: "Ele geçirildi", slug: "hacked", categoryId: catA, featured: false, active: false, soldOut: false });
    await expect(updateProductGeneral(A.actor, productB, input)).resolves.toMatchObject({ ok: false });
    await expect(setProductFlag(A.actor, productB, "active", false)).resolves.toMatchObject({ ok: false });
    await expect(moveProduct(A.actor, productB, "up")).resolves.toMatchObject({ ok: false });
    await expect(saveProductTranslations(A.actor, productB, { en: { name: "Hacked", shortDescription: null, description: null } })).resolves.toMatchObject({ ok: false });
    await expect(setProductArchived(A.actor, productB, true)).resolves.toMatchObject({ ok: false });
    const bulk = await bulkUpdateProducts(A.actor, "deactivate", [productB]);
    expect(bulk).toMatchObject({ ok: true, data: { count: 0 } });
    await expect(prisma.product.findUniqueOrThrow({ where: { id: productB } })).resolves.toMatchObject({ name: "Cheeseburger", active: true, archivedAt: null });
    expect(await prisma.productTranslation.count({ where: { productId: productB } })).toBe(0);
  });

  it("arşiv: fiziksel silme yok, geri alınabilir; toplu işlem yalnız kendi ürünlerine", async () => {
    await expect(setProductArchived(A.actor, productA, true)).resolves.toMatchObject({ ok: true });
    expect(await prisma.product.count({ where: { id: productA } })).toBe(1);
    await expect(bulkUpdateProducts(A.actor, "feature", [productA])).resolves.toMatchObject({ data: { count: 0 } }); // arşivde
    await expect(setProductArchived(A.actor, productA, false)).resolves.toMatchObject({ ok: true });
    await expect(bulkUpdateProducts(A.actor, "feature", [productA, productB])).resolves.toMatchObject({ data: { count: 1 } });
  });
});

describe("varyantlar", () => {
  it("tam olarak bir varsayılan; varsayılan arşivlenince sıradaki varsayılan olur", async () => {
    const single = createdId(await createVariant(A.actor, productA, variantSchema.parse({ name: "Tek", price: "", active: true, isDefault: false })));
    const double = createdId(await createVariant(A.actor, productA, variantSchema.parse({ name: "Çift", price: "520", active: true, isDefault: true })));
    let variants = await prisma.productVariant.findMany({ where: { productId: productA, archivedAt: null } });
    expect(variants.filter((v) => v.isDefault).map((v) => v.id)).toEqual([double]);
    await archiveVariant(A.actor, productA, double);
    variants = await prisma.productVariant.findMany({ where: { productId: productA, archivedAt: null } });
    expect(variants.map((v) => [v.id, v.isDefault])).toEqual([[single, true]]);
    expect(await prisma.productVariant.count({ where: { id: double } })).toBe(1); // arşivlendi, silinmedi
    await expect(createVariant(A.actor, productA, variantSchema.parse({ name: "Tek", price: "", active: true, isDefault: false }))).resolves.toMatchObject({ ok: false });
  });

  it("IDOR: başka kiracının ürününe varyant eklenemez; başka ürünün varyantı düzenlenemez", async () => {
    const input = variantSchema.parse({ name: "Hack", price: "1", active: true, isDefault: true });
    await expect(createVariant(A.actor, productB, input)).resolves.toMatchObject({ ok: false });
    const bVariant = createdId(await createVariant(B.actor, productB, variantSchema.parse({ name: "Büyük", price: "450", active: true, isDefault: true })));
    await expect(updateVariant(A.actor, productA, bVariant, input)).resolves.toMatchObject({ ok: false });
    await expect(updateVariant(A.actor, productB, bVariant, input)).resolves.toMatchObject({ ok: false });
    await expect(prisma.productVariant.findUniqueOrThrow({ where: { id: bVariant } })).resolves.toMatchObject({ name: "Büyük", priceMinor: 45000 });
  });
});

describe("ekstralar", () => {
  it("grup kuralları, ekstralar ve ürüne bağlama", async () => {
    expect(modifierGroupSchema.safeParse({ name: "Hatalı", required: true, minSelect: "0", maxSelect: "1", active: true }).success).toBe(false);
    const group = createdId(await createModifierGroup(A.actor, modifierGroupSchema.parse({ name: "Ekstra Malzemeler", required: false, minSelect: "0", maxSelect: "3", active: true, translations: { en: { name: "Extras" } } })));
    createdId(await createModifier(A.actor, group, modifierSchema.parse({ name: "Cheddar", priceDelta: "30", active: true })));
    await expect(attachModifierGroup(A.actor, productA, group)).resolves.toMatchObject({ ok: true });
    await expect(updateModifierGroup(A.actor, group, modifierGroupSchema.parse({ name: "Ekstra Malzemeler", required: true, minSelect: "1", maxSelect: "2", active: true }))).resolves.toMatchObject({ ok: true });
  });

  it("IDOR: A, B'nin ekstra grubunu bağlayamaz / düzenleyemez / ekstra ekleyemez", async () => {
    const bGroup = createdId(await createModifierGroup(B.actor, modifierGroupSchema.parse({ name: "B Grubu", required: false, minSelect: "0", maxSelect: "1", active: true })));
    await expect(attachModifierGroup(A.actor, productA, bGroup)).resolves.toMatchObject({ ok: false });
    await expect(attachModifierGroup(A.actor, productB, bGroup)).resolves.toMatchObject({ ok: false });
    await expect(updateModifierGroup(A.actor, bGroup, modifierGroupSchema.parse({ name: "Hack", required: false, minSelect: "0", maxSelect: "1", active: false }))).resolves.toMatchObject({ ok: false });
    await expect(createModifier(A.actor, bGroup, modifierSchema.parse({ name: "Hack", priceDelta: "0", active: true }))).resolves.toMatchObject({ ok: false });
    expect(await prisma.productModifierGroup.count({ where: { modifierGroupId: bGroup } })).toBe(0);
  });

  it("veritabanı da reddeder: bileşik FK, kiracılar arası bağlantıyı doğrudan yazmaya izin vermez", async () => {
    const bGroup = await prisma.modifierGroup.findFirstOrThrow({ where: { tenantId: B.tenantId }, select: { id: true } });
    await expect(prisma.productModifierGroup.create({ data: { tenantId: A.tenantId, productId: productA, modifierGroupId: bGroup.id } })).rejects.toThrow();
    await expect(prisma.branchProduct.create({ data: { tenantId: A.tenantId, branchId: B.branchId, productId: productA, priceMinor: 1 } })).rejects.toThrow();
    await expect(prisma.product.create({ data: { tenantId: A.tenantId, categoryId: catB, name: "x", slug: `fk-${run}`, basePriceMinor: 1 } })).rejects.toThrow();
  });
});

describe("içerik: malzeme / alerjen / etiket", () => {
  it("platform alerjeni ve kendi malzemesi bağlanır; B'nin malzemesi ve özel alerjeni reddedilir", async () => {
    const milk = await prisma.allergen.findFirstOrThrow({ where: { tenantId: null, code: "milk" } });
    const halal = await prisma.dietaryTag.findFirstOrThrow({ where: { tenantId: null, code: "halal" } });
    const cheddar = createdId(await createLibraryItem(A.actor, "ingredient", { name: "Cheddar", active: true, translations: { en: { name: "Cheddar" } } }));
    const bIngredient = createdId(await createLibraryItem(B.actor, "ingredient", { name: "Gizli sos", active: true, translations: {} }));
    const bAllergen = createdId(await createLibraryItem(B.actor, "allergen", { name: "B alerjeni", active: true, translations: {} }));
    const content = (ingredientIds: string[], allergenIds: string[]) =>
      productContentSchema.parse({ ingredientIds, allergenIds, dietaryTagIds: [halal.id], allergensConfirmed: false, calories: "780" });

    await expect(updateProductContent(A.actor, productA, content([cheddar], [milk.id]))).resolves.toMatchObject({ ok: true });
    await expect(updateProductContent(A.actor, productA, content([bIngredient], [milk.id]))).resolves.toMatchObject({ ok: false });
    await expect(updateProductContent(A.actor, productA, content([cheddar], [bAllergen]))).resolves.toMatchObject({ ok: false });
    await expect(updateProductContent(A.actor, productB, content([], [milk.id]))).resolves.toMatchObject({ ok: false });
    await expect(updateLibraryItem(A.actor, "ingredient", bIngredient, { name: "Hack", active: false, translations: {} })).resolves.toMatchObject({ ok: false });
    await expect(updateLibraryItem(A.actor, "allergen", milk.id, { name: "Hack", active: false, translations: {} })).resolves.toMatchObject({ ok: false }); // platform kaydı salt okunur

    const p = await prisma.product.findUniqueOrThrow({ where: { id: productA }, include: { allergens: true, ingredients: true, dietaryTags: true } });
    expect(p.allergens.map((a) => a.allergenId)).toEqual([milk.id]);
    expect(p.ingredients.map((i) => i.ingredientId)).toEqual([cheddar]);
    expect(p.dietaryTags.map((t) => t.dietaryTagId)).toEqual([halal.id]);
    expect(p.calories).toBe(780);
    expect(p.allergensConfirmedAt).not.toBeNull();
  });

  it("geri alma: içerik değişikliği yarıda başarısız olursa önceki alerjenler korunur", async () => {
    const before = await prisma.productAllergen.findMany({ where: { productId: productA }, select: { allergenId: true } });
    expect(before.length).toBe(1);
    // Doğrulamayı atlayıp transaction'a var olmayan alerjen ver → FK ihlali → tüm transaction geri alınır.
    await expect(
      replaceProductContentTx(A.actor, productA, productContentSchema.parse({ ingredientIds: [], allergenIds: ["nonexistent_allergen"], dietaryTagIds: [], allergensConfirmed: true })),
    ).rejects.toThrow();
    const after = await prisma.productAllergen.findMany({ where: { productId: productA }, select: { allergenId: true } });
    expect(after).toEqual(before);
    expect(await prisma.productIngredient.count({ where: { productId: productA } })).toBe(1);
  });
});

describe("şube ayarları ve yayınlanmış menü", () => {
  it("IDOR: A, B'nin şubesi için geçersiz kılma oluşturamaz", async () => {
    await expect(saveBranchOverride(A.actor, productA, branchOverrideSchema.parse({ branchId: B.branchId, available: "inherit", soldOut: "yes", price: "1" }))).resolves.toMatchObject({ ok: false });
    await expect(saveBranchOverride(A.actor, productB, branchOverrideSchema.parse({ branchId: A.branchId, available: "inherit", soldOut: "yes", price: "1" }))).resolves.toMatchObject({ ok: false });
    expect(await prisma.branchProduct.count({ where: { OR: [{ branchId: B.branchId }, { productId: productB }] } })).toBe(0);
  });

  it("şube fiyatı + varyant fiyatı + tükendi; menü merkezi çözümleyicilerle döner", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: productA, archivedAt: null } });
    await expect(
      saveBranchOverride(A.actor, productA, branchOverrideSchema.parse({ branchId: A.branchId, available: "inherit", soldOut: "inherit", price: "350", variantPrices: { [variant.id]: "360" } })),
    ).resolves.toMatchObject({ ok: true });
    await saveProductTranslations(A.actor, productA, { de: { name: "Käseburger", shortDescription: null, description: null } });

    const menu = await getPublishedMenu(A.actor.scope, { branchId: A.branchId, locale: "de" });
    const burger = menu.categories.flatMap((c) => [...c.products, ...c.children.flatMap((ch) => ch.products)]).find((p) => p.id === productA)!;
    expect(burger.name).toBe("Käseburger");
    expect(burger.shortDescription).toBe("Klasik"); // Almanca kısa açıklama yok → varsayılan dil
    expect(burger.variants[0]!.priceMinor).toBe(36000); // şube varyant fiyatı
    expect(burger.allergens.map((a) => [a.code, a.name])).toEqual([["milk", "Milch"]]);
    expect(burger.dietaryTags.map((t) => t.name)).toEqual(["Halal"]);
    expect(burger.modifierGroups[0]?.name).toBe("Ekstra Malzemeler"); // de çevirisi yok → varsayılan
    expect(burger.declaredByRestaurant).toBe(true);
    expect(burger).not.toHaveProperty("sku");
    expect(burger).not.toHaveProperty("tenantId");

    const ar = await getPublishedMenu(A.actor.scope, { branchId: null, locale: "ar" });
    expect(ar.direction).toBe("rtl");

    await saveBranchOverride(A.actor, productA, branchOverrideSchema.parse({ branchId: A.branchId, available: "inherit", soldOut: "yes", price: "" }));
    const soldOut = await getPublishedMenu(A.actor.scope, { branchId: A.branchId, locale: "tr" });
    const p2 = soldOut.categories.flatMap((c) => c.products).find((p) => p.id === productA)!;
    expect(p2.availability).toBe("sold_out");

    await saveBranchOverride(A.actor, productA, branchOverrideSchema.parse({ branchId: A.branchId, available: "no", soldOut: "inherit", price: "" }));
    const hidden = await getPublishedMenu(A.actor.scope, { branchId: A.branchId, locale: "tr" });
    expect(hidden.categories.flatMap((c) => c.products).some((p) => p.id === productA)).toBe(false);

    // B'nin menüsü A'nın verisini içermez
    const bMenu = await getPublishedMenu(B.actor.scope, { branchId: B.branchId, locale: "tr" });
    expect(JSON.stringify(bMenu)).not.toContain(productA);
    await expect(getPublishedMenu(B.actor.scope, { branchId: A.branchId, locale: "tr" })).rejects.toThrow();
  });

  it("arşivlenmiş / pasif ürün yayınlanmış menüde görünmez", async () => {
    await setProductFlag(B.actor, productB, "active", false);
    const menu = await getPublishedMenu(B.actor.scope, { branchId: null, locale: "tr" });
    expect(menu.categories.flatMap((c) => c.products).some((p) => p.id === productB)).toBe(false);
  });
});

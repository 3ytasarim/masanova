import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { MEDIA_ASSET_SELECT } from "@/server/media/urls";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * Menü okuma sorguları (panel). Liste görünümleri yalnızca tablonun ihtiyacı olan alanları seçer;
 * ürün editörü zengin veriyi tek seferde yükler. Hepsi kiracı kapsamlıdır.
 */

// ─── Gösterge paneli ────────────────────────────────────────────────────────

export async function getMenuOverview(scope: TenantScope, translatableLocales: readonly string[]) {
  const tenantId = scope.tenantId;
  const live = { tenantId, archivedAt: null };
  const [categories, products, active, soldOut, missingImages, missingTranslations, recent] = await Promise.all([
    prisma.menuCategory.count({ where: { tenantId } }),
    prisma.product.count({ where: live }),
    prisma.product.count({ where: { ...live, active: true } }),
    prisma.product.count({ where: { ...live, soldOut: true } }),
    prisma.product.count({ where: { ...live, images: { none: {} } } }),
    translatableLocales.length
      ? prisma.product.count({ where: { ...live, OR: translatableLocales.map((locale) => ({ translations: { none: { locale } } })) } })
      : Promise.resolve(0),
    prisma.product.findMany({
      where: live,
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, name: true, updatedAt: true, active: true, soldOut: true, category: { select: { name: true } } },
    }),
  ]);
  return { categories, products, active, soldOut, missingImages, missingTranslations, recent };
}

// ─── Kategoriler ────────────────────────────────────────────────────────────

export function listCategoryTree(scope: TenantScope) {
  return prisma.menuCategory.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      parentId: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      imageAsset: { select: MEDIA_ASSET_SELECT },
      active: true,
      featured: true,
      translations: { select: { locale: true, name: true, description: true } },
      _count: { select: { products: { where: { archivedAt: null } } } },
    },
  });
}
export type CategoryTreeRow = Awaited<ReturnType<typeof listCategoryTree>>[number];

export function listCategoryOptions(scope: TenantScope) {
  return prisma.menuCategory.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, parentId: true, active: true },
  });
}

// ─── Ürün listesi ───────────────────────────────────────────────────────────

export const PRODUCT_SORTS = ["menu", "name", "price_asc", "price_desc", "updated"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export type ProductListQuery = {
  q?: string;
  categoryId?: string;
  status?: "active" | "inactive" | "archived";
  soldOut?: boolean;
  featured?: boolean;
  /** Eksik içerik filtresi (gösterge panelindeki kartlardan). */
  missing?: { image?: boolean; translationLocales?: readonly string[] };
  sort: ProductSort;
  page: number;
  pageSize: number;
};

const PRODUCT_ORDER: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  menu: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
  name: [{ name: "asc" }],
  price_asc: [{ basePriceMinor: "asc" }],
  price_desc: [{ basePriceMinor: "desc" }],
  updated: [{ updatedAt: "desc" }],
};

export async function listProductsPage(scope: TenantScope, query: ProductListQuery) {
  const q = query.q?.trim();
  const where: Prisma.ProductWhereInput = {
    tenantId: scope.tenantId,
    archivedAt: query.status === "archived" ? { not: null } : null,
    ...(query.status === "active" ? { active: true } : query.status === "inactive" ? { active: false } : {}),
    ...(query.categoryId ? { OR: [{ categoryId: query.categoryId }, { category: { parentId: query.categoryId } }] } : {}),
    ...(query.soldOut !== undefined ? { soldOut: query.soldOut } : {}),
    ...(query.featured !== undefined ? { featured: query.featured } : {}),
    ...(query.missing?.image ? { images: { none: {} } } : {}),
    ...(query.missing?.translationLocales?.length
      ? { NOT: { AND: query.missing.translationLocales.map((locale) => ({ translations: { some: { locale } } })) } }
      : {}),
    ...(q
      ? {
          AND: [
            {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { slug: { contains: q.toLowerCase() } },
                { sku: { contains: q, mode: "insensitive" } },
                { translations: { some: { name: { contains: q, mode: "insensitive" } } } },
              ],
            },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [...PRODUCT_ORDER[query.sort], { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        basePriceMinor: true,
        currency: true,
        active: true,
        soldOut: true,
        featured: true,
        archivedAt: true,
        updatedAt: true,
        shortDescription: true,
        description: true,
        allergensConfirmedAt: true,
        category: { select: { id: true, name: true } },
        images: { where: { isPrimary: true }, select: { storageProvider: true, storageKey: true, altText: true, mediaAsset: { select: MEDIA_ASSET_SELECT } }, take: 1 },
        translations: { select: { locale: true, name: true } },
        variants: { where: { archivedAt: null, active: true }, select: { priceMinor: true } },
        _count: { select: { images: true, allergens: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);
  return { items, total };
}
export type ProductListItem = Awaited<ReturnType<typeof listProductsPage>>["items"][number];

// ─── Ürün editörü ───────────────────────────────────────────────────────────

export function getProductEditor(scope: TenantScope, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, tenantId: scope.tenantId },
    include: {
      category: { select: { id: true, name: true, active: true } },
      translations: { select: { locale: true, name: true, shortDescription: true, description: true } },
      images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { mediaAsset: { select: MEDIA_ASSET_SELECT } } },
      variants: {
        where: { archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { translations: { select: { locale: true, name: true } } },
      },
      modifierGroups: {
        orderBy: { sortOrder: "asc" },
        include: { group: { select: { id: true, name: true, required: true, minSelect: true, maxSelect: true, active: true, archivedAt: true, _count: { select: { modifiers: { where: { archivedAt: null } } } } } } },
      },
      ingredients: { select: { ingredientId: true } },
      allergens: { select: { allergenId: true } },
      dietaryTags: { select: { dietaryTagId: true } },
      branchOverrides: { select: { branchId: true, available: true, soldOut: true, priceMinor: true } },
    },
  });
}
export type ProductEditorData = NonNullable<Awaited<ReturnType<typeof getProductEditor>>>;

export function listBranchVariantPrices(scope: TenantScope, productId: string) {
  return prisma.branchVariantPrice.findMany({
    where: { tenantId: scope.tenantId, variant: { productId } },
    select: { branchId: true, variantId: true, priceMinor: true },
  });
}

// ─── Ekstralar ──────────────────────────────────────────────────────────────

export function listModifierGroups(scope: TenantScope, options: { includeArchived?: boolean } = {}) {
  return prisma.modifierGroup.findMany({
    where: { tenantId: scope.tenantId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      translations: { select: { locale: true, name: true } },
      modifiers: {
        where: { archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { translations: { select: { locale: true, name: true } } },
      },
      _count: { select: { products: true } },
    },
  });
}
export type ModifierGroupRow = Awaited<ReturnType<typeof listModifierGroups>>[number];

// ─── Kütüphane ──────────────────────────────────────────────────────────────

export async function getMenuLibrary(scope: TenantScope) {
  const tenantId = scope.tenantId;
  const ownOrSystem = { OR: [{ tenantId: null }, { tenantId }] };
  const [ingredients, allergens, dietaryTags] = await Promise.all([
    prisma.ingredient.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      include: { translations: { select: { locale: true, name: true } }, _count: { select: { products: true } } },
    }),
    prisma.allergen.findMany({
      where: ownOrSystem,
      orderBy: [{ tenantId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      include: { translations: { select: { locale: true, name: true } }, _count: { select: { products: { where: { tenantId } } } } },
    }),
    prisma.dietaryTag.findMany({
      where: ownOrSystem,
      orderBy: [{ tenantId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      include: { translations: { select: { locale: true, name: true } }, _count: { select: { products: { where: { tenantId } } } } },
    }),
  ]);
  return { ingredients, allergens, dietaryTags };
}
export type MenuLibrary = Awaited<ReturnType<typeof getMenuLibrary>>;

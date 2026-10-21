import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveAvailability } from "@/lib/menu/availability";
import { resolveProductPrice } from "@/lib/menu/pricing";
import { pickTranslated } from "@/lib/menu/translation";
import type { CatalogProduct } from "@/lib/orders/calculate";
import { createMenuRefs } from "@/server/services/orders/menu-refs";

/**
 * Sipariş kataloğu — YETKİLİ veri. Sepet doğrulaması ve gönderim YALNIZCA bunu kullanır; public menü önbelleği
 * (Sprint 5) burada kullanılmaz. Ürünler kiracı + şube kapsamında, yalnızca istenen kısa adlarla okunur.
 * Kullanılabilirlik ve fiyat merkezi çözümleyicilerden gelir (menüyle birebir aynı kurallar).
 */
type Db = PrismaClient | Prisma.TransactionClient;

export async function loadOrderCatalog(
  db: Db,
  input: { tenantId: string; branch: { id: string; active: boolean }; productKeys: readonly string[]; locale: string; defaultLocale: string },
): Promise<Map<string, CatalogProduct>> {
  const { tenantId, branch, locale, defaultLocale } = input;
  const keys = [...new Set(input.productKeys)].slice(0, 60);
  const out = new Map<string, CatalogProduct>();
  if (!keys.length) return out;
  const ref = createMenuRefs(tenantId);
  const tr = { where: { locale: { in: [locale, defaultLocale] } } };

  const [products, branchPrices] = await Promise.all([
    db.product.findMany({
      where: { tenantId, slug: { in: keys } },
      include: {
        category: { select: { active: true, parent: { select: { active: true } } } },
        translations: tr,
        variants: { where: { archivedAt: null, active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { translations: tr } },
        modifierGroups: {
          orderBy: { sortOrder: "asc" },
          where: { group: { active: true, archivedAt: null } },
          include: { group: { include: { translations: tr, modifiers: { where: { active: true, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { translations: tr } } } } },
        },
        branchOverrides: { where: { branchId: branch.id } },
      },
    }),
    db.branchVariantPrice.findMany({ where: { tenantId, branchId: branch.id }, select: { variantId: true, priceMinor: true } }),
  ]);
  const branchVariant = new Map(branchPrices.map((p) => [p.variantId, p.priceMinor]));

  for (const product of products) {
    const branchProduct = product.branchOverrides[0] ?? null;
    const availability = resolveAvailability({ product, category: product.category, branch, branchProduct });
    const name = pickTranslated({ name: product.name }, product.translations, locale, defaultLocale).values.name;
    out.set(product.slug, {
      key: product.slug,
      id: product.id,
      name,
      nameDefault: product.name,
      currency: product.currency,
      availability: availability.status,
      basePriceMinor: resolveProductPrice({ product, branchProduct }).amountMinor,
      variants: product.variants.map((v) => ({
        ref: ref(v.id),
        id: v.id,
        // Kopya: işletmenin varsayılan dilindeki ad (personel/mutfak için); müşteri dilindeki ürün adı ayrıca tutulur.
        name: v.name,
        priceMinor: resolveProductPrice({ product, branchProduct, variant: v, branchVariant: branchVariant.has(v.id) ? { priceMinor: branchVariant.get(v.id)! } : null }).amountMinor,
        isDefault: v.isDefault,
      })),
      groups: product.modifierGroups.map(({ group }) => ({
        ref: ref(group.id),
        id: group.id,
        name: group.name,
        required: group.required,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        modifiers: group.modifiers.map((m) => ({ ref: ref(m.id), id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
      })),
    });
  }
  return out;
}

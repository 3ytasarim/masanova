import { Package, Plus } from "lucide-react";
import Link from "next/link";
import { productCompleteness } from "@/lib/menu/completeness";
import { formatMoney } from "@/lib/menu/money";
import { resolveProductImage } from "@/server/media/urls";
import { formatDateTime } from "@/lib/utils/format";
import { enumParam, pageParam, param, type RawSearchParams } from "@/lib/utils/search-params";
import { PRODUCT_SORTS, listCategoryOptions, listProductsPage, type ProductSort } from "@/server/repositories/menu.repository";
import { getMenuPageContext } from "@/server/menu-page-context";
import { FilterBar, FilterSelect } from "@/components/dashboard/filter-bar";
import { ProductTable } from "@/components/menu/product-table";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";

export const metadata = { title: "Ürünler" };

const PAGE_SIZE = 25;
const SORT_LABELS: Record<ProductSort, string> = {
  menu: "Menü sırası",
  name: "Ad (A→Z)",
  price_asc: "Fiyat (artan)",
  price_desc: "Fiyat (azalan)",
  updated: "Son güncellenen",
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { scope, canManage, locales } = await getMenuPageContext();
  const params = await searchParams;
  const q = param(params, "q", 120);
  const categories = await listCategoryOptions(scope);
  const categoryParam = param(params, "kategori", 40);
  const categoryId = categories.some((c) => c.id === categoryParam) ? categoryParam : undefined;
  const status = enumParam(params, "durum", ["active", "inactive", "archived"] as const);
  const soldOutParam = enumParam(params, "tukendi", ["evet", "hayir"] as const);
  const featuredParam = enumParam(params, "onecikan", ["evet", "hayir"] as const);
  const missing = enumParam(params, "eksik", ["gorsel", "ceviri"] as const);
  const sort = enumParam(params, "sirala", PRODUCT_SORTS) ?? "menu";
  const page = pageParam(params);

  const { items, total } = await listProductsPage(scope, {
    q,
    categoryId,
    status,
    soldOut: soldOutParam ? soldOutParam === "evet" : undefined,
    featured: featuredParam ? featuredParam === "evet" : undefined,
    missing: { image: missing === "gorsel", translationLocales: missing === "ceviri" ? locales.translatable : undefined },
    sort,
    page,
    pageSize: PAGE_SIZE,
  });
  const hasFilters = !!(q || categoryId || status || soldOutParam || featuredParam || missing || sort !== "menu");
  const roots = categories.filter((c) => c.parentId === null);
  const categoryOptions = roots.flatMap((r) => [
    { value: r.id, label: r.name },
    ...categories.filter((c) => c.parentId === r.id).map((c) => ({ value: c.id, label: `— ${c.name}` })),
  ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Ürünler</h2>
        {canManage ? (
          <Link href="/panel/menu/urunler/yeni" className={buttonVariants({ size: "sm" })}>
            <Plus aria-hidden="true" /> Yeni Ürün
          </Link>
        ) : null}
      </div>
      <FilterBar action="/panel/menu/urunler" query={q} searchPlaceholder="Ürün adı, kısa ad, SKU veya çeviri" searchLabel="Ürün ara" hasFilters={hasFilters}>
        <FilterSelect id="p-kategori" name="kategori" label="Kategori" value={categoryId} options={[{ value: "", label: "Tümü" }, ...categoryOptions]} />
        <FilterSelect
          id="p-durum"
          name="durum"
          label="Durum"
          value={status}
          options={[
            { value: "", label: "Tümü (arşiv hariç)" },
            { value: "active", label: "Aktif" },
            { value: "inactive", label: "Pasif" },
            { value: "archived", label: "Arşiv" },
          ]}
        />
        <FilterSelect id="p-tukendi" name="tukendi" label="Tükendi" value={soldOutParam} options={[{ value: "", label: "Tümü" }, { value: "evet", label: "Tükendi" }, { value: "hayir", label: "Satışta" }]} />
        <FilterSelect id="p-onecikan" name="onecikan" label="Öne çıkan" value={featuredParam} options={[{ value: "", label: "Tümü" }, { value: "evet", label: "Evet" }, { value: "hayir", label: "Hayır" }]} />
        <FilterSelect id="p-eksik" name="eksik" label="Eksik içerik" value={missing} options={[{ value: "", label: "—" }, { value: "gorsel", label: "Görsel yok" }, { value: "ceviri", label: "Çeviri eksik" }]} />
        <FilterSelect id="p-sirala" name="sirala" label="Sıralama" value={sort} options={PRODUCT_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }))} />
      </FilterBar>

      {items.length === 0 ? (
        <EmptyState
          icon={Package}
          title={hasFilters ? "Eşleşen ürün yok" : "Henüz ürün yok"}
          description={hasFilters ? "Arama ya da filtreleri değiştirin." : "İlk ürününüzü ekleyin."}
          action={!hasFilters && canManage ? <Link href="/panel/menu/urunler/yeni" className={buttonVariants({ size: "sm" })}>Yeni Ürün</Link> : undefined}
        />
      ) : (
        <>
          {sort === "menu" && !categoryId && canManage ? (
            <p className="mb-2 text-xs text-fg-subtle">Menü sırasını değiştirmek için bir kategori seçin; yukarı/aşağı okları görünür.</p>
          ) : null}
          <ProductTable
            canManage={canManage}
            manualOrder={sort === "menu" && !!categoryId && status !== "archived"}
            rows={items.map((p) => {
              const image = p.images[0];
              return {
                id: p.id,
                name: p.name,
                slug: p.slug,
                categoryName: p.category.name,
                priceLabel: formatMoney(p.basePriceMinor, p.currency),
                active: p.active,
                soldOut: p.soldOut,
                featured: p.featured,
                archived: p.archivedAt !== null,
                updatedLabel: formatDateTime(p.updatedAt),
                imageUrl: image ? (resolveProductImage(image)?.url ?? null) : null,
                imageAlt: image?.altText ?? null,
                issues: productCompleteness({
                  basePriceMinor: p.basePriceMinor,
                  shortDescription: p.shortDescription,
                  description: p.description,
                  imageCount: p._count.images,
                  variantPrices: p.variants.map((v) => v.priceMinor),
                  allergensConfirmedAt: p.allergensConfirmedAt,
                  allergenCount: p._count.allergens,
                  translations: p.translations,
                  translatableLocales: locales.translatable,
                }).issues.map((i) => i.label),
              };
            })}
          />
          <Pagination
            basePath="/panel/menu/urunler"
            query={{ q, kategori: categoryId, durum: status, tukendi: soldOutParam, onecikan: featuredParam, eksik: missing, sirala: sort === "menu" ? undefined : sort }}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </>
  );
}

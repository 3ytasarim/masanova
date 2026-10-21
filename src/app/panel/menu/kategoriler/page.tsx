import { isTranslationMissing } from "@/lib/menu/translation";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { listCategoryTree } from "@/server/repositories/menu.repository";
import { resolveImage } from "@/server/media/urls";
import { getMenuPageContext } from "@/server/menu-page-context";
import { CategoryManager } from "@/components/menu/category-manager";
import { toTranslationValues } from "@/components/menu/translation-fields";

export const metadata = { title: "Kategoriler" };

export default async function MenuCategoriesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { scope, canManage, locales } = await getMenuPageContext();
  const [rows, params] = await Promise.all([listCategoryTree(scope), searchParams]);

  return (
    <CategoryManager
      canManage={canManage}
      openCreate={param(params, "yeni", 2) === "1"}
      translatableLocales={locales.translatable}
      categories={rows.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageUrl: c.imageUrl,
        imageDisplayUrl: resolveImage(c.imageAsset, c.imageUrl)?.url ?? null,
        imageManaged: !!c.imageAsset,
        active: c.active,
        featured: c.featured,
        productCount: c._count.products,
        translations: toTranslationValues(c.translations),
        missingTranslations: locales.translatable.filter((l) => isTranslationMissing(c.translations, l)),
      }))}
    />
  );
}

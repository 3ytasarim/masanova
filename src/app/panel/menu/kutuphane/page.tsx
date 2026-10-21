import { isTranslationMissing, translatedName } from "@/lib/menu/translation";
import { getMenuLibrary } from "@/server/repositories/menu.repository";
import { getMenuPageContext } from "@/server/menu-page-context";
import { LibraryManager, type LibraryItemView } from "@/components/menu/library-manager";
import { toTranslationValues } from "@/components/menu/translation-fields";

export const metadata = { title: "Malzeme & Alerjen" };

export default async function MenuLibraryPage() {
  const { scope, canManage, locales } = await getMenuPageContext();
  const library = await getMenuLibrary(scope);
  const { defaultLocale, translatable } = locales;

  const view = (row: { id: string; name: string; active: boolean; tenantId?: string | null; translations: { locale: string; name: string }[]; _count: { products: number } }): LibraryItemView => {
    const system = "tenantId" in row && row.tenantId === null;
    // Platform kayıtlarının tüm dillerde çevirisi vardır; varsayılan dil adı çeviri tablosundan okunur.
    return {
      id: row.id,
      name: row.name,
      displayName: translatedName(row.name, row.translations, defaultLocale, defaultLocale),
      active: row.active,
      system,
      usage: row._count.products,
      translations: toTranslationValues(row.translations),
      missingLocales: system ? [] : translatable.filter((l) => isTranslationMissing(row.translations, l)),
    };
  };

  return (
    <LibraryManager
      canManage={canManage}
      locales={translatable}
      data={{
        ingredient: library.ingredients.map(view),
        allergen: library.allergens.map(view),
        dietaryTag: library.dietaryTags.map(view),
      }}
    />
  );
}

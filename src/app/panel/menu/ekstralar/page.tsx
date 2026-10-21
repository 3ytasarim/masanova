import { formatMoney, minorToInput } from "@/lib/menu/money";
import { listModifierGroups } from "@/server/repositories/menu.repository";
import { getMenuPageContext } from "@/server/menu-page-context";
import { ModifierManager } from "@/components/menu/modifier-manager";
import { toTranslationValues } from "@/components/menu/translation-fields";

export const metadata = { title: "Ekstralar" };

export default async function ModifiersPage() {
  const { scope, canManage, locales } = await getMenuPageContext();
  const groups = await listModifierGroups(scope);
  return (
    <ModifierManager
      canManage={canManage}
      locales={locales.translatable}
      groups={groups.map((g) => ({
        id: g.id,
        name: g.name,
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        active: g.active,
        productCount: g._count.products,
        translations: toTranslationValues(g.translations),
        modifiers: g.modifiers.map((m) => ({
          id: m.id,
          name: m.name,
          priceDelta: minorToInput(m.priceDeltaMinor),
          priceLabel: m.priceDeltaMinor === 0 ? "Ücretsiz" : `+${formatMoney(m.priceDeltaMinor, locales.currency)}`,
          active: m.active,
          translations: toTranslationValues(m.translations),
        })),
      }))}
    />
  );
}

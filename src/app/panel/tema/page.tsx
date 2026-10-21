import type { Metadata } from "next";
import { Eye } from "lucide-react";
import { requireTenantUser } from "@/lib/auth/guards";
import { listBranches } from "@/server/repositories/branch.repository";
import { getPublishedMenu } from "@/server/services/menu/public-menu.service";
import { loadPublicPresentation } from "@/server/services/public-menu/public-menu-cache";
import { createMenuRefs } from "@/server/services/orders/menu-refs";
import { toPublicMenuView } from "@/server/services/public-menu/serialize";
import { ThemeEditor } from "@/components/public-theme/theme-editor";

export const metadata: Metadata = { title: "Tema & Tasarım" };

/**
 * QR menü görünümü düzenleyicisi + canlı telefon önizlemesi.
 * Önizleme GERÇEK yayınlanmış menüyü (kiracının kendi kapsamından, ilk aktif şube) gösterir ama masa bağlamı
 * UYDURMAZ: masa rozeti yerine açıkça "Önizleme" yazar. Gerçek masa deneyimi için masa sayfasındaki QR açılır.
 * Super Admin destek modunda yalnızca görüntülenir (kaydetme sunucuda ayrıca reddedilir).
 */
export default async function ThemePage() {
  const ctx = await requireTenantUser({ permission: "branding.manage" });
  const readOnly = !!ctx.support || ctx.user.role === "SUPER_ADMIN";
  const presentation = await loadPublicPresentation(ctx.scope);
  const branch = (await listBranches(ctx.scope, { activeOnly: true }))[0] ?? null;
  const menu = await getPublishedMenu(ctx.scope, { branchId: branch?.id ?? null, locale: presentation.defaultLocale });
  // Önizleme tüm alanlarla serileştirilir; görünürlük anahtarları istemcide (aynı applyVisibility ile) uygulanır.
  const view = toPublicMenuView(
    menu,
    { ...presentation, showNutrition: true, showAllergens: true, showIngredients: true, showPreparationTime: true, showPoweredBy: true },
    // Önizlemede sipariş KAPALI (masa bağlamı yok); referanslar yalnızca sözleşme tutarlılığı için.
    { table: null, refOf: createMenuRefs(ctx.scope.tenantId), ordering: null },
  );

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Tema & Tasarım</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">Müşterilerinizin QR kodu okuttuğunda gördüğü menünün görünümü.</p>
        {readOnly ? (
          <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-fg-muted">
            <Eye aria-hidden="true" className="size-4" /> Salt okunur görünüm (destek modu).
          </p>
        ) : null}
      </header>
      <ThemeEditor
        view={view}
        readOnly={readOnly}
        media={{ logoUrl: presentation.logoUrl, logoManaged: presentation.logoManaged, heroUrl: presentation.heroImageUrl, heroManaged: presentation.heroManaged, canUpload: !readOnly }}
        initial={{
          style: presentation.style,
          primaryColor: presentation.primaryColor ?? "",
          accentColor: presentation.accentColor ?? "",
          logoUrl: presentation.logoExternalUrl ?? "",
          heroImageUrl: presentation.heroExternalUrl ?? "",
          welcomeText: presentation.welcomeText ?? "",
          googleReviewUrl: presentation.googleReviewUrl ?? "",
          showNutrition: presentation.showNutrition,
          showAllergens: presentation.showAllergens,
          showIngredients: presentation.showIngredients,
          showPreparationTime: presentation.showPreparationTime,
          showPoweredBy: presentation.showPoweredBy,
        }}
      />
    </>
  );
}

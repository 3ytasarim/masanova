import "server-only";
import { cache } from "react";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { getMenuLocaleConfig } from "@/server/services/menu/menu-common";

/**
 * Menü sayfalarının ortak bağlamı: görüntüleme yetkisi zorunlu; düzenleme yetkisi yoksa (operasyon rolleri,
 * Super Admin destek modu) arayüz salt okunur gösterilir. Asıl yetki kararı her Server Action'da ayrıca verilir.
 */
export const getMenuPageContext = cache(async () => {
  const ctx = await requireTenantUser({ permission: "menu.view" });
  const canManage = !ctx.support && ctx.user.role !== "SUPER_ADMIN" && hasPermission(ctx.user.role, "menu.manage");
  const locales = await getMenuLocaleConfig(ctx.scope);
  return { ...ctx, canManage, locales };
});

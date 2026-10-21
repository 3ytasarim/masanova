import "server-only";
import { cache } from "react";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { listTableBranches } from "@/server/repositories/tables.repository";

/**
 * Masa sayfalarının ortak bağlamı: görüntüleme yetkisi (tables.view) zorunlu. Yönetim yetkisi yoksa (garson, kasiyer,
 * Super Admin destek modu) arayüz salt okunur ve QR adresi / görseli gösterilmez. Asıl yetki kararı her Server Action
 * ve indirme ucunda ayrıca verilir.
 */
export const getTablesPageContext = cache(async () => {
  const ctx = await requireTenantUser({ permission: "tables.view" });
  const canManage = !ctx.support && ctx.user.role !== "SUPER_ADMIN" && hasPermission(ctx.user.role, "tables.manage");
  const branches = await listTableBranches(ctx.scope);
  return { ...ctx, canManage, branches };
});

/** URL'deki şube seçimi yalnızca kapsam içindeki şubeler arasından; geçersizse ilk (aktif) şube. */
export function pickBranch<T extends { id: string }>(branches: T[], requested: string | undefined): T | null {
  return branches.find((b) => b.id === requested) ?? branches[0] ?? null;
}

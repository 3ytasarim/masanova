"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { getRequestMeta } from "@/lib/security/request-meta";
import { publicThemeSchema } from "@/lib/validation/public-menu";
import { invalidatePublicMenu } from "@/server/services/public-menu/public-menu-cache";
import { savePublicTheme } from "@/server/services/public-menu/theme.service";

/**
 * Tema & Tasarım: yalnızca İşletme Sahibi (branding.manage), yazma işlemi — Super Admin destek modunda reddedilir.
 */
export async function savePublicThemeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const ctx = await requireTenantUser({ permission: "branding.manage", write: true });
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const on = (k: string) => fd.get(k) === "on" || fd.get(k) === "true";
  const parsed = publicThemeSchema.safeParse({
    style: str("style"),
    primaryColor: str("primaryColor"),
    accentColor: str("accentColor"),
    logoUrl: str("logoUrl"),
    heroImageUrl: str("heroImageUrl"),
    welcomeText: str("welcomeText"),
    googleReviewUrl: str("googleReviewUrl"),
    showNutrition: on("showNutrition"),
    showAllergens: on("showAllergens"),
    showIngredients: on("showIngredients"),
    showPreparationTime: on("showPreparationTime"),
    showPoweredBy: on("showPoweredBy"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await savePublicTheme({ userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() }, parsed.data);
  if (result.ok) invalidatePublicMenu(ctx.scope.tenantId);
  revalidatePath("/panel/tema");
  return result;
}

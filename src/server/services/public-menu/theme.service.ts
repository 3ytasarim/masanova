import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import type { PublicThemeInput } from "@/lib/validation/public-menu";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * QR menü görünümünü kaydeder: marka renkleri + logo TenantSettings'e (panel ve etiketlerle ortak), menüye özgü
 * ayarlar PublicMenuSettings'e — tek transaction + denetim kaydı. Kapsam yalnızca oturumdan gelir.
 */
export async function savePublicTheme(actor: { userId: string; scope: TenantScope; meta: RequestMeta }, input: PublicThemeInput): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const menuSettings = {
    style: input.style,
    welcomeText: input.welcomeText,
    googleReviewUrl: input.googleReviewUrl,
    heroImageUrl: input.heroImageUrl,
    showNutrition: input.showNutrition,
    showAllergens: input.showAllergens,
    showIngredients: input.showIngredients,
    showPreparationTime: input.showPreparationTime,
    showPoweredBy: input.showPoweredBy,
  };
  await prisma.$transaction(async (tx) => {
    await tx.tenantSettings.upsert({
      where: { tenantId },
      update: { primaryColor: input.primaryColor, accentColor: input.accentColor, logoUrl: input.logoUrl },
      create: { tenantId, primaryColor: input.primaryColor, accentColor: input.accentColor, logoUrl: input.logoUrl },
    });
    await tx.publicMenuSettings.upsert({ where: { tenantId }, update: menuSettings, create: { tenantId, ...menuSettings } });
    await tx.auditLog.create({
      data: buildAuditRow(
        {
          action: "PUBLIC_MENU_SETTINGS_UPDATED",
          entity: "PublicMenuSettings",
          entityId: tenantId,
          tenantId,
          userId: actor.userId,
          metadata: { ...menuSettings, primaryColor: input.primaryColor, accentColor: input.accentColor, logoUrl: input.logoUrl },
        },
        actor.meta,
      ),
    });
  });
  return { ok: true, data: undefined, message: "QR menü görünümü kaydedildi." };
}

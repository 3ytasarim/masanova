"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { recordAudit } from "@/server/services/audit.service";
import { translateMenuStep } from "@/server/services/menu/auto-translate.service";
import { invalidatePublicMenu } from "@/server/services/public-menu/public-menu-cache";

/**
 * "Eksik çevirileri yapay zekâyla tamamla" — menu.manage. Tek çağrı = bir adım (≈20 sn); arayüz remaining=0 olana dek
 * ardışık çağırır (ilerleme çubuğu). Yalnızca eksik çeviriler yazılır; elle girilmiş çeviri ezilmez.
 */
export type TranslateStepActionResult = ActionResult<{ translated: number; remaining: number }>;

export async function translateMenuStepAction(): Promise<TranslateStepActionResult> {
  const ctx = await requireTenantUser({ permission: "menu.manage", write: true });
  const step = await translateMenuStep(ctx.scope.tenantId);
  if (!step.ok) return { ok: false, error: "Yapay zekâ çevirisi şu anda kullanılamıyor (sağlayıcı yapılandırılmamış)." };
  if (step.translated === 0 && step.failedChunks > 0) return { ok: false, error: "Çeviri servisi yanıt vermedi. Biraz sonra tekrar deneyin." };
  if (step.translated > 0) {
    invalidatePublicMenu(ctx.scope.tenantId);
    await recordAudit({ action: "MENU_TRANSLATED", entity: "Tenant", entityId: ctx.scope.tenantId, tenantId: ctx.scope.tenantId, userId: ctx.user.id, metadata: { translated: step.translated, remaining: step.remaining } });
  }
  if (step.remaining === 0) revalidatePath("/panel/menu");
  return { ok: true, data: { translated: step.translated, remaining: step.remaining } };
}

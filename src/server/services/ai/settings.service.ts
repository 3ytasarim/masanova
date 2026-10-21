import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { sanitizeCustomInstructions, sanitizeUserText } from "@/lib/ai/safety";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import type { AiSettingsInput } from "@/lib/validation/ai";
import { buildAuditRow } from "@/server/services/audit.service";
import { checkFeature } from "@/server/billing/entitlements";

/**
 * AI ayarları — aktör requireTenantUser({ permission: "ai.manage", write: true }) (destek modu reddedilir).
 * Paket özelliği yoksa yalnızca kapalı kaydedilebilir (açmak için AI paketi gerekir). Sağlayıcı sırları burada değil.
 */
export type AiSettingsActor = { userId: string; scope: TenantScope; meta: RequestMeta };

export async function saveAiSettings(actor: AiSettingsActor, input: AiSettingsInput): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  if (input.enabled && !(await checkFeature(actor.scope.tenantId, "voice_ai")).allowed) return { ok: false, error: "Voice AI mevcut paketinizde aktif değil." };
  const data = {
    enabled: input.enabled,
    assistantName: sanitizeUserText(input.assistantName, 40) || "MasaNova AI",
    welcomeMessage: input.welcomeMessage ? sanitizeUserText(input.welcomeMessage, 200) : null,
    tone: input.tone,
    customInstructions: sanitizeCustomInstructions(input.customInstructions),
    allowRecommendations: input.allowRecommendations,
    allowCartActions: input.allowCartActions,
    allowServiceActions: input.allowServiceActions,
    voiceEnabled: input.voiceEnabled,
    defaultVoiceLanguage: input.defaultVoiceLanguage,
  };
  await prisma.$transaction(async (tx) => {
    await tx.aiSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    await tx.auditLog.create({
      data: buildAuditRow(
        {
          action: "AI_SETTINGS_UPDATED",
          entity: "AiSettings",
          entityId: tenantId,
          tenantId,
          userId: actor.userId,
          // Metin içerikleri değil, yalnızca bayraklar / uzunluklar (özel talimat düşük güvenli; içerik loglanmaz).
          metadata: { ...data, welcomeMessage: data.welcomeMessage ? data.welcomeMessage.length : 0, customInstructions: data.customInstructions ? data.customInstructions.length : 0 },
        },
        actor.meta,
      ),
    });
  });
  return { ok: true, data: undefined, message: "AI asistan ayarları kaydedildi." };
}

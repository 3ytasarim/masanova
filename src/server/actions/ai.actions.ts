"use server";

import { revalidatePath } from "next/cache";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { getRequestMeta } from "@/lib/security/request-meta";
import { aiSettingsSchema } from "@/lib/validation/ai";
import { saveAiSettings } from "@/server/services/ai/settings.service";

/**
 * AI ayarları — requireTenantUser({ permission: "ai.manage", write: true }): sahip / müdür; destek modu reddedilir.
 * Kiracı oturumdan; formdaki kiracı alanı yok sayılır. Sağlayıcı / anahtar alanı yoktur.
 */
const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";

export async function saveAiSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const ctx = await requireTenantUser({ permission: "ai.manage", write: true });
  const parsed = aiSettingsSchema.safeParse({
    enabled: bool(fd, "enabled"),
    assistantName: str(fd, "assistantName"),
    welcomeMessage: str(fd, "welcomeMessage"),
    tone: str(fd, "tone"),
    customInstructions: str(fd, "customInstructions"),
    allowRecommendations: bool(fd, "allowRecommendations"),
    allowCartActions: bool(fd, "allowCartActions"),
    allowServiceActions: bool(fd, "allowServiceActions"),
    voiceEnabled: bool(fd, "voiceEnabled"),
    defaultVoiceLanguage: str(fd, "defaultVoiceLanguage"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await saveAiSettings({ userId: ctx.user.id, scope: ctx.scope, meta: await getRequestMeta() }, parsed.data);
  revalidatePath("/panel/ai");
  return result;
}

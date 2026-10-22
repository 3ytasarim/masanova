import "server-only";
import { notFound } from "next/navigation";
import type { AiSettings } from "@prisma/client";
import type { Feature } from "@/config/plans";
import { prisma } from "@/lib/db/prisma";
import { voiceAiAvailability, type AiAvailability } from "@/lib/ai/feature-gates";
import type { TenantScope } from "@/lib/tenant/scope";
import { getProviders } from "@/server/services/ai/config";
import { getTenantEntitlements, resolveEntitlements, usageAllows } from "@/server/billing/entitlements";

/**
 * Sunucu tarafı özellik kapısı — düğmeyi gizlemek güvenlik DEĞİLDİR; her uç nokta burayı çağırır.
 */
export const DEFAULT_AI_SETTINGS = {
  enabled: false,
  assistantName: "MasaNova AI",
  welcomeMessage: null,
  tone: "WARM",
  customInstructions: null,
  allowRecommendations: true,
  allowCartActions: true,
  allowServiceActions: true,
  voiceEnabled: true,
  defaultVoiceLanguage: null,
  pairings: null,
} as const satisfies Omit<AiSettings, "id" | "tenantId" | "createdAt" | "updatedAt">;

export type EffectiveAiSettings = Omit<AiSettings, "id" | "tenantId" | "createdAt" | "updatedAt">;

export async function getAiSettings(tenantId: string): Promise<EffectiveAiSettings> {
  const row = await prisma.aiSettings.findUnique({ where: { tenantId } });
  if (!row) return { ...DEFAULT_AI_SETTINGS };
  const { id, tenantId: _t, createdAt, updatedAt, ...rest } = row;
  void id;
  void _t;
  void createdAt;
  void updatedAt;
  return rest;
}

/** Panel sayfaları için (görüntüleme): kanonik çözücüden. */
export async function tenantHasFeature(scope: TenantScope, feature: Feature): Promise<boolean> {
  return (await getTenantEntitlements(scope.tenantId)).has(feature);
}

/**
 * Müşteri asistanı erişimi: paket yetkisi (voice_ai, kanonik çözücü — taze) + işletme ayarı + yapılandırılmış AI
 * sağlayıcısı + dönem kullanım limiti (sesli dakika / AI yanıtı). Limit dolunca sağlayıcı ÇAĞRILMAZ (sürpriz harcama yok).
 */
export async function getVoiceAiAccess(tenantId: string): Promise<{ availability: AiAvailability; settings: EffectiveAiSettings }> {
  const [ent, settings] = await Promise.all([resolveEntitlements(tenantId), getAiSettings(tenantId)]);
  const entitled = ent.has("voice_ai");
  const base = { entitled, settingsEnabled: settings.enabled, providerConfigured: !!getProviders().ai };
  if (!entitled || !base.settingsEnabled || !base.providerConfigured) return { availability: voiceAiAvailability(base), settings };
  const usage = await usageAllows(ent, ["maxMonthlyAiMinutes", "maxMonthlyAiReplies"]);
  return { availability: voiceAiAvailability({ ...base, withinLimit: usage.allowed }), settings };
}

export function notFoundIfUnavailable(availability: AiAvailability): void {
  if (!availability.available) notFound();
}

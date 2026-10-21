/**
 * Sesli AI erişim kararı (saf). Sunucu her istekte uygular; düğmeyi gizlemek yalnızca kullanılabilirliktir.
 *   paket yetkisi (voice_ai — kanonik çözücüden) → işletme ayarında açık → sağlayıcı yapılandırılmış → dönem limiti.
 */
export type AiAvailability = { available: true } | { available: false; reason: "plan" | "disabled" | "provider" | "limit" };

export function voiceAiAvailability(input: { entitled: boolean; settingsEnabled: boolean; providerConfigured: boolean; withinLimit?: boolean }): AiAvailability {
  if (!input.entitled) return { available: false, reason: "plan" };
  if (!input.settingsEnabled) return { available: false, reason: "disabled" };
  if (!input.providerConfigured) return { available: false, reason: "provider" };
  if (input.withinLimit === false) return { available: false, reason: "limit" };
  return { available: true };
}

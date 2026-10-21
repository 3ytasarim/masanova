/**
 * Pazarlama etkileşim olayları — tipli ad + tarayıcı içi CustomEvent ("masanova:marketing"). Üçüncü taraf izleyici
 * YOK; kalıcı kayıt (analitik uç noktası) sonraya bırakıldı. Öğeler `data-track="<OLAY>"` ile işaretlenir, tek bir
 * dinleyici (MarketingTracker) tıklamaları yakalar.
 */
export const MARKETING_EVENTS = ["MARKETING_DEMO_CTA", "MARKETING_HOW_IT_WORKS", "MARKETING_VOICE_DEMO", "MARKETING_LOGIN_CLICK", "MARKETING_PLAN_CTA", "MARKETING_WHATSAPP_CTA", "MARKETING_DEMO_SUBMITTED"] as const;
export type MarketingEvent = (typeof MARKETING_EVENTS)[number];
export const MARKETING_EVENT_NAME = "masanova:marketing";

export type MarketingEventDetail = { event: MarketingEvent; placement?: string; at: number };

export function isMarketingEvent(value: unknown): value is MarketingEvent {
  return typeof value === "string" && (MARKETING_EVENTS as readonly string[]).includes(value);
}

/** Olayı yayınlar; geçersiz ad sessizce yok sayılır. Kişisel veri taşımaz (yalnızca olay + yerleşim). */
export function trackMarketing(target: EventTarget | undefined, event: string, placement?: string): MarketingEventDetail | null {
  if (!target || !isMarketingEvent(event)) return null;
  const detail: MarketingEventDetail = { event, placement: placement?.slice(0, 40), at: Date.now() };
  target.dispatchEvent(new CustomEvent(MARKETING_EVENT_NAME, { detail }));
  return detail;
}

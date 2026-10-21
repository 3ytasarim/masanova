import type { ConsentKind, ConsentState } from "@/lib/crm/consent";

/**
 * Kampanya kitlesi — deterministik segment + GÜNCEL pazarlama onayı + kanal için iletişim bilgisi. Hassas çıkarım
 * yok (doğum günü alanı olmadığı için doğum günü segmenti de yok). Kampanya onay VERMEZ, personel onayı AŞAMAZ.
 */
export type SegmentName = "ALL_OPTED_IN" | "LOYALTY_MEMBERS" | "REPEAT_CUSTOMERS" | "NO_VISIT_30_DAYS" | "HIGH_ORDER_COUNT" | "LANGUAGE_TR" | "LANGUAGE_EN";
export type ChannelName = "EMAIL" | "SMS" | "WHATSAPP";

export const SEGMENT_LABELS: Record<SegmentName, string> = {
  ALL_OPTED_IN: "Bu kanala izin veren tüm müşteriler",
  LOYALTY_MEMBERS: "Sadakat üyeleri",
  REPEAT_CUSTOMERS: "Tekrar gelen (≥ 2 servis edilmiş sipariş)",
  NO_VISIT_30_DAYS: "30 gündür gelmeyen",
  HIGH_ORDER_COUNT: "Sık gelen (≥ 5 servis edilmiş sipariş)",
  LANGUAGE_TR: "Dil: Türkçe",
  LANGUAGE_EN: "Dil: İngilizce",
};
export const CHANNEL_LABELS: Record<ChannelName, string> = { EMAIL: "E-posta", SMS: "SMS", WHATSAPP: "WhatsApp" };
export const CHANNEL_CONSENT: Record<ChannelName, ConsentKind> = { EMAIL: "MARKETING_EMAIL", SMS: "MARKETING_SMS", WHATSAPP: "MARKETING_WHATSAPP" };
const CHANNEL_CONTACT: Record<ChannelName, "email" | "phone"> = { EMAIL: "email", SMS: "phone", WHATSAPP: "phone" };

export const HIGH_ORDER_MIN = 5;
export const REPEAT_MIN = 2;
const DAY = 86_400_000;

export type SegmentCustomer = {
  consents: Record<ConsentKind, ConsentState>;
  hasEmail: boolean;
  hasPhone: boolean;
  deletionRequested: boolean;
  loyaltyActive: boolean;
  servedOrders: number;
  lastVisitAt: Date | null;
  preferredLanguage: string | null;
};

export function inSegment(segment: SegmentName, c: SegmentCustomer, now: Date): boolean {
  switch (segment) {
    case "ALL_OPTED_IN":
      return true;
    case "LOYALTY_MEMBERS":
      return c.loyaltyActive;
    case "REPEAT_CUSTOMERS":
      return c.servedOrders >= REPEAT_MIN;
    case "HIGH_ORDER_COUNT":
      return c.servedOrders >= HIGH_ORDER_MIN;
    case "NO_VISIT_30_DAYS":
      return !!c.lastVisitAt && now.getTime() - c.lastVisitAt.getTime() >= 30 * DAY;
    case "LANGUAGE_TR":
      return (c.preferredLanguage ?? "tr") === "tr";
    case "LANGUAGE_EN":
      return c.preferredLanguage === "en";
  }
}

export type AudienceClass = "eligible" | "not_in_segment" | "deletion_requested" | "no_consent" | "missing_contact";

/** Sıra önemli: silme talebi → segment → onay → iletişim. Onay "geri alındı" ya da "hiç verilmedi" ise uygun DEĞİL. */
export function classify(c: SegmentCustomer, segment: SegmentName, channel: ChannelName, now: Date): AudienceClass {
  if (c.deletionRequested) return "deletion_requested";
  if (!inSegment(segment, c, now)) return "not_in_segment";
  if (c.consents[CHANNEL_CONSENT[channel]] !== "GRANTED") return "no_consent";
  if (CHANNEL_CONTACT[channel] === "email" ? !c.hasEmail : !c.hasPhone) return "missing_contact";
  return "eligible";
}

export type AudiencePreview = { eligible: number; inSegment: number; noConsent: number; missingContact: number; deletionRequested: number };

export function previewAudience(customers: readonly SegmentCustomer[], segment: SegmentName, channel: ChannelName, now: Date): AudiencePreview {
  const out: AudiencePreview = { eligible: 0, inSegment: 0, noConsent: 0, missingContact: 0, deletionRequested: 0 };
  for (const c of customers) {
    const k = classify(c, segment, channel, now);
    if (k === "deletion_requested") out.deletionRequested++;
    if (k === "not_in_segment" || k === "deletion_requested") continue;
    out.inSegment++;
    if (k === "eligible") out.eligible++;
    else if (k === "no_consent") out.noConsent++;
    else if (k === "missing_contact") out.missingContact++;
  }
  return out;
}

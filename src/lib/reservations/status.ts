import type { BadgeTone } from "@/components/ui/badge";

/**
 * Rezervasyon durum makinesi — TEK kaynak. Servisler, eylemler ve arayüz geçiş kararını buradan okur.
 *   PENDING   → CONFIRMED / CANCELLED
 *   CONFIRMED → SEATED / CANCELLED / NO_SHOW
 *   SEATED    → COMPLETED / CANCELLED
 *   COMPLETED, CANCELLED, NO_SHOW → son durum
 * Etkin (masa tutan) durumlar: PENDING, CONFIRMED, SEATED. Son durumda masa serbest kalır.
 */
export type ReservationStatusName = "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type ReservationSourceName = "PUBLIC_WEB" | "STAFF" | "WALK_IN" | "PHONE" | "OTHER";

export const RESERVATION_TRANSITIONS: Record<ReservationStatusName, readonly ReservationStatusName[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["SEATED", "CANCELLED", "NO_SHOW"],
  SEATED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const ACTIVE_STATUSES: readonly ReservationStatusName[] = ["PENDING", "CONFIRMED", "SEATED"];

export function canTransition(from: ReservationStatusName, to: ReservationStatusName): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

export function isActiveStatus(status: ReservationStatusName): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** Gelmedi: yalnızca rezervasyon saati + bekleme payı geçtikten sonra. */
export function canMarkNoShow(r: { status: ReservationStatusName; startsAt: Date }, now: Date, graceMinutes: number): boolean {
  return canTransition(r.status, "NO_SHOW") && now.getTime() >= r.startsAt.getTime() + graceMinutes * 60_000;
}

/** Müşteri iptali: PENDING / CONFIRMED ve iptal sınırından önce (sınır 0 ise rezervasyon saatine kadar). */
export function canCustomerCancel(r: { status: ReservationStatusName; startsAt: Date }, now: Date, cutoffMinutes: number): boolean {
  return (r.status === "PENDING" || r.status === "CONFIRMED") && now.getTime() <= r.startsAt.getTime() - cutoffMinutes * 60_000;
}

/** Gecikme (dk): gelmesi beklenen ve saati geçmiş rezervasyon. Otomatik iptal YOK — personel karar verir. */
export function lateMinutes(r: { status: ReservationStatusName; startsAt: Date }, now: Date): number | null {
  if (r.status !== "PENDING" && r.status !== "CONFIRMED") return null;
  const late = Math.floor((now.getTime() - r.startsAt.getTime()) / 60_000);
  return late >= 1 ? late : null;
}

export const RESERVATION_STATUS_LABELS: Record<ReservationStatusName, string> = {
  PENDING: "Onay bekliyor",
  CONFIRMED: "Onaylandı",
  SEATED: "Masada",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  NO_SHOW: "Gelmedi",
};

export const RESERVATION_STATUS_TONES: Record<ReservationStatusName, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "info",
  SEATED: "accent",
  COMPLETED: "success",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
};

export const RESERVATION_SOURCE_LABELS: Record<ReservationSourceName, string> = {
  PUBLIC_WEB: "Online",
  STAFF: "Personel",
  WALK_IN: "Walk-in",
  PHONE: "Telefon",
  OTHER: "Diğer",
};

/** Panel eylem düğmeleri (hedef durum → etiket). */
export const TRANSITION_ACTION_LABELS: Partial<Record<ReservationStatusName, string>> = {
  CONFIRMED: "Onayla",
  SEATED: "Masaya Al",
  COMPLETED: "Tamamla",
  CANCELLED: "İptal Et",
  NO_SHOW: "Gelmedi",
};

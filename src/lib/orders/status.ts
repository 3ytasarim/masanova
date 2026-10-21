import type { OrderStatus, TicketStatus } from "@prisma/client";

/**
 * Sipariş ve istasyon fişi durum makinesi — TEK kaynak. Arayüz durumu doğrudan atamaz; her değişiklik buradaki
 * tabloyla denetlenir ve servis "beklenen önceki durum" koşuluyla (atomik koşullu güncelleme) uygular.
 *
 * Ana yol:   SUBMITTED → ACCEPTED → PREPARING → READY → SERVED
 * Ret:       SUBMITTED → REJECTED
 * İptal:     ACCEPTED | PREPARING → CANCELLED (personel; açıklama zorunlu; iade yok)
 * Geri dönüş yok. Terminal: SERVED, REJECTED, CANCELLED.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  SUBMITTED: ["ACCEPTED", "REJECTED"],
  // ACCEPTED → READY: tüm fişler hazırlık adımı yaşanmadan hazır olursa (uç durum; yalnızca sistem).
  ACCEPTED: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SERVED"],
  SERVED: [],
  CANCELLED: [],
  REJECTED: [],
};

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Personelin elle yapabildiği geçişler (yetki ayrıca rol bazlı denetlenir). PREPARING / READY sistemindir. */
export const STAFF_TRANSITIONS: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  SUBMITTED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["CANCELLED"],
  PREPARING: ["CANCELLED"],
  READY: ["SERVED"],
};

/** Sistemin fiş durumlarından türettiği otomatik geçişler. */
export const SYSTEM_TRANSITIONS: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  ACCEPTED: ["PREPARING", "READY"],
  PREPARING: ["READY"],
};

export function canStaffTransition(from: OrderStatus, to: OrderStatus): boolean {
  return canTransitionOrderStatus(from, to) && (STAFF_TRANSITIONS[from]?.includes(to) ?? false);
}

export function canSystemTransition(from: OrderStatus, to: OrderStatus): boolean {
  return canTransitionOrderStatus(from, to) && (SYSTEM_TRANSITIONS[from]?.includes(to) ?? false);
}

/** Personel eylemi → gereken yetki (RBAC ile birlikte). */
export const STAFF_TRANSITION_PERMISSION = {
  ACCEPTED: "orders.manage",
  REJECTED: "orders.manage",
  SERVED: "orders.serve",
  CANCELLED: "orders.cancel",
} as const;

// ─── İstasyon fişi ──────────────────────────────────────────────────────────

export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  PENDING: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: [],
  CANCELLED: [],
};

/** KDS personelinin yapabildiği fiş geçişleri (iptal yalnızca sipariş iptaliyle, sistem tarafından). */
export function canStaffTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return (from === "PENDING" && to === "PREPARING") || (from === "PREPARING" && to === "READY");
}

/**
 * Fiş durumlarından siparişin olması gereken durumu türetir (saf). Kurallar:
 *  - herhangi bir fiş hazırlanmaya başladıysa (PREPARING / READY) ve sipariş ACCEPTED ise → PREPARING
 *  - iptal edilmemiş TÜM fişler READY ise → READY (bir istasyonun bitmesi yetmez)
 * Değişiklik gerekmiyorsa null.
 */
export function deriveOrderStatus(current: OrderStatus, tickets: readonly { status: TicketStatus }[]): OrderStatus | null {
  const live = tickets.filter((t) => t.status !== "CANCELLED");
  if (!live.length) return null;
  const allReady = live.every((t) => t.status === "READY");
  if (allReady && canSystemTransition(current, "READY")) return "READY";
  const started = live.some((t) => t.status === "PREPARING" || t.status === "READY");
  if (started && current === "ACCEPTED") return "PREPARING";
  return null;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  SUBMITTED: "Onay bekliyor",
  ACCEPTED: "Kabul edildi",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  SERVED: "Servis edildi",
  CANCELLED: "İptal edildi",
  REJECTED: "Reddedildi",
};

export const ORDER_STATUS_TONES: Record<OrderStatus, "neutral" | "accent" | "success" | "warning" | "danger" | "info"> = {
  SUBMITTED: "warning",
  ACCEPTED: "info",
  PREPARING: "info",
  READY: "accent",
  SERVED: "success",
  CANCELLED: "neutral",
  REJECTED: "danger",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  PENDING: "Yeni",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  CANCELLED: "İptal",
};

/** Görünen sipariş numarası (#1042). Numara şube içi sayaçtan gelir; iç kimlik asla gösterilmez. */
export const ORDER_NUMBER_START = 1001;
export function formatOrderNumber(n: number): string {
  return `#${n}`;
}

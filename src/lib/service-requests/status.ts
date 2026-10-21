import type { ServiceRequestStatus, ServiceRequestType, UserRole } from "@prisma/client";
import { hasPermission } from "@/lib/permissions/roles";

/**
 * Servis talebi durum makinesi — TEK kaynak. Durum doğrudan atanmaz; servisler bu tabloyu denetler ve "beklenen
 * önceki durum" koşullu güncellemesiyle uygular (iki garson aynı anda "Ben ilgileniyorum" derse yalnızca biri kazanır).
 *
 *   OPEN → ACKNOWLEDGED → COMPLETED
 *   OPEN → CANCELLED              (müşteri aynı masadan ya da yönetici)
 *   ACKNOWLEDGED → CANCELLED      (yalnızca yönetici — ör. yanlışlıkla / mükerrer talep)
 *   COMPLETED, CANCELLED: terminal. Atamayı bırakma / yeniden atama bu sürümde yok.
 */
export const SERVICE_TRANSITIONS: Record<ServiceRequestStatus, readonly ServiceRequestStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "CANCELLED"],
  ACKNOWLEDGED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionService(from: ServiceRequestStatus, to: ServiceRequestStatus): boolean {
  return SERVICE_TRANSITIONS[from].includes(to);
}

export const ACTIVE_SERVICE_STATUSES = ["OPEN", "ACKNOWLEDGED"] as const satisfies readonly ServiceRequestStatus[];

export function isActiveService(status: ServiceRequestStatus): boolean {
  return status === "OPEN" || status === "ACKNOWLEDGED";
}

// ─── Personel yetenekleri (sunucuda rol + yetki matrisiyle hesaplanır) ──────

/**
 * - manage: tüm tipleri üstlenir / tamamlar (sahip, müdür, garson)
 * - billOnly: yalnızca HESAP taleplerini üstlenir / tamamlar (kasiyer) — sunucu tarafında tip denetimi
 * - override: başkasının üstlendiği talebi tamamlar / iptal eder (sahip, müdür)
 * Mutfak / bar servis panosuna erişmez (KDS ön salonla karışmaz).
 */
export type ServiceAbilities = { view: boolean; manage: boolean; billOnly: boolean; override: boolean };

export function serviceAbilities(role: UserRole, opts: { readOnly?: boolean } = {}): ServiceAbilities {
  const view = hasPermission(role, "service.view");
  if (opts.readOnly) return { view, manage: false, billOnly: false, override: false };
  const manage = hasPermission(role, "service.manage");
  return { view, manage, billOnly: !manage && hasPermission(role, "service.bill"), override: hasPermission(role, "service.override") };
}

export function canHandleType(abilities: ServiceAbilities, type: ServiceRequestType): boolean {
  return abilities.manage || (abilities.billOnly && type === "BILL");
}

export type ServiceActorCheck = { userId: string; abilities: ServiceAbilities };
export type ServiceRequestState = { type: ServiceRequestType; status: ServiceRequestStatus; acknowledgedByUserId: string | null };

export type ServiceDecision = { ok: true } | { ok: false; reason: "forbidden" | "not_assignee" | "wrong_status" };

/** Üstlenme: tipi yönetebilen personel, yalnızca OPEN. */
export function canClaim(actor: ServiceActorCheck, request: ServiceRequestState): ServiceDecision {
  if (!canHandleType(actor.abilities, request.type)) return { ok: false, reason: "forbidden" };
  return request.status === "OPEN" ? { ok: true } : { ok: false, reason: "wrong_status" };
}

/** Tamamlama: ACKNOWLEDGED; üstlenen kişi ya da yönetici (override). Başka bir garson tamamlayamaz. */
export function canComplete(actor: ServiceActorCheck, request: ServiceRequestState): ServiceDecision {
  if (!canHandleType(actor.abilities, request.type)) return { ok: false, reason: "forbidden" };
  if (request.status !== "ACKNOWLEDGED") return { ok: false, reason: "wrong_status" };
  if (request.acknowledgedByUserId === actor.userId || actor.abilities.override) return { ok: true };
  return { ok: false, reason: "not_assignee" };
}

/** Personel iptali: yalnızca yönetici (override), OPEN ya da ACKNOWLEDGED. */
export function canStaffCancel(actor: ServiceActorCheck, request: ServiceRequestState): ServiceDecision {
  if (!actor.abilities.override) return { ok: false, reason: "forbidden" };
  return isActiveService(request.status) ? { ok: true } : { ok: false, reason: "wrong_status" };
}

/** Müşteri iptali: yalnızca OPEN (personel üstlendikten sonra iptal yok — personelle konuşulur). */
export function canCustomerCancel(request: Pick<ServiceRequestState, "status">): boolean {
  return request.status === "OPEN";
}

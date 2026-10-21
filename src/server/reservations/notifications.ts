import "server-only";
import { log } from "@/lib/observability/logger";

/**
 * Gelecekteki bildirim kancası (SMS / e-posta HATIRLATMA YOK). Bu sprintte yalnızca olay adı + iç kimlik loglanır;
 * kişisel veri ve yönetim belirteci ASLA loglanmaz. Bir bildirim sağlayıcısı eklendiğinde burası kuyruğa yazar.
 */
export type ReservationNotificationKind = "RESERVATION_CONFIRMED" | "RESERVATION_REMINDER";

export function queueReservationNotification(kind: ReservationNotificationKind, tenantId: string, reservationId: string): void {
  log.info("reservation.notification_skipped", { kind, tenant: tenantId, reservation: reservationId, reason: "no_provider" });
}

import type { ServiceRequestStatus, ServiceRequestType } from "@prisma/client";
import { isActiveService } from "@/lib/service-requests/status";

/**
 * Mükerrer talep politikası (Sprint 8): masa + tip başına EN FAZLA BİR aktif (OPEN / ACKNOWLEDGED) talep.
 * Su / peçete dahil — davranış öngörülebilir olsun diye; talep tamamlanınca / iptal edilince yenisi açılabilir.
 * Veritabanı garantisi: active_slot ('ACTIVE' yalnızca aktifken) + benzersiz (table_id, type, active_slot) + CHECK.
 * "Önce kontrol et sonra ekle" yalnızca hızlı yoldur; yarışı benzersizlik kısıtı çözer (P2002 → mevcut talep döner).
 */
export const ACTIVE_SLOT = "ACTIVE" as const;

export function findActiveDuplicate<T extends { type: ServiceRequestType; status: ServiceRequestStatus }>(existing: readonly T[], type: ServiceRequestType): T | null {
  return existing.find((r) => r.type === type && isActiveService(r.status)) ?? null;
}

/** Durum geçişinde active_slot değeri (terminal → NULL; böylece yeni aktif talep açılabilir). */
export function activeSlotFor(status: ServiceRequestStatus): typeof ACTIVE_SLOT | null {
  return isActiveService(status) ? ACTIVE_SLOT : null;
}

/**
 * Hız sınırı (bellek içi, Redis'e taşınabilir arayüz). Yalnızca IP'ye güvenilmez — aynı Wi-Fi'de çok masa olur:
 *   masa + tip : 6 / 10 dk   (iptal → yeniden iste döngüsü)
 *   masa       : 20 / 10 dk
 *   IP         : 120 / 10 dk (ikincil sinyal; tüm restoran tek IP olabilir)
 */
export const SERVICE_RATE_LIMITS = {
  tableType: { limit: 6, windowMs: 10 * 60 * 1000 },
  table: { limit: 20, windowMs: 10 * 60 * 1000 },
  ip: { limit: 120, windowMs: 10 * 60 * 1000 },
} as const;

/** Müşteri ekranında "son talepler": aktifler + son 10 dakikada kapananlar (geri bildirim için). */
export const CUSTOMER_RECENT_WINDOW_MS = 10 * 60 * 1000;

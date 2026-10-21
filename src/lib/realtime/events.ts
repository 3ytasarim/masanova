import type { OrderStatus, ServiceRequestStatus, ServiceRequestType, TicketStatus } from "@prisma/client";

/**
 * Gerçek zamanlı olay sözleşmesi (sunucu + istemci ortak). Zarf sürümlüdür; veri yalnızca gereken en az alanı taşır.
 * ASLA: QR token, oturum kimliği, kiracı sırrı, müşteri / denetim verisi, bağlantı dizesi.
 * İstemci olayı "bir şey değişti" sinyali olarak kullanır ve yetkili durumu sunucudan yeniden çeker; olayların
 * tamamının teslim edileceği varsayılmaz (yeniden bağlanınca kaçırılanlar yeniden oynatılmaz).
 */
export const REALTIME_EVENT_VERSION = 1 as const;

export type OrderEventType = "ORDER_SUBMITTED" | "ORDER_ACCEPTED" | "ORDER_REJECTED" | "ORDER_PREPARING" | "ORDER_READY" | "ORDER_SERVED" | "ORDER_CANCELLED";

export type ServiceEventType = "SERVICE_REQUEST_CREATED" | "SERVICE_REQUEST_ACKNOWLEDGED" | "SERVICE_REQUEST_COMPLETED" | "SERVICE_REQUEST_CANCELLED";

/** Panel (kimliği doğrulanmış personel, kiracı kapsamlı) olayları. */
export type StaffEvent =
  | { type: OrderEventType; data: { orderId: string; orderNumber: number; status: OrderStatus; /** Yalnızca yeni siparişte: panel bildirimi ("Masa 5 · 3 ürün"). */ tableName?: string; itemCount?: number } }
  | { type: "STATION_TICKET_UPDATED"; data: { orderId: string; orderNumber: number; ticketId: string; stationId: string; status: TicketStatus } }
  | { type: ServiceEventType; data: { requestId: string; kind: ServiceRequestType; status: ServiceRequestStatus } };

/**
 * Müşteri (public) olayları — kimlik yok, yalnızca yeni durum (servis talebinde + talep tipi). Personel adı olaya
 * konmaz; müşteri ekranı durumu sunucudan yeniden çeker (görünen ad oradan, güvenli biçimde gelir).
 */
export type CustomerEvent = { type: OrderEventType; data: { status: OrderStatus } } | { type: ServiceEventType; data: { kind: ServiceRequestType; status: ServiceRequestStatus } };

export type RealtimeEnvelope<E extends StaffEvent | CustomerEvent = StaffEvent | CustomerEvent> = E & { version: typeof REALTIME_EVENT_VERSION; occurredAt: string };

export const ORDER_EVENT_BY_STATUS: Record<OrderStatus, OrderEventType> = {
  SUBMITTED: "ORDER_SUBMITTED",
  ACCEPTED: "ORDER_ACCEPTED",
  REJECTED: "ORDER_REJECTED",
  PREPARING: "ORDER_PREPARING",
  READY: "ORDER_READY",
  SERVED: "ORDER_SERVED",
  CANCELLED: "ORDER_CANCELLED",
};

export const SERVICE_EVENT_BY_STATUS: Record<ServiceRequestStatus, ServiceEventType> = {
  OPEN: "SERVICE_REQUEST_CREATED",
  ACKNOWLEDGED: "SERVICE_REQUEST_ACKNOWLEDGED",
  COMPLETED: "SERVICE_REQUEST_COMPLETED",
  CANCELLED: "SERVICE_REQUEST_CANCELLED",
};

/** Tüm olay tipleri (istemci EventSource adlandırılmış dinleyicileri + ayrıştırma beyaz listesi). */
export const REALTIME_EVENT_TYPES: readonly string[] = [...Object.values(ORDER_EVENT_BY_STATUS), "STATION_TICKET_UPDATED", ...Object.values(SERVICE_EVENT_BY_STATUS)];

export function envelope<E extends StaffEvent | CustomerEvent>(event: E, now = new Date()): RealtimeEnvelope<E> {
  return { version: REALTIME_EVENT_VERSION, occurredAt: now.toISOString(), ...event };
}

/** SSE çerçevesi. `id` yalnızca sıra bilgisidir (yeniden oynatma yok). */
export function formatSse(envelope: RealtimeEnvelope, id?: number): string {
  return `${id !== undefined ? `id: ${id}\n` : ""}event: ${envelope.type}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/** Vekil sunucular bağlantıyı kesmesin diye yorum satırı (iş olayı DEĞİLDİR). */
export const SSE_HEARTBEAT = ": ping\n\n";

const KNOWN = new Set<string>(REALTIME_EVENT_TYPES);

/** İstemcide güvenli ayrıştırma: bilinmeyen sürüm / tip yok sayılır. */
export function parseEnvelope(raw: string): RealtimeEnvelope | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const v = value as { version?: unknown; type?: unknown; occurredAt?: unknown; data?: unknown };
    if (v.version !== REALTIME_EVENT_VERSION || typeof v.type !== "string" || !KNOWN.has(v.type) || typeof v.occurredAt !== "string" || !v.data || typeof v.data !== "object") return null;
    return value as RealtimeEnvelope;
  } catch {
    return null;
  }
}

/** Yeniden bağlanma gecikmesi: 1 sn → 2 → 4 … en fazla 30 sn (+%20 rastgele sapma; sunucu dövülmez). */
export function reconnectDelay(attempt: number, random = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

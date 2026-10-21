import "server-only";
import { envelope, ORDER_EVENT_BY_STATUS, SERVICE_EVENT_BY_STATUS, type CustomerEvent, type StaffEvent } from "@/lib/realtime/events";
import type { OrderStatus, ServiceRequestStatus, ServiceRequestType, TicketStatus } from "@prisma/client";
import { getRedis, namespace } from "@/lib/redis/client";
import { log } from "@/lib/observability/logger";
import { InMemoryProvider, RedisProvider, type RealtimeProvider } from "@/server/realtime/providers";

export type { RealtimeListener, RealtimeProvider } from "@/server/realtime/providers";

/**
 * Gerçek zamanlı olay yolu — sağlayıcı seçimi + kanal adları + yayın yardımcıları.
 *
 * REDIS_URL varsa RedisProvider (PM2 küme / birden çok sunucu: A sürecindeki sipariş, B sürecindeki mutfak ekranına
 * ulaşır), yoksa InMemoryProvider (tek süreç). Seçim süreç başına bir kez yapılır (globalThis'te tekil).
 *
 * Kanallar YALNIZCA sunucuda, güvenilir bağlamdan üretilir (tarayıcı kanal adı / kiracı kimliği gönderemez; SSE uçları
 * kanalı oturumdan / doğrulanmış QR bağlamından seçer):
 *   tenant:<tenantId>:orders  → yetkili personel akışı (oturumdaki kiracı)
 *   order:<orderId>           → tek siparişin müşteri akışı (QR masa bağlamı + public kimlik + 24 saat doğrulandıktan sonra)
 *   table:<tableId>           → masanın müşteri akışı (servis talepleri; QR masa bağlamı doğrulandıktan sonra)
 * Redis'teki karşılığı: mn:<namespace>:rt:<kanal>. İç kimlikler tarayıcıya giden olay gövdesine konmaz (bkz. events.ts).
 */
const KEY = Symbol.for("masanova.realtime.provider");
type GlobalWithBus = typeof globalThis & { [KEY]?: RealtimeProvider };

export function getRealtimeProvider(): RealtimeProvider {
  const g = globalThis as GlobalWithBus;
  if (g[KEY]) return g[KEY];
  const publisher = getRedis("command");
  const subscriber = getRedis("subscriber");
  g[KEY] = publisher && subscriber ? new RedisProvider(publisher, subscriber, namespace()) : new InMemoryProvider();
  return g[KEY];
}

/** Kapanışta: sağlayıcıyı bırak (Redis bağlantıları ayrıca closeRedis ile kapanır). */
export async function closeRealtimeProvider(): Promise<void> {
  const g = globalThis as GlobalWithBus;
  const provider = g[KEY];
  g[KEY] = undefined;
  await provider?.close();
}

export const tenantOrdersChannel = (tenantId: string) => `tenant:${tenantId}:orders`;
export const orderChannel = (orderId: string) => `order:${orderId}`;
export const tableChannel = (tableId: string) => `table:${tableId}`;

// ─── Yayın yardımcıları (servisler transaction SONRASI çağırır) ─────────────

export type OrderRef = { tenantId: string; orderId: string; orderNumber: number; tableName?: string; itemCount?: number };

export function publishOrderStatus(order: OrderRef, status: OrderStatus): void {
  const bus = getRealtimeProvider();
  log.debug("realtime.order_event", { tenant: order.tenantId, orderNumber: order.orderNumber, status, provider: bus.name });
  const type = ORDER_EVENT_BY_STATUS[status];
  bus.publish(tenantOrdersChannel(order.tenantId), envelope<StaffEvent>({ type, data: { orderId: order.orderId, orderNumber: order.orderNumber, status, ...(order.tableName ? { tableName: order.tableName } : {}), ...(order.itemCount ? { itemCount: order.itemCount } : {}) } }));
  // Müşteri olayı: kimlik yok, yalnızca durum.
  bus.publish(orderChannel(order.orderId), envelope<CustomerEvent>({ type, data: { status } }));
}

export function publishTicketUpdate(order: OrderRef, ticket: { ticketId: string; stationId: string; status: TicketStatus }): void {
  getRealtimeProvider().publish(
    tenantOrdersChannel(order.tenantId),
    envelope<StaffEvent>({ type: "STATION_TICKET_UPDATED", data: { orderId: order.orderId, orderNumber: order.orderNumber, ticketId: ticket.ticketId, stationId: ticket.stationId, status: ticket.status } }),
  );
}

export type ServiceRequestRef = { tenantId: string; tableId: string; requestId: string; kind: ServiceRequestType };

/** Servis talebi: personele kiracı kanalından (talep kimliği + tip + durum), masaya yalnızca tip + durum. */
export function publishServiceRequest(ref: ServiceRequestRef, status: ServiceRequestStatus): void {
  const bus = getRealtimeProvider();
  const type = SERVICE_EVENT_BY_STATUS[status];
  bus.publish(tenantOrdersChannel(ref.tenantId), envelope<StaffEvent>({ type, data: { requestId: ref.requestId, kind: ref.kind, status } }));
  bus.publish(tableChannel(ref.tableId), envelope<CustomerEvent>({ type, data: { kind: ref.kind, status } }));
}

/** Transaction içinde toplanıp commit sonrası yayınlanacak olaylar (geri alınan işlem olay üretmez). */
export type PendingEvent = { kind: "order"; order: OrderRef; status: OrderStatus } | { kind: "ticket"; order: OrderRef; ticketId: string; stationId: string; status: TicketStatus };

export function flushEvents(events: readonly PendingEvent[]): void {
  for (const e of events) {
    if (e.kind === "order") publishOrderStatus(e.order, e.status);
    else publishTicketUpdate(e.order, { ticketId: e.ticketId, stationId: e.stationId, status: e.status });
  }
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_URGENCY, formatElapsed, planTicketRouting, urgencyFor, type RoutingStation } from "@/lib/orders/routing";
import { canStaffTransition, canStaffTransitionTicket, canSystemTransition, canTransitionOrderStatus, deriveOrderStatus, ORDER_TRANSITIONS, STAFF_TRANSITION_PERMISSION } from "@/lib/orders/status";
import { envelope, formatSse, parseEnvelope, reconnectDelay, REALTIME_EVENT_VERSION, SSE_HEARTBEAT } from "@/lib/realtime/events";
import { arItems, orderStrings } from "@/lib/public-menu/i18n-order";
import { flushEvents, getRealtimeProvider, orderChannel, publishOrderStatus, tenantOrdersChannel } from "@/server/realtime/bus";
import { createSseResponse } from "@/server/realtime/sse";

/** Sprint 7 — durum makinesi, fiş yönlendirme, otomatik durum, olay sözleşmesi, olay yolu, SSE, aciliyet, dil. */

describe("sipariş yaşam döngüsü", () => {
  it("ana yol SUBMITTED → ACCEPTED → PREPARING → READY → SERVED; geri dönüş yok", () => {
    expect(canTransitionOrderStatus("SUBMITTED", "ACCEPTED")).toBe(true);
    expect(canTransitionOrderStatus("ACCEPTED", "PREPARING")).toBe(true);
    expect(canTransitionOrderStatus("PREPARING", "READY")).toBe(true);
    expect(canTransitionOrderStatus("READY", "SERVED")).toBe(true);
    expect(canTransitionOrderStatus("READY", "PREPARING")).toBe(false);
    expect(canTransitionOrderStatus("SERVED", "READY")).toBe(false);
    expect(canTransitionOrderStatus("SUBMITTED", "CANCELLED")).toBe(false);
    for (const t of ["SERVED", "CANCELLED", "REJECTED"] as const) expect(ORDER_TRANSITIONS[t]).toEqual([]);
  });

  it("personel: kabul / ret / servis / iptal; PREPARING ve READY yalnızca sistem", () => {
    expect(canStaffTransition("READY", "SERVED")).toBe(true);
    expect(canStaffTransition("ACCEPTED", "CANCELLED")).toBe(true);
    expect(canStaffTransition("PREPARING", "CANCELLED")).toBe(true);
    expect(canStaffTransition("READY", "CANCELLED")).toBe(false);
    expect(canStaffTransition("ACCEPTED", "PREPARING")).toBe(false);
    expect(canStaffTransition("PREPARING", "READY")).toBe(false);
    expect(canSystemTransition("ACCEPTED", "PREPARING")).toBe(true);
    expect(canSystemTransition("PREPARING", "READY")).toBe(true);
    expect(canSystemTransition("READY", "SERVED")).toBe(false);
    expect(STAFF_TRANSITION_PERMISSION).toEqual({ ACCEPTED: "orders.manage", REJECTED: "orders.manage", SERVED: "orders.serve", CANCELLED: "orders.cancel" });
  });

  it("fiş geçişleri: PENDING → PREPARING → READY (atlama / geri dönüş yok)", () => {
    expect(canStaffTransitionTicket("PENDING", "PREPARING")).toBe(true);
    expect(canStaffTransitionTicket("PREPARING", "READY")).toBe(true);
    expect(canStaffTransitionTicket("PENDING", "READY")).toBe(false);
    expect(canStaffTransitionTicket("READY", "PREPARING")).toBe(false);
    expect(canStaffTransitionTicket("PENDING", "CANCELLED")).toBe(false);
  });

  it("otomatik durum: ilk başlayan fiş → PREPARING; bir istasyon hazır yetmez; tümü hazır → READY; iptal fişler sayılmaz", () => {
    expect(deriveOrderStatus("ACCEPTED", [{ status: "PENDING" }, { status: "PENDING" }])).toBeNull();
    expect(deriveOrderStatus("ACCEPTED", [{ status: "PREPARING" }, { status: "PENDING" }])).toBe("PREPARING");
    expect(deriveOrderStatus("PREPARING", [{ status: "READY" }, { status: "PREPARING" }])).toBeNull();
    expect(deriveOrderStatus("PREPARING", [{ status: "READY" }, { status: "READY" }])).toBe("READY");
    expect(deriveOrderStatus("ACCEPTED", [{ status: "READY" }])).toBe("READY");
    expect(deriveOrderStatus("PREPARING", [{ status: "READY" }, { status: "CANCELLED" }])).toBe("READY");
    expect(deriveOrderStatus("READY", [{ status: "READY" }])).toBeNull(); // tek kez
    expect(deriveOrderStatus("CANCELLED", [{ status: "READY" }])).toBeNull();
    expect(deriveOrderStatus("ACCEPTED", [])).toBeNull();
  });
});

describe("istasyon yönlendirmesi", () => {
  const kitchen: RoutingStation = { id: "k", name: "Mutfak", type: "KITCHEN", active: true };
  const bar: RoutingStation = { id: "b", name: "Bar", type: "BAR", active: true };
  const grill: RoutingStation = { id: "g", name: "Izgara", type: "GRILL", active: true };
  const items = [
    { id: "i1", productId: "burger", name: "Burger" },
    { id: "i2", productId: "ayran", name: "Ayran" },
    { id: "i3", productId: "salata", name: "Salata" },
  ];

  it("atama → istasyon; atamasız → varsayılan; istasyon başına tek fiş", () => {
    const plan = planTicketRouting({ items, assignments: new Map([["ayran", [bar]]]), defaultStation: kitchen });
    expect(plan.unrouted).toEqual([]);
    expect(plan.tickets.map((t) => [t.station.id, t.itemIds])).toEqual([
      ["k", ["i1", "i3"]],
      ["b", ["i2"]],
    ]);
  });

  it("çoklu atama: kalem her istasyona gider; ekstralar ayrı fiş oluşturmaz", () => {
    const plan = planTicketRouting({ items: [items[0]!], assignments: new Map([["burger", [grill, kitchen]]]), defaultStation: kitchen });
    expect(plan.tickets.map((t) => [t.station.id, t.itemIds])).toEqual([
      ["g", ["i1"]],
      ["k", ["i1"]],
    ]);
  });

  it("pasif atama varsayılana düşer; varsayılan yok / pasif → yönlendirilemeyen (sessizce kaybolmaz)", () => {
    const inactiveBar = { ...bar, active: false };
    expect(planTicketRouting({ items: [items[1]!], assignments: new Map([["ayran", [inactiveBar]]]), defaultStation: kitchen }).tickets[0]!.station.id).toBe("k");
    const none = planTicketRouting({ items, assignments: new Map([["ayran", [bar]]]), defaultStation: null });
    expect(none.unrouted.map((i) => i.id)).toEqual(["i1", "i3"]);
    expect(planTicketRouting({ items, assignments: new Map(), defaultStation: { ...kitchen, active: false } }).unrouted).toHaveLength(3);
    // Ürünü arşivlenmiş / silinmiş kalem (productId yok) yine varsayılana gider.
    expect(planTicketRouting({ items: [{ id: "x", productId: null, name: "Eski" }], assignments: new Map(), defaultStation: kitchen }).tickets).toHaveLength(1);
  });
});

describe("KDS aciliyeti ve süre", () => {
  it("10 dk uyarı, 20 dk kritik", () => {
    expect(DEFAULT_URGENCY).toEqual({ warningMinutes: 10, criticalMinutes: 20 });
    expect(urgencyFor(9 * 60_000 + 59_000)).toBe("normal");
    expect(urgencyFor(10 * 60_000)).toBe("warning");
    expect(urgencyFor(20 * 60_000)).toBe("critical");
    expect(urgencyFor(5 * 60_000, { warningMinutes: 3, criticalMinutes: 6 })).toBe("warning");
  });
  it("süre biçimi", () => {
    expect(formatElapsed(222_000)).toBe("03:42");
    expect(formatElapsed(738_000)).toBe("12:18");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
    expect(formatElapsed(-5)).toBe("00:00");
  });
});

describe("olay sözleşmesi", () => {
  it("zarf sürümlü, tipli, ISO zamanlı; SSE çerçevesi", () => {
    const e = envelope({ type: "ORDER_READY", data: { orderId: "o1", orderNumber: 1042, status: "READY" } }, new Date("2026-10-10T10:00:00Z"));
    expect(e).toEqual({ version: REALTIME_EVENT_VERSION, occurredAt: "2026-10-10T10:00:00.000Z", type: "ORDER_READY", data: { orderId: "o1", orderNumber: 1042, status: "READY" } });
    const frame = formatSse(e, 7);
    expect(frame).toBe(`id: 7\nevent: ORDER_READY\ndata: ${JSON.stringify(e)}\n\n`);
    expect(SSE_HEARTBEAT.startsWith(":")).toBe(true); // yorum satırı — iş olayı değil
    expect(parseEnvelope(JSON.stringify(e))).toEqual(e);
  });

  it("bilinmeyen sürüm / tip / bozuk veri yok sayılır", () => {
    const base = { version: 1, occurredAt: "x", type: "ORDER_READY", data: {} };
    expect(parseEnvelope("{bozuk")).toBeNull();
    expect(parseEnvelope(JSON.stringify({ ...base, version: 2 }))).toBeNull();
    expect(parseEnvelope(JSON.stringify({ ...base, type: "DROP_TABLE" }))).toBeNull();
    expect(parseEnvelope(JSON.stringify({ ...base, data: null }))).toBeNull();
    expect(parseEnvelope("null")).toBeNull();
  });

  it("yeniden bağlanma: üstel, 30 sn tavanlı, sapmalı", () => {
    expect(reconnectDelay(0, () => 0.5)).toBe(1000);
    expect(reconnectDelay(1, () => 0.5)).toBe(2000);
    expect(reconnectDelay(3, () => 0.5)).toBe(8000);
    expect(reconnectDelay(20, () => 0.5)).toBe(30_000);
    expect(reconnectDelay(20, () => 1)).toBe(36_000);
    expect(reconnectDelay(0, () => 0)).toBe(800);
  });
});

describe("olay yolu (bellek içi sağlayıcı)", () => {
  const bus = getRealtimeProvider();

  it("kiracı kanalları izole; müşteri olayı kimlik taşımaz; abonelik bırakılınca temizlenir", () => {
    const a = vi.fn();
    const b = vi.fn();
    const customer = vi.fn();
    const offA = bus.subscribe(tenantOrdersChannel("tenantA"), a);
    const offB = bus.subscribe(tenantOrdersChannel("tenantB"), b);
    const offC = bus.subscribe(orderChannel("orderA1"), customer);
    publishOrderStatus({ tenantId: "tenantA", orderId: "orderA1", orderNumber: 1001 }, "READY");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(a.mock.calls[0]![0]).toMatchObject({ type: "ORDER_READY", data: { orderId: "orderA1", orderNumber: 1001, status: "READY" } });
    expect(customer.mock.calls[0]![0].data).toEqual({ status: "READY" });
    offA();
    offB();
    offC();
    expect(bus.listenerCount(tenantOrdersChannel("tenantA"))).toBe(0);
    expect(bus.listenerCount(orderChannel("orderA1"))).toBe(0);
  });

  it("tek örnek (globalThis) ve hatalı dinleyici diğerlerini durdurmaz; flushEvents sırayla yayınlar", () => {
    expect(getRealtimeProvider()).toBe(bus);
    const bad = vi.fn(() => {
      throw new Error("x");
    });
    const good = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const off1 = bus.subscribe(tenantOrdersChannel("t"), bad);
    const off2 = bus.subscribe(tenantOrdersChannel("t"), good);
    const ref = { tenantId: "t", orderId: "o", orderNumber: 1 };
    flushEvents([
      { kind: "order", order: ref, status: "ACCEPTED" },
      { kind: "ticket", order: ref, ticketId: "tk", stationId: "st", status: "PENDING" },
    ]);
    expect(good.mock.calls.map((c) => c[0].type)).toEqual(["ORDER_ACCEPTED", "STATION_TICKET_UPDATED"]);
    off1();
    off2();
    error.mockRestore();
  });
});

describe("SSE yanıtı", () => {
  afterEach(() => vi.useRealTimers());

  async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
  }

  it("başlıklar, açılış, olay teslimi; istemci ayrılınca abonelik temizlenir", async () => {
    const controller = new AbortController();
    const channel = tenantOrdersChannel("sse-tenant");
    const res = createSseResponse({ request: new Request("http://x/panel/olaylar", { signal: controller.signal }), channels: [channel] });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const reader = res.body!.getReader();
    expect(await readChunk(reader)).toContain(": connected");
    expect(getRealtimeProvider().listenerCount(channel)).toBe(1);
    publishOrderStatus({ tenantId: "sse-tenant", orderId: "o", orderNumber: 1002 }, "SERVED");
    const frame = await readChunk(reader);
    expect(frame).toContain("event: ORDER_SERVED");
    expect(frame).toContain('"orderNumber":1002');
    controller.abort();
    expect(getRealtimeProvider().listenerCount(channel)).toBe(0);
  });

  it("heartbeat yorum satırıdır; yetki düşünce akış kapanır", async () => {
    vi.useFakeTimers();
    let allowed = true;
    const channel = orderChannel("sse-order");
    const res = createSseResponse({ request: new Request("http://x"), channels: [channel], heartbeatMs: 1000, stillAuthorized: async () => allowed });
    const reader = res.body!.getReader();
    await readChunk(reader);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await readChunk(reader)).toBe(SSE_HEARTBEAT);
    allowed = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect((await reader.read()).done).toBe(true);
    expect(getRealtimeProvider().listenerCount(channel)).toBe(0);
  });

  it("azami ömür dolunca kapanır (istemci yeniden bağlanıp yetkiyi tazeler)", async () => {
    vi.useFakeTimers();
    const channel = orderChannel("sse-life");
    const res = createSseResponse({ request: new Request("http://x"), channels: [channel], maxLifetimeMs: 5000 });
    const reader = res.body!.getReader();
    await readChunk(reader);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await reader.read()).done).toBe(true);
    expect(getRealtimeProvider().listenerCount(channel)).toBe(0);
  });
});

describe("müşteri canlı durum metinleri", () => {
  it("tüm dillerde hazır / hazırlanıyor / iptal ve bağlantı metni", () => {
    expect(orderStrings("tr").status.READY).toBe("Siparişiniz hazır");
    expect(orderStrings("en").status.READY).toBe("Your order is ready");
    expect(orderStrings("de").status.READY).toBe("Ihre Bestellung ist fertig");
    expect(orderStrings("ar").status.READY).toBe("طلبك جاهز");
    for (const l of ["tr", "en", "de", "ar"]) {
      const o = orderStrings(l);
      expect(o.liveReconnecting.length).toBeGreaterThan(3);
      for (const s of ["SUBMITTED", "ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED", "REJECTED"] as const) expect(o.status[s]).toBeTruthy();
    }
  });

  it("Arapça sayı uyumu", () => {
    expect(arItems(1)).toBe("منتج واحد");
    expect(arItems(2)).toBe("منتجان");
    expect(arItems(3)).toBe("3 منتجات");
    expect(arItems(10)).toBe("10 منتجات");
    expect(arItems(11)).toBe("11 منتجًا");
    expect(arItems(100)).toBe("100 منتج");
    expect(orderStrings("ar").cartBar(2, "₺1")).toContain("منتجان");
  });
});

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OrderContext } from "@/server/services/orders/submit-order.service";
import type { RealtimeEnvelope } from "@/lib/realtime/events";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { submitOrder } = await import("@/server/services/orders/submit-order.service");
const { acceptOrder, rejectOrder, serveOrder, cancelOrder, transitionTicket } = await import("@/server/services/orders/order-status.service");
const stations = await import("@/server/services/kds/station.service");
const { listKdsTickets, listOrderTickets } = await import("@/server/repositories/kds.repository");
const { findPublicOrderStreamRef } = await import("@/server/repositories/orders.repository");
const { getRealtimeProvider, orderChannel, tenantOrdersChannel } = await import("@/server/realtime/bus");

/**
 * Sprint 7 — istasyonlar, fiş üretimi, KDS yaşam döngüsü, otomatik durum, eşzamanlılık, kiracı izolasyonu ve
 * gerçek zamanlı olaylar. Gerçek PostgreSQL (Neon); iki geçici kiracı, sonunda silinir.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };

async function makeTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `KDS ${label} ${run}`,
      slug: `kds-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr" } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }, { name: "Kadıköy", slug: "kadikoy" }] },
      users: { create: { email: `kds-${label}-${run}@masanovai.test`, firstName: "K", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, branches: { orderBy: { slug: "desc" }, select: { id: true } }, users: { select: { id: true } } },
  });
  const tenantId = tenant.id;
  const [merkez, kadikoy] = tenant.branches as [{ id: string }, { id: string }];
  const category = await prisma.menuCategory.create({ data: { tenantId, name: "Menü", slug: "menu" } });
  const burger = await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Burger", slug: "burger", basePriceMinor: 30000 } });
  const ayran = await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Ayran", slug: "ayran", basePriceMinor: 5000 } });
  const mkTable = async (branchId: string, name: string) => {
    const table = await prisma.diningTable.create({ data: { tenantId, branchId, name } });
    const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
    const ctx: OrderContext = { tenantId, branchId, tableId: table.id, tokenId: token.id, branchName: branchId === merkez.id ? "Merkez" : "Kadıköy", tableName: name, areaName: null, defaultLocale: "tr" };
    return ctx;
  };
  const userId = tenant.users[0]!.id;
  return {
    tenantId,
    userId,
    scope: createTenantScope(tenantId),
    actor: { userId, scope: createTenantScope(tenantId), meta },
    merkez: merkez.id,
    kadikoy: kadikoy.id,
    burger: burger.id,
    ayran: ayran.id,
    t1: await mkTable(merkez.id, "Masa 1"),
    t2: await mkTable(kadikoy.id, "Masa 2"),
  };
}

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;
let kitchen: string;
let bar: string;

beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
});

afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  expect(await prisma.preparationStation.count({ where: { tenantId: { in: ids } } })).toBe(0);
  expect(await prisma.orderTicket.count({ where: { tenantId: { in: ids } } })).toBe(0);
});

const items = (lines: { product: string; quantity?: number; price: number }[]) =>
  submitOrderSchema.parse({
    items: lines.map((l) => ({ product: l.product, variant: null, modifiers: [], quantity: l.quantity ?? 1, note: null, expectedUnitPriceMinor: l.price })),
    note: null,
    idempotencyKey: randomBytes(18).toString("base64url"),
    locale: "tr",
  });

async function placeOrder(f: typeof A, ctx = f.t1, lines = [{ product: "burger", price: 30000 }, { product: "ayran", quantity: 2, price: 5000 }]) {
  const res = await submitOrder(ctx, items(lines));
  if (res.kind !== "created") throw new Error(`order not created: ${res.kind}`);
  const order = await prisma.order.findUniqueOrThrow({ where: { publicId: res.order.publicId }, select: { id: true, publicId: true, orderNumber: true } });
  return order;
}

function capture(channel: string) {
  const events: RealtimeEnvelope[] = [];
  const off = getRealtimeProvider().subscribe(channel, (e) => events.push(e));
  return { events, off };
}

describe("istasyonlar", () => {
  it("1. oluşturma + varsayılan; şube içinde ad benzersiz; denetim", async () => {
    const k = await stations.createStation(A.actor, A.merkez, { name: "Mutfak", type: "KITCHEN", active: true, isDefault: true });
    const b = await stations.createStation(A.actor, A.merkez, { name: "Bar", type: "BAR", active: true, isDefault: false });
    expect(k.ok && b.ok).toBe(true);
    kitchen = k.ok ? k.data.id : "";
    bar = b.ok ? b.data.id : "";
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: A.merkez } })).defaultStationId).toBe(kitchen);
    expect(await stations.createStation(A.actor, A.merkez, { name: "Bar", type: "BAR", active: true, isDefault: false })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    // Aynı ad başka şubede serbest.
    expect((await stations.createStation(A.actor, A.kadikoy, { name: "Bar", type: "BAR", active: true, isDefault: false })).ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "STATION_CREATED" } })).toBe(3);
  });

  it("2. şube başına en fazla bir varsayılan; pasifleştirme varsayılanı kaldırır; pasif varsayılan yapılamaz", async () => {
    await stations.setDefaultStation(A.actor, bar);
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: A.merkez } })).defaultStationId).toBe(bar);
    await stations.setDefaultStation(A.actor, kitchen);
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: A.merkez } })).defaultStationId).toBe(kitchen);
    const res = await stations.setStationActive(A.actor, kitchen, false);
    expect(res).toMatchObject({ ok: true, message: expect.stringContaining("varsayılan") });
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: A.merkez } })).defaultStationId).toBeNull();
    expect(await stations.setDefaultStation(A.actor, kitchen)).toMatchObject({ ok: false });
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "STATION_DEACTIVATED", entityId: kitchen } })).toBe(1);
    await stations.setStationActive(A.actor, kitchen, true);
    await stations.setDefaultStation(A.actor, kitchen);
  });

  it("3. kiracılar arası: B, A'nın istasyonunu / ürününü değiştiremez; başka şubenin istasyonu atanamaz; bileşik FK", async () => {
    expect(await stations.updateStation(B.actor, bar, { name: "Ele geçir", type: "BAR", active: false, isDefault: true })).toMatchObject({ ok: false, error: "İstasyon bulunamadı." });
    expect(await stations.setDefaultStation(B.actor, bar)).toMatchObject({ ok: false });
    expect(await stations.setProductStations(B.actor, A.ayran, A.merkez, [bar])).toMatchObject({ ok: false });
    // A'nın Kadıköy istasyonu Merkez ürün atamasında kullanılamaz.
    const kadikoyBar = await prisma.preparationStation.findFirstOrThrow({ where: { branchId: A.kadikoy, name: "Bar" } });
    expect(await stations.setProductStations(A.actor, A.ayran, A.merkez, [kadikoyBar.id])).toMatchObject({ ok: false });
    // Veritabanı da reddeder (servis atlansa bile).
    await expect(prisma.productPreparationStation.create({ data: { tenantId: A.tenantId, branchId: A.merkez, productId: A.ayran, stationId: kadikoyBar.id } })).rejects.toThrow();
    // Başka kiracının / şubenin istasyonu varsayılan yapılamaz (bileşik FK) ve şube kolonu kendi id'sinden farklı olamaz (CHECK).
    await expect(prisma.branch.updateMany({ where: { id: B.merkez }, data: { defaultStationId: kitchen, defaultStationBranchId: B.merkez } })).rejects.toThrow();
    await expect(prisma.branch.updateMany({ where: { id: A.kadikoy }, data: { defaultStationId: kitchen, defaultStationBranchId: A.merkez } })).rejects.toThrow();
    await expect(prisma.branch.updateMany({ where: { id: A.kadikoy }, data: { defaultStationId: kitchen, defaultStationBranchId: A.kadikoy } })).rejects.toThrow();
    expect((await prisma.preparationStation.findUniqueOrThrow({ where: { id: bar } })).name).toBe("Bar");
  });

  it("4. ürün yönlendirmesi kaydedilir (şube başına), denetlenir", async () => {
    expect(await stations.setProductStations(A.actor, A.ayran, A.merkez, [bar])).toMatchObject({ ok: true });
    expect(await prisma.productPreparationStation.findMany({ where: { productId: A.ayran }, select: { stationId: true, branchId: true } })).toEqual([{ stationId: bar, branchId: A.merkez }]);
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "PRODUCT_STATIONS_UPDATED", entityId: A.ayran } })).toBe(1);
  });
});

describe("kabul ve fiş üretimi", () => {
  it("5. kabul fişleri atomik üretir (burger → Mutfak, ayran → Bar); istasyon adı kopyalanır; olaylar commit sonrası", async () => {
    const order = await placeOrder(A);
    const staff = capture(tenantOrdersChannel(A.tenantId));
    const other = capture(tenantOrdersChannel(B.tenantId));
    const customer = capture(orderChannel(order.id));
    expect(await acceptOrder(A.actor, order.id)).toMatchObject({ ok: true, message: expect.stringContaining("2 istasyon") });
    const tickets = await prisma.orderTicket.findMany({ where: { orderId: order.id }, include: { items: { include: { orderItem: true } } }, orderBy: { stationName: "asc" } });
    expect(tickets.map((t) => [t.stationName, t.stationType, t.status, t.items.map((i) => i.orderItem.productNameDefault)])).toEqual([
      ["Bar", "BAR", "PENDING", ["Ayran"]],
      ["Mutfak", "KITCHEN", "PENDING", ["Burger"]],
    ]);
    expect(staff.events.map((e) => e.type)).toEqual(["ORDER_ACCEPTED", "STATION_TICKET_UPDATED", "STATION_TICKET_UPDATED"]);
    expect(other.events).toHaveLength(0);
    expect(customer.events.map((e) => e.data)).toEqual([{ status: "ACCEPTED" }]);
    staff.off();
    other.off();
    customer.off();
  });

  it("6. yönlendirilemeyen ürün kabulü engeller (varsayılan yok); sipariş SUBMITTED kalır, fiş yok, olay yok", async () => {
    // Kadıköy: yalnızca "Bar" var, varsayılan yok; burger atamasız.
    const order = await placeOrder(A, A.t2, [{ product: "burger", price: 30000 }]);
    const staff = capture(tenantOrdersChannel(A.tenantId));
    expect(await acceptOrder(A.actor, order.id)).toMatchObject({ ok: false, error: expect.stringContaining("1 ürün için hazırlama istasyonu tanımlanmamış") });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SUBMITTED");
    expect(await prisma.orderTicket.count({ where: { orderId: order.id } })).toBe(0);
    expect(staff.events).toHaveLength(0);
    staff.off();
  });

  it("7. ret fiş üretmez; eşzamanlı kabul + ret → yalnızca biri, fişler tek kez", async () => {
    const r = await placeOrder(A);
    expect((await rejectOrder(A.actor, r.id, "Kapandı")).ok).toBe(true);
    expect(await prisma.orderTicket.count({ where: { orderId: r.id } })).toBe(0);
    const c = await placeOrder(A);
    const results = await Promise.all([acceptOrder(A.actor, c.id), acceptOrder(A.actor, c.id), rejectOrder(A.actor, c.id, null)]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    const status = (await prisma.order.findUniqueOrThrow({ where: { id: c.id } })).status;
    expect(await prisma.orderTicket.count({ where: { orderId: c.id } })).toBe(status === "ACCEPTED" ? 2 : 0);
  });
});

describe("KDS yaşam döngüsü ve otomatik durum", () => {
  let orderId: string;
  let kitchenTicket: string;
  let barTicket: string;

  beforeAll(async () => {
    const order = await placeOrder(A);
    orderId = order.id;
    await acceptOrder(A.actor, orderId);
    const tickets = await prisma.orderTicket.findMany({ where: { orderId }, select: { id: true, stationId: true } });
    kitchenTicket = tickets.find((t) => t.stationId === kitchen)!.id;
    barTicket = tickets.find((t) => t.stationId === bar)!.id;
  });

  it("8. ilk başlayan fiş → sipariş PREPARING (SİSTEM aktörü); atlama (PENDING → READY) reddedilir", async () => {
    expect(await transitionTicket(A.actor, kitchenTicket, "READY")).toMatchObject({ ok: false });
    const customer = capture(orderChannel(orderId));
    expect((await transitionTicket(A.actor, kitchenTicket, "PREPARING")).ok).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { history: { orderBy: { createdAt: "asc" } } } });
    expect(order.status).toBe("PREPARING");
    expect(order.preparingAt).not.toBeNull();
    expect(order.history.at(-1)).toMatchObject({ fromStatus: "ACCEPTED", toStatus: "PREPARING", actorType: "SYSTEM", actorUserId: null });
    expect(customer.events.map((e) => e.data)).toEqual([{ status: "PREPARING" }]);
    customer.off();
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "TICKET_PREPARING", entityId: kitchenTicket } })).toBe(1);
  });

  it("9. tek istasyonun bitmesi siparişi hazır yapmaz", async () => {
    expect((await transitionTicket(A.actor, kitchenTicket, "READY")).ok).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PREPARING");
    expect(await serveOrder(A.actor, orderId)).toMatchObject({ ok: false });
  });

  it("10. son fiş hazır → sipariş READY tek kez (eşzamanlı çift tıklama); geçmiş + denetim tek", async () => {
    await transitionTicket(A.actor, barTicket, "PREPARING");
    const results = await Promise.all([transitionTicket(A.actor, barTicket, "READY"), transitionTicket(A.actor, barTicket, "READY")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { history: true } });
    expect(order.status).toBe("READY");
    expect(order.history.filter((h) => h.toStatus === "READY")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "ORDER_READY", entityId: orderId } })).toBe(1);
  });

  it("11. iki istasyon aynı anda hazır → sipariş READY tam bir kez", async () => {
    const o = await placeOrder(A);
    await acceptOrder(A.actor, o.id);
    const tickets = await prisma.orderTicket.findMany({ where: { orderId: o.id }, select: { id: true } });
    for (const t of tickets) await transitionTicket(A.actor, t.id, "PREPARING");
    const staff = capture(tenantOrdersChannel(A.tenantId));
    const results = await Promise.all(tickets.map((t) => transitionTicket(A.actor, t.id, "READY")));
    expect(results.every((r) => r.ok)).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { history: true } });
    expect(order.status).toBe("READY");
    expect(order.history.filter((h) => h.toStatus === "READY")).toHaveLength(1);
    expect(staff.events.filter((e) => e.type === "ORDER_READY")).toHaveLength(1);
    staff.off();
  });

  it("12. servis: READY → SERVED; KDS'ten kalkar; tekrar servis edilemez", async () => {
    expect((await serveOrder(A.actor, orderId)).ok).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("SERVED");
    expect(order.servedAt).not.toBeNull();
    expect((await listKdsTickets(A.scope)).some((t) => t.order.id === orderId)).toBe(false);
    expect(await serveOrder(A.actor, orderId)).toMatchObject({ ok: false });
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "ORDER_SERVED", entityId: orderId } })).toBe(1);
  });

  it("13. iptal (PREPARING): neden saklanır, açık fişler iptal; iptal edilen siparişin fişi ilerletilemez; READY iptal edilemez", async () => {
    const o = await placeOrder(A);
    await acceptOrder(A.actor, o.id);
    const [t1] = await prisma.orderTicket.findMany({ where: { orderId: o.id }, select: { id: true } });
    await transitionTicket(A.actor, t1!.id, "PREPARING");
    expect((await cancelOrder(A.actor, o.id, "Müşteri vazgeçti")).ok).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: o.id }, include: { tickets: true } });
    expect(order).toMatchObject({ status: "CANCELLED", cancellationReason: "Müşteri vazgeçti" });
    expect(order.tickets.every((t) => t.status === "CANCELLED" && t.cancelledAt)).toBe(true);
    expect(await transitionTicket(A.actor, t1!.id, "READY")).toMatchObject({ ok: false });
    expect(await cancelOrder(A.actor, orderId, "geç")).toMatchObject({ ok: false }); // SERVED
  });
});

describe("izolasyon ve görünürlük", () => {
  it("14. B, A'nın siparişini kabul edemez / fişini ilerletemez / servis edemez; KDS listesi kiracıya özel", async () => {
    const o = await placeOrder(A);
    expect(await acceptOrder(B.actor, o.id)).toMatchObject({ ok: false, error: "Sipariş bulunamadı." });
    await acceptOrder(A.actor, o.id);
    const [ticket] = await prisma.orderTicket.findMany({ where: { orderId: o.id }, select: { id: true } });
    expect(await transitionTicket(B.actor, ticket!.id, "PREPARING")).toMatchObject({ ok: false, error: "Fiş bulunamadı." });
    expect(await cancelOrder(B.actor, o.id, "kötü niyet")).toMatchObject({ ok: false });
    expect((await prisma.orderTicket.findUniqueOrThrow({ where: { id: ticket!.id } })).status).toBe("PENDING");
    expect(await listKdsTickets(B.scope)).toEqual([]);
    expect(await listOrderTickets(B.scope, o.id)).toEqual([]);
    expect((await listKdsTickets(A.scope)).some((t) => t.id === ticket!.id)).toBe(true);
  });

  it("15. istasyon yeniden adlandırılsa da geçmiş fiş kopyası değişmez", async () => {
    const before = await prisma.orderTicket.findFirstOrThrow({ where: { stationId: bar }, select: { id: true } });
    await stations.updateStation(A.actor, bar, { name: "İçecek Bar", type: "BAR", active: true, isDefault: false });
    expect((await prisma.orderTicket.findUniqueOrThrow({ where: { id: before.id } })).stationName).toBe("Bar");
  });

  it("16. müşteri akışı referansı: aynı kiracı + aynı masa + 24 saat; başka masa / kiracı / eski sipariş yok", async () => {
    const o = await placeOrder(A);
    expect((await findPublicOrderStreamRef({ tenantId: A.tenantId, tableId: A.t1.tableId }, o.publicId))?.id).toBe(o.id);
    expect(await findPublicOrderStreamRef({ tenantId: A.tenantId, tableId: A.t2.tableId }, o.publicId)).toBeNull();
    expect(await findPublicOrderStreamRef({ tenantId: B.tenantId, tableId: A.t1.tableId }, o.publicId)).toBeNull();
    expect(await findPublicOrderStreamRef({ tenantId: A.tenantId, tableId: A.t1.tableId }, o.publicId, new Date(Date.now() + 25 * 3_600_000))).toBeNull();
  });

  it("17. olaylar sırdan arındırılmış: QR token / public kimlik / fiyat / not yok; müşteri olayında iç kimlik yok", async () => {
    const o = await placeOrder(A);
    const staff = capture(tenantOrdersChannel(A.tenantId));
    const customer = capture(orderChannel(o.id));
    await acceptOrder(A.actor, o.id);
    const blob = JSON.stringify([...staff.events, ...customer.events]);
    expect(blob).not.toContain(o.publicId);
    expect(blob).not.toMatch(/token|Minor|price|note|tenantId/i);
    expect(JSON.stringify(customer.events)).not.toContain(o.id);
    staff.off();
    customer.off();
  });
});

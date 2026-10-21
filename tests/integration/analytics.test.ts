import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { resolveAnalyticsContext } = await import("@/server/analytics/filter");
const { computeSection } = await import("@/server/analytics/dashboard.service");
const { csvText, csvStream } = await import("@/server/analytics/csv.service");
const { clearAnalyticsCacheForTests } = await import("@/server/analytics/cache");

/**
 * Sprint 12 — analitik, gerçek PostgreSQL (Neon). Deterministik geçici veri (sabit "şimdi"), sonunda silinir.
 * Şimdi = 2026-06-15 18:00 İstanbul (15:00Z). "Bugün" = 2026-06-14T21:00Z … 2026-06-15T21:00Z.
 */
const NOW = new Date("2026-06-15T15:00:00Z");
const at = (iso: string) => new Date(iso);
const min = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);
const run = randomBytes(3).toString("hex");

type Fx = Awaited<ReturnType<typeof makeTenant>>;
let A: Fx;
let B: Fx;

async function makeTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Analitik ${label} ${run}`,
      slug: `an-${label}-${run}`,
      status: "ACTIVE",
      plan: "AI",
      settings: { create: { defaultLocale: "tr", timezone: "Europe/Istanbul", defaultCurrency: "TRY" } },
      branches: { create: [{ name: "Merkez", slug: "merkez", timezone: "Europe/Istanbul" }, { name: "Kadıköy", slug: "kadikoy", timezone: "Europe/Istanbul" }] },
    },
    select: { id: true, branches: { orderBy: { slug: "desc" }, select: { id: true, name: true } } },
  });
  const tenantId = tenant.id;
  const [merkez, kadikoy] = tenant.branches as [{ id: string; name: string }, { id: string; name: string }];
  const bahce = await prisma.diningArea.create({ data: { tenantId, branchId: merkez.id, name: "Bahçe", slug: "bahce" } });
  const salon = await prisma.diningArea.create({ data: { tenantId, branchId: merkez.id, name: "İç Salon", slug: "ic-salon" } });
  const t1 = await prisma.diningTable.create({ data: { tenantId, branchId: merkez.id, diningAreaId: bahce.id, name: "Masa 1" } });
  const t2 = await prisma.diningTable.create({ data: { tenantId, branchId: merkez.id, diningAreaId: salon.id, name: "Masa 2" } });
  const t3 = await prisma.diningTable.create({ data: { tenantId, branchId: kadikoy.id, name: "K1" } });
  await prisma.tableQrToken.create({ data: { tenantId, branchId: merkez.id, tableId: t1.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url"), scanCount: 42 } });
  const mutfak = await prisma.preparationStation.create({ data: { tenantId, branchId: merkez.id, name: "Mutfak", type: "KITCHEN" } });
  const bar = await prisma.preparationStation.create({ data: { tenantId, branchId: merkez.id, name: "Bar", type: "BAR" } });
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Burgerler", slug: "burgerler" } });
  const drinks = await prisma.menuCategory.create({ data: { tenantId, name: "İçecekler", slug: "icecekler" } });
  const burger = await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Cheeseburger", slug: "cheeseburger", basePriceMinor: 30000 } });
  const ayran = await prisma.product.create({ data: { tenantId, categoryId: drinks.id, name: "Ayran", slug: "ayran", basePriceMinor: 5000 } });
  const kofte = await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Köfte", slug: "kofte", basePriceMinor: 25000 } });
  const small = await prisma.productVariant.create({ data: { tenantId, productId: burger.id, name: "Küçük", priceMinor: 30000 } });
  const large = await prisma.productVariant.create({ data: { tenantId, productId: burger.id, name: "Büyük", priceMinor: 40000 } });
  const ekstra = await prisma.modifierGroup.create({ data: { tenantId, name: "Ekstra", minSelect: 0, maxSelect: 2 } });
  const cheddar = await prisma.modifier.create({ data: { tenantId, modifierGroupId: ekstra.id, name: "Cheddar", priceDeltaMinor: 3000 } });
  return { tenantId, scope: createTenantScope(tenantId), merkez, kadikoy, tables: { t1, t2, t3 }, areas: { bahce, salon }, stations: { mutfak, bar }, products: { burger, ayran, kofte }, variants: { small, large }, cheddar };
}

let seq = 1000;
type ItemSpec = { product: { id: string; name: string } | null; name: string; variant?: { id: string; name: string } | null; unit: number; qty: number; modifiers?: { id: string; group: string; name: string; delta: number }[] };

async function order(fx: Fx, spec: { table: { id: string; branchId: string; name: string }; areaName: string | null; at: Date; status: "SUBMITTED" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED" | "REJECTED" | "CANCELLED"; items: ItemSpec[]; accepted?: number; ready?: number; served?: number; branchName?: string; tableName?: string; tickets?: { station: { id: string; name: string; type: "KITCHEN" | "BAR" }; started: number; ready: number }[]; currency?: string }) {
  const total = spec.items.reduce((s, i) => s + i.unit * i.qty, 0);
  const created = spec.at;
  const acceptedAt = spec.accepted !== undefined ? min(created, spec.accepted) : null;
  const o = await prisma.order.create({
    data: {
      tenantId: fx.tenantId,
      branchId: spec.table.branchId,
      tableId: spec.table.id,
      publicId: randomBytes(16).toString("base64url"),
      orderNumber: ++seq,
      status: spec.status,
      currency: spec.currency ?? "TRY",
      subtotalMinor: total,
      totalMinor: total,
      itemCount: spec.items.reduce((s, i) => s + i.qty, 0),
      locale: "tr",
      branchName: spec.branchName ?? "Merkez",
      tableName: spec.tableName ?? spec.table.name,
      areaName: spec.areaName,
      idempotencyKeyHash: randomBytes(16).toString("hex"),
      requestHash: randomBytes(16).toString("hex"),
      submittedAt: created,
      createdAt: created,
      acceptedAt,
      preparingAt: acceptedAt && spec.ready !== undefined ? min(acceptedAt, 1) : null,
      readyAt: acceptedAt && spec.ready !== undefined ? min(acceptedAt, spec.ready) : null,
      servedAt: acceptedAt && spec.ready !== undefined && spec.served !== undefined ? min(min(acceptedAt, spec.ready), spec.served) : null,
      rejectedAt: spec.status === "REJECTED" ? min(created, 2) : null,
      cancelledAt: spec.status === "CANCELLED" ? min(created, 10) : null,
    },
  });
  let sort = 0;
  for (const it of spec.items) {
    const modTotal = (it.modifiers ?? []).reduce((s, m) => s + m.delta, 0);
    const item = await prisma.orderItem.create({
      data: { tenantId: fx.tenantId, orderId: o.id, productId: it.product?.id ?? null, variantId: it.variant?.id ?? null, productName: it.name, productNameDefault: it.name, variantName: it.variant?.name ?? null, basePriceMinor: it.unit - modTotal, modifiersTotalMinor: modTotal, unitPriceMinor: it.unit, quantity: it.qty, lineTotalMinor: it.unit * it.qty, note: "=HYPERLINK(\"http://evil\")", sortOrder: sort++ },
    });
    for (const m of it.modifiers ?? []) await prisma.orderItemModifier.create({ data: { tenantId: fx.tenantId, orderItemId: item.id, modifierId: m.id, groupName: m.group, modifierName: m.name, priceDeltaMinor: m.delta, sortOrder: 0 } });
  }
  for (const tk of spec.tickets ?? []) {
    await prisma.orderTicket.create({ data: { tenantId: fx.tenantId, branchId: spec.table.branchId, orderId: o.id, stationId: tk.station.id, stationName: tk.station.name, stationType: tk.station.type, status: "READY", createdAt: acceptedAt!, startedAt: min(acceptedAt!, tk.started), readyAt: min(acceptedAt!, tk.ready) } });
  }
  return o;
}

async function request(fx: Fx, spec: { table: { id: string; branchId: string; name: string }; areaId: string | null; areaName: string | null; type: "WAITER" | "WATER" | "NAPKIN" | "BILL" | "CUSTOM"; at: Date; ack?: number; done?: number; status: "OPEN" | "ACKNOWLEDGED" | "COMPLETED" | "CANCELLED"; tableName?: string }) {
  return prisma.tableServiceRequest.create({
    data: {
      tenantId: fx.tenantId,
      branchId: spec.table.branchId,
      tableId: spec.table.id,
      diningAreaId: spec.areaId,
      publicId: randomBytes(16).toString("base64url"),
      type: spec.type,
      status: spec.status,
      activeSlot: spec.status === "OPEN" || spec.status === "ACKNOWLEDGED" ? "ACTIVE" : null,
      note: spec.type === "CUSTOM" ? "Müşteri özel notu — dışa aktarılmamalı" : null,
      branchName: "Merkez",
      areaName: spec.areaName,
      tableName: spec.tableName ?? spec.table.name,
      createdAt: spec.at,
      acknowledgedAt: spec.ack !== undefined ? new Date(spec.at.getTime() + spec.ack * 1000) : null,
      completedAt: spec.done !== undefined ? new Date(spec.at.getTime() + spec.done * 1000) : null,
      acknowledgedByName: "Personel Adı Gizli",
    },
  });
}

const ctxFor = async (fx: Fx, input: Record<string, string | null> = {}) => {
  const r = await resolveAnalyticsContext(fx.scope, input, NOW);
  if (!r.ok) throw new Error(r.error);
  return r.context;
};

beforeAll(async () => {
  clearAnalyticsCacheForTests();
  A = await makeTenant("a");
  B = await makeTenant("b");
  const { t1, t2, t3 } = A.tables;
  const P = A.products;
  const burgerL = (qty: number, cheddar = false): ItemSpec => ({ product: { id: P.burger.id, name: "Cheeseburger" }, name: "Cheeseburger", variant: { id: A.variants.large.id, name: "Büyük" }, unit: 40000 + (cheddar ? 3000 : 0), qty, modifiers: cheddar ? [{ id: A.cheddar.id, group: "Ekstra", name: "Cheddar", delta: 3000 }] : [] });
  const burgerS = (qty: number): ItemSpec => ({ product: { id: P.burger.id, name: "Cheeseburger" }, name: "Cheeseburger", variant: { id: A.variants.small.id, name: "Küçük" }, unit: 30000, qty });
  const ayran = (qty: number): ItemSpec => ({ product: { id: P.ayran.id, name: "Ayran" }, name: "Ayran", unit: 5000, qty });

  // ── BUGÜN (İstanbul) ──
  // 1) 00:30 yerel (= 14 Haz 21:30Z — UTC'de DÜN): bugün sayılmalı
  await order(A, { table: t1, areaName: "Bahçe", at: at("2026-06-14T21:30:00Z"), status: "SERVED", items: [ayran(2)], accepted: 1, ready: 5, served: 2, tickets: [{ station: { ...A.stations.bar, type: "BAR" }, started: 1, ready: 4 }] });
  // 2) 10:00 yerel — iki istasyonlu sipariş (çok fişli), Büyük burger + cheddar
  await order(A, { table: t1, areaName: "Bahçe", at: at("2026-06-15T07:00:00Z"), status: "SERVED", items: [burgerL(2, true), ayran(1)], accepted: 2, ready: 15, served: 3, tickets: [{ station: { ...A.stations.mutfak, type: "KITCHEN" }, started: 1, ready: 14 }, { station: { ...A.stations.bar, type: "BAR" }, started: 1, ready: 3 }] });
  // 3) 12:00 yerel — İç Salon, Küçük burger, hazır (henüz servis yok)
  await order(A, { table: t2, areaName: "İç Salon", at: at("2026-06-15T09:00:00Z"), status: "READY", items: [burgerS(3)], accepted: 4, ready: 20, tickets: [{ station: { ...A.stations.mutfak, type: "KITCHEN" }, started: 2, ready: 18 }] });
  // 4) REDDEDİLEN (satışa dahil değil)
  await order(A, { table: t2, areaName: "İç Salon", at: at("2026-06-15T10:00:00Z"), status: "REJECTED", items: [burgerL(5)] });
  // 5) KABUL EDİLİP İPTAL EDİLEN (satışa dahil değil, hunide kabul + iptal)
  await order(A, { table: t1, areaName: "Bahçe", at: at("2026-06-15T10:30:00Z"), status: "CANCELLED", items: [burgerL(4)], accepted: 1 });
  // 6) Bekleyen (SUBMITTED; satışa dahil değil)
  await order(A, { table: t1, areaName: "Bahçe", at: at("2026-06-15T11:00:00Z"), status: "SUBMITTED", items: [ayran(9)] });
  // 7) Kadıköy şubesi — Köfte (şube filtresi)
  await order(A, { table: t3, areaName: null, at: at("2026-06-15T08:00:00Z"), status: "SERVED", items: [{ product: { id: P.kofte.id, name: "Köfte" }, name: "Köfte", unit: 25000, qty: 1 }], accepted: 1, ready: 10, served: 1, branchName: "Kadıköy" });
  // 8) Silinmiş ürün anlık görüntüsü (product_id null) — tarihsel satış korunur
  await order(A, { table: t2, areaName: "İç Salon", at: at("2026-06-15T09:30:00Z"), status: "ACCEPTED", items: [{ product: null, name: "Eski Limonata", unit: 6000, qty: 2 }], accepted: 3 });
  // 9) Farklı para birimi (toplanmaz)
  await order(A, { table: t1, areaName: "Bahçe", at: at("2026-06-15T09:45:00Z"), status: "SERVED", items: [ayran(1)], accepted: 1, ready: 2, served: 1, currency: "EUR" });

  // ── DÜN ──
  // 23:30 yerel (14 Haz 20:30Z) — dün; karşılaştırma penceresinin (18:00'e kadar) DIŞINDA
  await order(A, { table: t1, areaName: "Bahçe", at: at("2026-06-14T20:30:00Z"), status: "SERVED", items: [ayran(1)], accepted: 1, ready: 3, served: 1 });
  // 10:00 yerel dün — eski masa adıyla (yeniden adlandırma testi)
  await order(A, { table: t1, areaName: "Bahçe", at: at("2026-06-14T07:00:00Z"), status: "SERVED", items: [burgerS(1)], accepted: 1, ready: 8, served: 1, tableName: "Eski Masa 1" });

  // ── Servis talepleri (bugün) ──
  await request(A, { table: t1, areaId: A.areas.bahce.id, areaName: "Bahçe", type: "WAITER", at: at("2026-06-15T07:10:00Z"), ack: 60, done: 300, status: "COMPLETED" });
  await request(A, { table: t1, areaId: A.areas.bahce.id, areaName: "Bahçe", type: "WATER", at: at("2026-06-15T07:20:00Z"), ack: 120, done: 240, status: "COMPLETED" });
  await request(A, { table: t2, areaId: A.areas.salon.id, areaName: "İç Salon", type: "WAITER", at: at("2026-06-15T09:10:00Z"), ack: 180, status: "ACKNOWLEDGED" });
  await request(A, { table: t2, areaId: A.areas.salon.id, areaName: "İç Salon", type: "CUSTOM", at: at("2026-06-15T09:40:00Z"), status: "CANCELLED" });

  // ── AI (bugün) ──
  const conv = async (language: string, createdAt: Date) =>
    prisma.aiConversation.create({ data: { tenantId: A.tenantId, branchId: A.merkez.id, tableId: t1.id, publicId: randomBytes(16).toString("base64url"), proofHash: randomBytes(32).toString("hex"), uiLocale: "tr", conversationLanguage: language, createdAt, lastActivityAt: createdAt, expiresAt: min(createdAt, 360) } });
  const c1 = await conv("tr", at("2026-06-15T07:05:00Z"));
  const c2 = await conv("en", at("2026-06-15T08:05:00Z"));
  await conv("ar", at("2026-06-15T08:30:00Z"));
  const msg = (c: { id: string }, role: "USER" | "ASSISTANT", language: string, createdAt: Date, metadata?: object) =>
    prisma.aiMessage.create({ data: { tenantId: A.tenantId, conversationId: c.id, publicId: randomBytes(12).toString("base64url"), role, language, content: role === "USER" ? "GİZLİ MÜŞTERİ CÜMLESİ" : "Asistan yanıtı", createdAt, metadata } });
  await msg(c1, "USER", "tr", at("2026-06-15T07:06:00Z"));
  await msg(c1, "ASSISTANT", "tr", at("2026-06-15T07:06:01Z"), { actions: [{ kind: "cart_add" }, { kind: "service" }], products: [{ product: "x" }, { product: "y" }], recommendation: { items: [] } });
  await msg(c2, "USER", "en", at("2026-06-15T08:06:00Z"));
  await msg(c2, "USER", "tr", at("2026-06-15T08:07:00Z"));
  await msg(c2, "ASSISTANT", "en", at("2026-06-15T08:07:01Z"), { actions: [{ kind: "cart_add" }], products: [], recommendation: null });
  const turn = (c: { id: string }, mode: "REALTIME" | "FALLBACK", extra: object = {}) => prisma.aiTurn.create({ data: { tenantId: A.tenantId, conversationId: c.id, turnKey: randomBytes(16).toString("base64url"), mode, status: "COMPLETED", createdAt: at("2026-06-15T08:00:00Z"), audioInMs: 30_000, audioOutMs: 30_000, ...extra } });
  await turn(c1, "REALTIME", { attempts: 2, interruptedAt: at("2026-06-15T08:00:05Z") });
  await turn(c1, "REALTIME");
  await turn(c2, "FALLBACK");

  // ── Kiracı B: aynı gün büyük sipariş (A'ya sızmamalı) ──
  await order(B, { table: B.tables.t1, areaName: "Bahçe", at: at("2026-06-15T07:00:00Z"), status: "SERVED", items: [{ product: { id: B.products.ayran.id, name: "Ayran" }, name: "Ayran", unit: 999_900, qty: 1 }], accepted: 1, ready: 2, served: 1 });

  // Tarihsel anlık görüntü: ürün yeniden adlandırılır + arşivlenir, masa yeniden adlandırılır
  await prisma.product.update({ where: { id: A.products.burger.id }, data: { name: "Klasik Burger", archivedAt: new Date() } });
  await prisma.diningTable.update({ where: { id: t1.id }, data: { name: "Bahçe 1" } });
});

afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  expect(await prisma.order.count({ where: { tenantId: { in: ids } } })).toBe(0);
});

// Bugünkü satış siparişleri: #1 (2×5000=10000), #2 (2×43000 + 5000 = 91000), #3 (3×30000=90000), #7 Kadıköy (25000), #8 (12000)
const TODAY_SALES = 10_000 + 91_000 + 90_000 + 25_000 + 12_000;

describe("sipariş tutarı ve huni", () => {
  it("1–4. tutar toplamı; reddedilen / iptal / bekleyen / farklı para birimi HARİÇ; ortalama sepet", async () => {
    const o = await computeSection(await ctxFor(A, { range: "today" }), "overview");
    expect(o.kpis.salesMinor).toBe(TODAY_SALES);
    expect(o.kpis.salesOrders).toBe(5);
    expect(o.averageMinor).toBe(Math.round(TODAY_SALES / 5));
    expect(o.kpis.otherCurrencyOrders).toBe(1);
    expect(o.kpis.itemsSold).toBe(2 + 3 + 3 + 1 + 2);
    expect(o.kpis.activeTables).toBe(3); // Masa 1, Masa 2, K1
    // huni tüm para birimlerini sayar: servis edilen #1, #2, #7, #9 (EUR)
    expect(o.funnel).toMatchObject({ submitted: 9, pending: 1, accepted: 7, rejected: 1, cancelled: 1, served: 4 });
    expect(o.acceptanceRate).toBeCloseTo(7 / 8);
  });

  it("17. saat dilimi gün sınırı: 00:30 yerel (UTC'de dün) BUGÜN; 23:30 yerel dün DÜN", async () => {
    const y = await computeSection(await ctxFor(A, { range: "yesterday" }), "overview");
    expect(y.kpis.salesOrders).toBe(2);
    expect(y.kpis.salesMinor).toBe(5_000 + 30_000);
    const today = await computeSection(await ctxFor(A, { range: "today" }), "overview");
    expect(today.trend.find((b) => b.key === "2026-06-15 00")?.orders).toBe(1);
    expect(today.trend).toHaveLength(24);
  });

  it("19. karşılaştırma: bugün 18:00'e kadar ↔ dün 18:00'e kadar (23:30 siparişi dahil edilmez)", async () => {
    const o = await computeSection(await ctxFor(A, { range: "today" }), "overview");
    expect(o.previous.salesOrders).toBe(1);
    expect(o.previous.salesMinor).toBe(30_000);
    expect(o.comparisons.sales.diff).toBe(TODAY_SALES - 30_000);
    expect(o.comparisons.orders.pct).toBeNull(); // önceki dönem 1 sipariş → düşük veri, yüzde yok
    expect(o.comparisons.orders.lowData).toBe(true);
    const week = await computeSection(await ctxFor(A, { range: "last7" }), "overview");
    expect(week.kpis.salesOrders).toBe(7);
    expect(week.trend).toHaveLength(7);
  });
});

describe("ürün / menü", () => {
  it("5–6. ürün adetleri, varyant ve ekstra dağılımı (anlık görüntülerden)", async () => {
    const p = await computeSection(await ctxFor(A, { range: "today" }), "products");
    const burger = p.products.find((x) => x.key === A.products.burger.id)!;
    expect(burger.quantity).toBe(2 + 3);
    expect(burger.totalMinor).toBe(86_000 + 90_000);
    expect(burger.orders).toBe(2);
    const v = p.variants.find((g) => g.productKey === A.products.burger.id)!.variants;
    expect(Object.fromEntries(v.map((x) => [x.variant, x.quantity]))).toEqual({ Küçük: 3, Büyük: 2 });
    expect(p.modifiers).toEqual([expect.objectContaining({ group: "Ekstra", modifier: "Cheddar", selections: 2, orders: 1 })]);
    expect(p.categories.find((c) => c.name === "Burgerler")?.quantity).toBe(5 + 1);
  });

  it("18. tarihsel anlık görüntü: yeniden adlandırılan + arşivlenen ürün satışları korunur; silinen ürün anlık görüntü adıyla", async () => {
    const p = await computeSection(await ctxFor(A, { range: "today" }), "products");
    const burger = p.products.find((x) => x.key === A.products.burger.id)!;
    expect(burger).toMatchObject({ name: "Klasik Burger", formerName: "Cheeseburger", archived: true, deleted: false });
    const old = p.products.find((x) => x.name === "Eski Limonata")!;
    expect(old).toMatchObject({ deleted: true, quantity: 2, totalMinor: 12_000 });
    expect(p.categories.some((c) => c.name === null)).toBe(true); // silinen ürün → kategori bilinmiyor
  });
});

describe("masa / bölge", () => {
  it("7–8. masa ve bölge toplamları; masa güncel adı + sipariş anındaki eski ad; QR toplam tarama", async () => {
    const t = await computeSection(await ctxFor(A, { range: "last7" }), "tables");
    const t1 = t.tables.find((x) => x.tableId === A.tables.t1.id)!;
    expect(t1).toMatchObject({ name: "Bahçe 1", formerName: "Eski Masa 1", orders: 4, qrScansAllTime: 42, serviceRequests: 2 });
    expect(t1.totalMinor).toBe(10_000 + 91_000 + 5_000 + 30_000);
    const bahce = t.areas.find((a) => a.areaName === "Bahçe")!;
    expect(bahce).toMatchObject({ orders: 4, activeTables: 1, serviceRequests: 2 });
    const salon = t.areas.find((a) => a.areaName === "İç Salon")!;
    expect(salon).toMatchObject({ orders: 2, totalMinor: 102_000, serviceRequests: 2 });
  });
});

describe("mutfak (KDS)", () => {
  it("9–10. hazırlama süreleri ve çok fişli siparişte istasyon bazlı ölçüm", async () => {
    const k = await computeSection(await ctxFor(A, { range: "today", branch: A.merkez.id }), "operations");
    // Merkez TRY + EUR: hazırlama (ready − accepted) dk: #1 5, #2 15, #3 20, #9 2 → medyan 10
    expect(k.timings.preparation.count).toBe(4);
    expect(k.timings.preparation.medianMs).toBe(10 * 60_000);
    expect(k.timings.preparation.p90Ms).toBeNull(); // < 10 örnek
    const mutfak = k.stations.find((s) => s.stationName === "Mutfak")!;
    const bar = k.stations.find((s) => s.stationName === "Bar")!;
    expect(mutfak.tickets).toBe(2);
    expect(mutfak.prep.avgMs).toBe(((13 + 16) / 2) * 60_000);
    expect(bar).toMatchObject({ tickets: 2 });
    expect(bar.prep.medianMs).toBe(((3 + 2) / 2) * 60_000);
  });
});

describe("servis talepleri", () => {
  it("11–12. yanıt / tamamlanma süreleri ve türe göre dağılım (personel adı yok)", async () => {
    const s = await computeSection(await ctxFor(A, { range: "today" }), "service");
    expect(s.summary.total).toBe(4);
    expect(s.summary.response).toMatchObject({ count: 3, avgMs: 120_000, medianMs: 120_000 });
    expect(s.summary.completion).toMatchObject({ count: 2, avgMs: 270_000 });
    expect(Object.fromEntries(s.summary.byType.map((t) => [t.type, t.count]))).toEqual({ WAITER: 2, WATER: 1, CUSTOM: 1 });
    expect(s.byHour.find((h) => h.hour === 10)?.count).toBe(2);
    expect(JSON.stringify(s)).not.toContain("Personel Adı Gizli");
  });
});

describe("AI kullanımı", () => {
  it("13–14. konuşma / tur / ses / yedek / kesinti; dil dağılımı; eylemler — mesaj metni yok", async () => {
    const a = await computeSection(await ctxFor(A, { range: "today" }), "ai");
    expect(a).toMatchObject({ conversations: 3, turns: 3, liveTurns: 2, fallbackTurns: 1, interruptions: 1, reconnects: 1, voiceSeconds: 180, productCardsShown: 2, recommendations: 1 });
    expect(a.fallbackRate).toBeCloseTo(1 / 3);
    expect(Object.fromEntries(a.conversationLanguages.map((l) => [l.language, l.count]))).toEqual({ tr: 1, en: 1, ar: 1 });
    expect(Object.fromEntries(a.messageLanguages.map((l) => [l.language, l.count]))).toEqual({ tr: 2, en: 1 });
    expect(Object.fromEntries(a.actions.map((x) => [x.kind, x.count]))).toEqual({ cart_add: 2, service: 1 });
    expect(JSON.stringify(a)).not.toContain("GİZLİ MÜŞTERİ CÜMLESİ");
  });
});

describe("şube, kiracı yalıtımı, CSV", () => {
  it("15. şube filtresi: Kadıköy yalnızca kendi siparişi", async () => {
    const k = await computeSection(await ctxFor(A, { range: "today", branch: A.kadikoy.id }), "overview");
    expect(k.kpis).toMatchObject({ salesOrders: 1, salesMinor: 25_000 });
  });

  it("16. kiracı yalıtımı: A, B'nin siparişini görmez; B'nin şubesi A için geçersiz", async () => {
    const a = await computeSection(await ctxFor(A, { range: "today" }), "overview");
    expect(a.kpis.salesMinor).toBe(TODAY_SALES);
    const b = await computeSection(await ctxFor(B, { range: "today" }), "overview");
    expect(b.kpis.salesMinor).toBe(999_900);
    const cross = await resolveAnalyticsContext(A.scope, { range: "today", branch: B.merkez.id }, NOW);
    expect(cross).toMatchObject({ ok: false, error: "branch_invalid" });
  });

  it("20. CSV: ürün / sipariş / servis / KDS; formül enjeksiyonu kaçışlı; not ve personel adı yok; kiracı B yok", async () => {
    const ctx = await ctxFor(A, { range: "today" });
    await prisma.product.update({ where: { id: A.products.kofte.id }, data: { name: "=SUM(1+1)" } });
    const products = await csvText("products", ctx);
    const bytes = new Uint8Array(await new Response(csvStream("products", ctx)).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM (Excel)
    expect(products).toContain(`"'=SUM(1+1)"`);
    expect(products).not.toMatch(/(^|,)"=SUM/m);
    const orders = await csvText("orders", ctx);
    expect(orders.split("\r\n").filter(Boolean)).toHaveLength(1 + 9);
    expect(orders).toContain("+03:00");
    expect(orders).not.toContain("HYPERLINK");
    expect(orders).not.toContain("999900");
    const service = await csvText("service", ctx);
    expect(service).not.toContain("Müşteri özel notu");
    expect(service).not.toContain("Personel Adı Gizli");
    const kds = await csvText("kds", ctx);
    expect(kds.split("\r\n").filter(Boolean).length).toBe(1 + 4); // fişler: #1 bar, #2 mutfak + bar, #3 mutfak
  });

  it("tarih aralığı kötüye kullanımı sınırlı: > 366 gün, ters sıra, gelecek reddedilir", async () => {
    expect(await resolveAnalyticsContext(A.scope, { range: "custom", from: "2024-01-01", to: "2026-06-15" }, NOW)).toMatchObject({ ok: false, error: "range_too_long" });
    expect(await resolveAnalyticsContext(A.scope, { range: "custom", from: "2026-06-10", to: "2026-06-01" }, NOW)).toMatchObject({ ok: false, error: "invalid_dates" });
    expect(await resolveAnalyticsContext(A.scope, { range: "custom", from: "2027-01-01", to: "2027-01-02" }, NOW)).toMatchObject({ ok: false, error: "future" });
  });

  it("boş kiracı: NaN / 0-0 yok, ısı haritası ve dörtlü tablo boş durumda", async () => {
    const empty = await makeTenant("e");
    try {
      const o = await computeSection(await ctxFor(empty, { range: "last30" }), "overview");
      expect(o.averageMinor).toBeNull();
      expect(o.acceptanceRate).toBeNull();
      expect(o.heatmap).toBeNull();
      expect(o.comparisons.sales.pct).toBeNull();
      expect(JSON.stringify(o)).not.toMatch(/NaN|Infinity/);
      const p = await computeSection(await ctxFor(empty, { range: "last30" }), "products");
      expect(p.quadrants).toBeNull();
      const k = await computeSection(await ctxFor(empty, { range: "last30" }), "operations");
      expect(k.timings.preparation).toEqual({ count: 0, avgMs: null, medianMs: null, p90Ms: null });
    } finally {
      await prisma.tenant.delete({ where: { id: empty.tenantId } });
    }
  });
});

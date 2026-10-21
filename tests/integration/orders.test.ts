import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OrderContext } from "@/server/services/orders/submit-order.service";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { createMenuRefs } = await import("@/server/services/orders/menu-refs");
const { submitOrder, checkCart } = await import("@/server/services/orders/submit-order.service");
const { changeOrderStatus } = await import("@/server/services/orders/order-status.service");
const { getOrderDetail, getPublicOrder } = await import("@/server/repositories/orders.repository");


/**
 * Sipariş motoru — gerçek PostgreSQL (Neon). İki geçici kiracı (A, B); sonunda silinir.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };

async function makeTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Sipariş ${label} ${run}`,
      slug: `ord-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr" } },
      domains: { create: { hostname: `ord-${label}-${run}.localhost`, type: "SUBDOMAIN", isPrimary: true } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }, { name: "Kadıköy", slug: "kadikoy" }] },
      users: { create: { email: `ord-${label}-${run}@masanovai.test`, firstName: "O", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, branches: { orderBy: { slug: "desc" }, select: { id: true, name: true } }, users: { select: { id: true } } },
  });
  const tenantId = tenant.id;
  const [merkez, kadikoy] = tenant.branches;
  // Sprint 7: kabul fiş üretir — her şubede varsayılan "Mutfak" istasyonu.
  for (const b of tenant.branches) {
    const station = await prisma.preparationStation.create({ data: { tenantId, branchId: b.id, name: "Mutfak" }, select: { id: true } });
    await prisma.branch.updateMany({ where: { id: b.id, tenantId }, data: { defaultStationId: station.id, defaultStationBranchId: b.id } });
  }
  const category = await prisma.menuCategory.create({ data: { tenantId, name: "Burgerler", slug: "burgerler" } });
  const burger = await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Cheeseburger", slug: "cheeseburger", basePriceMinor: 38000 } });
  const soup = await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Çorba", slug: "corba", basePriceMinor: 12000 } });
  const own = await prisma.product.create({ data: { tenantId, categoryId: category.id, name: `Özel ${label}`, slug: `ozel-${label}`, basePriceMinor: 9900 } });
  const tek = await prisma.productVariant.create({ data: { tenantId, productId: burger.id, name: "Tek", priceMinor: 38000, isDefault: true } });
  const cift = await prisma.productVariant.create({ data: { tenantId, productId: burger.id, name: "Çift", priceMinor: 50000 } });
  const pisirme = await prisma.modifierGroup.create({ data: { tenantId, name: "Pişirme", required: true, minSelect: 1, maxSelect: 1 } });
  const orta = await prisma.modifier.create({ data: { tenantId, modifierGroupId: pisirme.id, name: "Orta", priceDeltaMinor: 0 } });
  const ekstra = await prisma.modifierGroup.create({ data: { tenantId, name: "Ekstra", minSelect: 0, maxSelect: 2 } });
  const cheddar = await prisma.modifier.create({ data: { tenantId, modifierGroupId: ekstra.id, name: "Cheddar", priceDeltaMinor: 3000 } });
  const fume = await prisma.modifier.create({ data: { tenantId, modifierGroupId: ekstra.id, name: "Füme", priceDeltaMinor: 5000 } });
  await prisma.productModifierGroup.createMany({ data: [{ tenantId, productId: burger.id, modifierGroupId: pisirme.id, sortOrder: 1 }, { tenantId, productId: burger.id, modifierGroupId: ekstra.id, sortOrder: 2 }] });
  // Kadıköy: çorba şube fiyatı 13.500, "Çift" şube fiyatı 55.000
  await prisma.branchProduct.create({ data: { tenantId, branchId: kadikoy!.id, productId: soup.id, priceMinor: 13500 } });
  await prisma.branchVariantPrice.create({ data: { tenantId, branchId: kadikoy!.id, variantId: cift.id, priceMinor: 55000 } });

  const mkTable = async (branchId: string, name: string) => {
    const table = await prisma.diningTable.create({ data: { tenantId, branchId, name } });
    const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
    return { tableId: table.id, tokenId: token.id, branchId, name };
  };
  const t1 = await mkTable(merkez!.id, "Masa 1");
  const t2 = await mkTable(merkez!.id, "Masa 2");
  const t3 = await mkTable(kadikoy!.id, "Masa 3");
  const ref = createMenuRefs(tenantId);
  const ctx = (t: { tableId: string; tokenId: string; branchId: string; name: string }): OrderContext => ({
    tenantId,
    branchId: t.branchId,
    tableId: t.tableId,
    tokenId: t.tokenId,
    branchName: t.branchId === merkez!.id ? "Merkez" : "Kadıköy",
    tableName: t.name,
    areaName: null,
    defaultLocale: "tr",
  });
  return {
    tenantId,
    userId: tenant.users[0]!.id,
    scope: createTenantScope(tenantId),
    ids: { burger: burger.id, soup: soup.id, own: own.id, tek: tek.id, cift: cift.id, pisirme: pisirme.id, orta: orta.id, ekstra: ekstra.id, cheddar: cheddar.id, fume: fume.id },
    refs: { tek: ref(tek.id), cift: ref(cift.id), pisirme: ref(pisirme.id), orta: ref(orta.id), ekstra: ref(ekstra.id), cheddar: ref(cheddar.id), fume: ref(fume.id) },
    t1: ctx(t1),
    t2: ctx(t2),
    t3: ctx(t3),
  };
}

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
});

afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantDomain.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

const key = () => randomBytes(18).toString("base64url");
const burgerItem = (f: typeof A, overrides: Record<string, unknown> = {}) => ({
  product: "cheeseburger",
  variant: f.refs.cift,
  modifiers: [
    { group: f.refs.pisirme, modifier: f.refs.orta },
    { group: f.refs.ekstra, modifier: f.refs.cheddar },
  ],
  quantity: 2,
  note: "Soğan olmasın",
  expectedUnitPriceMinor: 53000,
  ...overrides,
});
const input = (items: unknown[], extra: Record<string, unknown> = {}) => submitOrderSchema.parse({ items, note: "Hepsi birlikte", idempotencyKey: key(), locale: "tr", ...extra });

describe("sipariş oluşturma (yetkili hesap)", () => {
  it("1–2, 5–6. geçerli sipariş tek transaction'da; toplam gerçek menü verisinden; varyant + ekstralar", async () => {
    const res = await submitOrder(A.t1, input([burgerItem(A), { product: "corba", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 12000 }]));
    expect(res.kind).toBe("created");
    if (res.kind !== "created") return;
    expect(res.order).toMatchObject({ orderNumber: 1001, totalMinor: 2 * 53000 + 12000, itemCount: 3, status: "SUBMITTED", tableName: "Masa 1" });
    const order = await prisma.order.findUniqueOrThrow({ where: { publicId: res.order.publicId }, include: { items: { include: { modifiers: true }, orderBy: { sortOrder: "asc" } }, history: true } });
    expect(order.items).toHaveLength(2);
    expect(order.items[0]).toMatchObject({ productName: "Cheeseburger", variantName: "Çift", basePriceMinor: 50000, modifiersTotalMinor: 3000, unitPriceMinor: 53000, quantity: 2, lineTotalMinor: 106000, note: "Soğan olmasın" });
    expect(order.items[0]!.modifiers.map((m) => [m.groupName, m.modifierName, m.priceDeltaMinor])).toEqual([
      ["Pişirme", "Orta", 0],
      ["Ekstra", "Cheddar", 3000],
    ]);
    expect(order.history.map((h) => [h.fromStatus, h.toStatus, h.actorType])).toEqual([[null, "SUBMITTED", "CUSTOMER"]]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: A.tenantId, action: "ORDER_SUBMITTED", entityId: order.id } });
    expect(audit.userId).toBeNull();
    expect(audit.ipAddress).toBeNull();
  });

  it("3. istemcinin sahte fiyatı etkisiz: beklenen fiyat 1 → sipariş oluşmaz, mutabakat; fiyat alanı gönderilse bile toplam veritabanından", async () => {
    const before = await prisma.order.count({ where: { tenantId: A.tenantId } });
    const fake = await submitOrder(A.t1, input([burgerItem(A, { expectedUnitPriceMinor: 1, price: 1, unitPriceMinor: 1, lineTotalMinor: 1 })], { totalMinor: 1 }));
    expect(fake).toMatchObject({ kind: "reconcile", lines: [{ status: "price_changed", fromMinor: 1, toMinor: 53000 }] });
    expect(await prisma.order.count({ where: { tenantId: A.tenantId } })).toBe(before);
    // Müşteri yeni tutarı kabul edip yeniden gönderir → doğru fiyat.
    const ok = await submitOrder(A.t1, input([burgerItem(A, { quantity: 1, price: 1 })]));
    expect(ok.kind === "created" && ok.order.totalMinor).toBe(53000);
  });

  it("4. şube fiyatları yalnızca o şubede: Kadıköy çorba 135, Çift 550", async () => {
    const res = await submitOrder(A.t3, input([{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 13500 }, burgerItem(A, { quantity: 1, expectedUnitPriceMinor: 58000 })]));
    expect(res.kind === "created" && res.order.totalMinor).toBe(13500 + 58000);
    const merkez = await checkCart(A.t1, { items: [{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 13500 }], locale: "tr" });
    expect(merkez.lines[0]).toMatchObject({ status: "price_changed", toMinor: 12000 });
  });

  it("ekstra kuralları sunucuda: zorunlu eksik, başka grubun ekstrası, ürüne bağlı olmayan grup → sipariş yok", async () => {
    const bad = [
      burgerItem(A, { modifiers: [] }),
      burgerItem(A, { modifiers: [{ group: A.refs.pisirme, modifier: A.refs.cheddar }] }),
      burgerItem(A, { modifiers: [{ group: A.refs.pisirme, modifier: A.refs.orta }, { group: A.refs.ekstra, modifier: A.refs.cheddar }, { group: A.refs.ekstra, modifier: A.refs.cheddar }] }),
      { product: "corba", variant: null, modifiers: [{ group: A.refs.ekstra, modifier: A.refs.cheddar }], quantity: 1, note: null },
      burgerItem(A, { variant: null }),
    ];
    for (const item of bad) expect((await submitOrder(A.t1, input([item]))).kind).toBe("reconcile");
  });

  it("7–8. tükenen ürün ve pasif ürün reddedilir (mutabakat, sessiz değişiklik yok)", async () => {
    await prisma.product.update({ where: { id: A.ids.soup }, data: { soldOut: true } });
    expect(await submitOrder(A.t1, input([{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 12000 }]))).toMatchObject({ kind: "reconcile", lines: [{ status: "sold_out" }] });
    await prisma.product.update({ where: { id: A.ids.soup }, data: { soldOut: false, active: false } });
    expect(await submitOrder(A.t1, input([{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null }]))).toMatchObject({ kind: "reconcile", lines: [{ status: "unavailable" }] });
    await prisma.product.update({ where: { id: A.ids.soup }, data: { active: true } });
    await prisma.modifier.update({ where: { id: A.ids.fume }, data: { active: false } });
    expect((await submitOrder(A.t1, input([burgerItem(A, { modifiers: [{ group: A.refs.pisirme, modifier: A.refs.orta }, { group: A.refs.ekstra, modifier: A.refs.fume }] })]))).kind).toBe("reconcile");
    await prisma.modifier.update({ where: { id: A.ids.fume }, data: { active: true } });
  });

  it("9–10. pasif masa ve iptal edilen QR → bağlam geçersiz, sipariş yok", async () => {
    await prisma.diningTable.update({ where: { id: A.t2.tableId }, data: { active: false } });
    expect(await submitOrder(A.t2, input([burgerItem(A)]))).toEqual({ kind: "rejected", reason: "context_invalid" });
    await prisma.diningTable.update({ where: { id: A.t2.tableId }, data: { active: true } });
    await prisma.tableQrToken.update({ where: { id: A.t2.tokenId }, data: { active: false, revokedAt: new Date() } });
    expect(await submitOrder(A.t2, input([burgerItem(A)]))).toEqual({ kind: "rejected", reason: "context_invalid" });
    await prisma.tableQrToken.update({ where: { id: A.t2.tokenId }, data: { active: true, revokedAt: null } });
    await prisma.tenant.update({ where: { id: A.tenantId }, data: { status: "SUSPENDED" } });
    expect(await submitOrder(A.t2, input([burgerItem(A)]))).toEqual({ kind: "rejected", reason: "context_invalid" });
    await prisma.tenant.update({ where: { id: A.tenantId }, data: { status: "ACTIVE" } });
    expect(await prisma.order.count({ where: { tableId: A.t2.tableId } })).toBe(0);
  });

  it("11–12. başka kiracının ürünü ve ekstrası A'nın siparişinde kullanılamaz", async () => {
    expect(await submitOrder(A.t1, input([{ product: "ozel-b", variant: null, modifiers: [], quantity: 1, note: null }]))).toMatchObject({ kind: "reconcile", lines: [{ status: "unavailable" }] });
    const foreignMod = await submitOrder(A.t1, input([burgerItem(A, { modifiers: [{ group: A.refs.pisirme, modifier: A.refs.orta }, { group: B.refs.ekstra, modifier: B.refs.cheddar }] })]));
    expect(foreignMod).toMatchObject({ kind: "reconcile", lines: [{ status: "invalid", issues: ["group_invalid"] }] });
    const foreignVariant = await submitOrder(A.t1, input([burgerItem(A, { variant: B.refs.cift })]));
    expect(foreignVariant).toMatchObject({ kind: "reconcile", lines: [{ status: "invalid" }] });
  });
});

describe("tekrarlanan gönderim ve eşzamanlılık", () => {
  it("13. aynı anahtar ikinci kez → aynı sipariş (yeni sipariş yok); aynı anahtar farklı içerik → ret", async () => {
    const payload = input([burgerItem(A)]);
    const first = await submitOrder(A.t1, payload);
    const second = await submitOrder(A.t1, payload);
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("duplicate");
    if (first.kind !== "created" || second.kind !== "duplicate") return;
    expect(second.order.publicId).toBe(first.order.publicId);
    expect(await prisma.order.count({ where: { tenantId: A.tenantId, publicId: first.order.publicId } })).toBe(1);
    expect(await submitOrder(A.t1, { ...payload, items: [burgerItem(A, { quantity: 5, expectedUnitPriceMinor: 53000 })] as typeof payload.items })).toEqual({ kind: "rejected", reason: "idempotency_conflict" });
  });

  it("14. eşzamanlı 6 aynı gönderim → tek sipariş, hepsi aynı sonucu görür", async () => {
    const payload = input([burgerItem(A, { quantity: 1 })]);
    const before = await prisma.order.count({ where: { tenantId: A.tenantId } });
    const results = await Promise.all(Array.from({ length: 6 }, () => submitOrder(A.t1, payload)));
    const ids = new Set(results.map((r) => (r.kind === "created" || r.kind === "duplicate" ? r.order.publicId : `x-${r.kind}`)));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.kind === "created")).toHaveLength(1);
    expect(await prisma.order.count({ where: { tenantId: A.tenantId } })).toBe(before + 1);
  });

  it("farklı anahtarlarla eşzamanlı siparişler benzersiz, ardışık şube numaraları alır", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => submitOrder(A.t1, input([{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null }]))));
    const numbers = results.map((r) => (r.kind === "created" ? r.order.orderNumber : -1)).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(5);
    expect(numbers.every((n) => n > 1000)).toBe(true);
    expect(numbers.at(-1)! - numbers[0]!).toBe(4);
    // Kadıköy şubesinin sayacı ayrıdır.
    const kd = await submitOrder(A.t3, input([{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null }]));
    expect(kd.kind === "created" && kd.order.orderNumber).toBe(1002);
  });

  it("15. transaction ortasında hata → yarım sipariş / kalem / ekstra / geçmiş kalmaz", async () => {
    const counts = async () => Promise.all([prisma.order.count({ where: { tenantId: A.tenantId } }), prisma.orderItem.count({ where: { tenantId: A.tenantId } }), prisma.orderItemModifier.count({ where: { tenantId: A.tenantId } }), prisma.orderStatusHistory.count({ where: { tenantId: A.tenantId } })]);
    const before = await counts();
    // Sayaç geri alınır → sıradaki numara mevcut bir siparişle çakışır → INSERT (sayaçtan sonra) hata verir.
    const seq = await prisma.orderSequence.findUniqueOrThrow({ where: { branchId: A.t1.branchId } });
    await prisma.orderSequence.update({ where: { branchId: A.t1.branchId }, data: { lastNumber: 1000 } });
    await expect(submitOrder(A.t1, input([burgerItem(A)]))).rejects.toThrow();
    expect(await counts()).toEqual(before);
    expect((await prisma.orderSequence.findUniqueOrThrow({ where: { branchId: A.t1.branchId } })).lastNumber).toBe(1000);
    await prisma.orderSequence.update({ where: { branchId: A.t1.branchId }, data: { lastNumber: seq.lastNumber } });
  });
});

describe("değişmez kopyalar ve erişim", () => {
  let publicId = "";
  let orderId = "";
  beforeAll(async () => {
    const res = await submitOrder(A.t1, input([burgerItem(A, { quantity: 1 })]));
    if (res.kind !== "created") throw new Error(res.kind);
    publicId = res.order.publicId;
    orderId = (await prisma.order.findUniqueOrThrow({ where: { publicId } })).id;
  });

  it("16–18. ürün adı / fiyat değişse, ekstra arşivlense de sipariş aynı görünür", async () => {
    await prisma.product.update({ where: { id: A.ids.burger }, data: { name: "Mega Burger" } });
    await prisma.productVariant.update({ where: { id: A.ids.cift }, data: { priceMinor: 99900, name: "Dörtlü" } });
    await prisma.modifier.update({ where: { id: A.ids.cheddar }, data: { archivedAt: new Date(), name: "Silinen", priceDeltaMinor: 99 } });
    const order = await getPublicOrder({ tenantId: A.tenantId, tableId: A.t1.tableId }, publicId);
    expect(order!.items[0]).toMatchObject({ productName: "Cheeseburger", variantName: "Çift", unitPriceMinor: 53000, lineTotalMinor: 53000 });
    expect(order!.items[0]!.modifiers.map((m) => [m.modifierName, m.priceDeltaMinor])).toEqual([
      ["Orta", 0],
      ["Cheddar", 3000],
    ]);
    expect(order!.totalMinor).toBe(53000);
    const panel = await getOrderDetail(A.scope, orderId);
    expect(panel!.order.items[0]!.productNameDefault).toBe("Cheeseburger");
    await prisma.product.update({ where: { id: A.ids.burger }, data: { name: "Cheeseburger" } });
    await prisma.productVariant.update({ where: { id: A.ids.cift }, data: { priceMinor: 50000, name: "Çift" } });
    await prisma.modifier.update({ where: { id: A.ids.cheddar }, data: { archivedAt: null, name: "Cheddar", priceDeltaMinor: 3000 } });
  });

  it("19. aynı restoranın başka masası siparişi göremez", async () => {
    expect(await getPublicOrder({ tenantId: A.tenantId, tableId: A.t2.tableId }, publicId)).toBeNull();
    expect(await getPublicOrder({ tenantId: A.tenantId, tableId: A.t1.tableId }, publicId)).not.toBeNull();
  });

  it("20. başka kiracı siparişi göremez / yönetemez", async () => {
    expect(await getPublicOrder({ tenantId: B.tenantId, tableId: B.t1.tableId }, publicId)).toBeNull();
    expect(await getPublicOrder({ tenantId: B.tenantId, tableId: A.t1.tableId }, publicId)).toBeNull();
    expect(await getOrderDetail(B.scope, orderId)).toBeNull();
    expect(await changeOrderStatus({ userId: B.userId, scope: B.scope, meta }, orderId, "ACCEPTED", null)).toMatchObject({ ok: false, error: "Sipariş bulunamadı." });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("SUBMITTED");
  });

  it("24 saatten eski sipariş public olarak açılmaz", async () => {
    expect(await getPublicOrder({ tenantId: A.tenantId, tableId: A.t1.tableId }, publicId, new Date(Date.now() + 25 * 60 * 60 * 1000))).toBeNull();
  });

  it("durum: kabul / ret yalnızca geçiş tablosuyla; eşzamanlı kararda yalnızca biri uygulanır; geçmiş + denetim", async () => {
    const actor = { userId: A.userId, scope: A.scope, meta };
    const [x, y] = await Promise.all([changeOrderStatus(actor, orderId, "ACCEPTED", null), changeOrderStatus(actor, orderId, "REJECTED", "Mutfak kapandı")]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { history: true } });
    expect(["ACCEPTED", "REJECTED"]).toContain(order.status);
    expect(order.history).toHaveLength(2);
    expect(await changeOrderStatus(actor, orderId, "ACCEPTED", null)).toMatchObject({ ok: false });
    expect(await changeOrderStatus(actor, orderId, "SERVED", null)).toMatchObject({ ok: false });
    const audits = await prisma.auditLog.count({ where: { tenantId: A.tenantId, entityId: orderId, action: { in: ["ORDER_ACCEPTED", "ORDER_REJECTED"] } } });
    expect(audits).toBe(1);
  });

  it("denetim kayıtlarında tekrar anahtarı / QR token / public kimlik yok", async () => {
    const logs = JSON.stringify(await prisma.auditLog.findMany({ where: { tenantId: A.tenantId }, select: { metadata: true } }));
    expect(logs).not.toContain(publicId);
    expect(logs).not.toMatch(/idempotency|token/i);
  });
});

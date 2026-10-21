import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayRequest } from "@/server/payments/payment.service";
import type { OrderContext } from "@/server/services/orders/submit-order.service";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
process.env.PAYMENT_PROVIDER = "mock";

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { submitOrder } = await import("@/server/services/orders/submit-order.service");
const { acceptOrder, rejectOrder, cancelOrder } = await import("@/server/services/orders/order-status.service");
const admin = await import("@/server/promotions/admin.service");
const svc = await import("@/server/payments/payment.service");
const { getPaymentProvider } = await import("@/server/payments/providers");
const mock = await import("@/server/payments/providers/mock");
const { paymentMetrics } = await import("@/server/analytics/payments.analytics");

/**
 * Sprint 19 — ödemeler, gerçek PostgreSQL (Neon) + TEST sağlayıcısı (gerçek para yok). İki geçici kiracı; sonunda silinir.
 * Sepet: Burger 300 ₺ + 2× Ayran 50 ₺ = 400 ₺ (40.000 kuruş).
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };
const MIN = 60_000;

async function makeTenant(label: string) {
  const t = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Pay ${label} ${run}`,
      slug: `pay-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr" } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }] },
      users: { create: { email: `pay-${label}-${run}@masanovai.test`, firstName: "P", lastName: label, role: "TENANT_OWNER" } },
      paymentSettings: { create: { enabled: true } },
    },
    select: { id: true, branches: { select: { id: true } }, users: { select: { id: true } } },
  });
  const tenantId = t.id;
  const branchId = t.branches[0]!.id;
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Ana", slug: "ana" } });
  await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Burger", slug: "burger", basePriceMinor: 30000 } });
  await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Ayran", slug: "ayran", basePriceMinor: 5000 } });
  const station = await prisma.preparationStation.create({ data: { tenantId, branchId, name: "Mutfak", type: "KITCHEN" } });
  await prisma.branch.update({ where: { id: branchId }, data: { defaultStationId: station.id, defaultStationBranchId: branchId } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId, name: "Masa 1" } });
  const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
  const ctx: OrderContext = { tenantId, branchId, tableId: table.id, tokenId: token.id, branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" };
  const scope = createTenantScope(tenantId);
  return { tenantId, scope, actor: { userId: t.users[0]!.id, scope, meta }, ctx };
}

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;
beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
});
afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.paymentWebhookEvent.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});
beforeEach(() => mock.mockReset());

const key = () => randomBytes(18).toString("base64url");
type Fx = typeof A;
async function order(f: Fx, opts: { accept?: boolean; coupon?: string; items?: { product: string; quantity: number; price: number }[] } = {}) {
  const items = opts.items ?? [
    { product: "burger", quantity: 1, price: 30000 },
    { product: "ayran", quantity: 2, price: 5000 },
  ];
  const r = await submitOrder(
    { ...f.ctx, customerId: null },
    submitOrderSchema.parse({ items: items.map((i) => ({ product: i.product, variant: null, modifiers: [], quantity: i.quantity, note: null, expectedUnitPriceMinor: i.price })), note: null, idempotencyKey: key(), locale: "tr", promotion: opts.coupon ? { kind: "coupon", code: opts.coupon } : null }),
  );
  if (r.kind !== "created") throw new Error(JSON.stringify(r));
  const o = await prisma.order.findUniqueOrThrow({ where: { publicId: r.order.publicId }, select: { id: true, totalMinor: true, items: { orderBy: { sortOrder: "asc" }, select: { id: true, productName: true, quantity: true } } } });
  if (opts.accept !== false) expect((await acceptOrder(f.actor, o.id)).ok).toBe(true);
  return o;
}
const start = (f: Fx, orderId: string, request: Partial<PayRequest> & { mode: PayRequest["mode"] }, now?: Date) => svc.startOnlinePayment({ tenantId: f.tenantId, orderId, customerId: null, returnUrl: "/t/x/siparis/y/odeme", request: { idempotencyKey: key(), ...request }, now });
const view = async (f: Fx, orderId: string, now?: Date) => (await svc.loadOrderPaymentView(prisma, f.tenantId, orderId, now))!;
const paymentByPublic = (publicId: string) => prisma.payment.findUniqueOrThrow({ where: { publicId }, include: { attempts: true, allocations: true } });
const providerRef = async (publicId: string) => (await paymentByPublic(publicId)).attempts[0]!.providerReference!;
const deliver = async (ref: string, outcome: "payment.succeeded" | "payment.failed", eventId?: string) => {
  const p = getPaymentProvider() as ReturnType<typeof mock.createMockProvider>;
  const e = p.buildEvent(ref, outcome, eventId);
  return svc.processWebhook("mock", e.rawBody, new Headers({ "x-masanova-signature": e.signature }));
};
const ok = (r: Awaited<ReturnType<typeof start>>) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe("tam ödeme", () => {
  it("1. anlık başarı: SUCCEEDED, sipariş ÖDENDİ, kart yalnızca marka + son 4", async () => {
    const o = await order(A);
    mock.mockQueue("SUCCESS");
    const r = ok(await start(A, o.id, { mode: "FULL" }));
    expect(r).toMatchObject({ status: "SUCCEEDED", amountMinor: 40000, checkoutUrl: null });
    const p = await paymentByPublic(r.publicId);
    expect(p).toMatchObject({ cardBrand: "TEST", cardLast4: "4242", method: "ONLINE", provider: "mock", reservedUntil: null });
    expect((await view(A, o.id)).summary).toMatchObject({ paid: 40000, remaining: 0, state: "PAID" });
    // Kart numarası / CVV saklanacak sütun YOK
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name IN ('payments','payment_attempts','payment_refunds','payment_webhook_events')`;
    expect(cols.map((c) => c.column_name).filter((c) => /pan|cvv|cvc|card_number|expiry/i.test(c))).toEqual([]);
  });
  it("2. barındırılan akış: PROCESSING → imzalı webhook → SUCCEEDED; yönlendirme kanıt değildir", async () => {
    const o = await order(A);
    const r = ok(await start(A, o.id, { mode: "FULL" }));
    expect(r.status).toBe("PROCESSING");
    expect(r.checkoutUrl).toMatch(/^\/odeme\/mock\/mock_/);
    expect((await view(A, o.id)).summary).toMatchObject({ paid: 0, reserved: 40000, available: 0 });
    expect(await deliver(await providerRef(r.publicId), "payment.succeeded", `evt_${run}_2`)).toEqual({ status: 200, outcome: "processed" });
    expect((await paymentByPublic(r.publicId)).status).toBe("SUCCEEDED");
    expect((await view(A, o.id)).summary.state).toBe("PAID");
  });
});

describe("webhook güvenliği", () => {
  it("3. geçersiz imza 401, hiçbir şey değişmez; yinelenen olay bir kez işlenir; sırasız 'failed' başarıyı bozmaz", async () => {
    const o = await order(A);
    const r = ok(await start(A, o.id, { mode: "FULL" }));
    const ref = await providerRef(r.publicId);
    const body = JSON.stringify({ id: `evt_${run}_forged`, type: "payment.succeeded", reference: ref });
    expect(await svc.processWebhook("mock", body, new Headers({ "x-masanova-signature": `t=${Date.now()},v1=${"0".repeat(64)}` }))).toEqual({ status: 401, outcome: "invalid_signature" });
    expect(await svc.processWebhook("mock", body, new Headers())).toEqual({ status: 401, outcome: "invalid_signature" });
    expect((await paymentByPublic(r.publicId)).status).toBe("PROCESSING");
    expect(await prisma.paymentWebhookEvent.count({ where: { eventId: `evt_${run}_forged` } })).toBe(0);
    const evt = `evt_${run}_3`;
    expect((await deliver(ref, "payment.succeeded", evt)).outcome).toBe("processed");
    expect((await deliver(ref, "payment.succeeded", evt)).outcome).toBe("duplicate");
    expect((await deliver(ref, "payment.failed")).outcome).toBe("processed");
    expect((await paymentByPublic(r.publicId)).status).toBe("SUCCEEDED");
    expect(await prisma.payment.count({ where: { orderId: o.id, status: "SUCCEEDED" } })).toBe(1);
  });
  it("4. bilinmeyen referans / başka sağlayıcı adı güvenle yok sayılır", async () => {
    expect((await deliver("mock_000000000000000000000000", "payment.succeeded")).outcome).toBe("unknown_reference");
    expect((await svc.processWebhook("stripe", "{}", new Headers())).status).toBe(400);
  });
});

describe("kısmi ödeme ve bölme", () => {
  it("5. tutar ile: KISMEN ÖDENDİ; kalanı aşan tutar reddedilir; kalan merkezi", async () => {
    const o = await order(A);
    mock.mockQueue("SUCCESS");
    ok(await start(A, o.id, { mode: "AMOUNT", amountMinor: 12_345 }));
    expect((await view(A, o.id)).summary).toMatchObject({ paid: 12_345, remaining: 27_655, state: "PARTIALLY_PAID" });
    expect(await start(A, o.id, { mode: "AMOUNT", amountMinor: 27_656 })).toEqual({ ok: false, reason: "amount_invalid" });
    expect(await start(A, o.id, { mode: "AMOUNT", amountMinor: 0 })).toEqual({ ok: false, reason: "amount_invalid" });
    mock.mockQueue("SUCCESS");
    expect(ok(await start(A, o.id, { mode: "FULL" })).amountMinor).toBe(27_655);
    expect((await view(A, o.id)).summary.state).toBe("PAID");
    expect(await start(A, o.id, { mode: "FULL" })).toEqual({ ok: false, reason: "nothing_due" });
  });
  it("6. eşit bölme (3 kişi, 40.000): paylar toplamı kuruşu kuruşuna", async () => {
    const o = await order(A);
    const { splitEqually } = await import("@/lib/payments/allocation");
    for (let i = 0; i < 3; i++) {
      const share = splitEqually((await view(A, o.id)).summary.available, 3 - i)[0]!;
      mock.mockQueue("SUCCESS");
      ok(await start(A, o.id, { mode: "EQUAL", amountMinor: share }));
    }
    const pays = await prisma.payment.findMany({ where: { orderId: o.id, status: "SUCCEEDED" }, select: { amountMinor: true } });
    expect(pays.map((p) => p.amountMinor).sort()).toEqual([13_333, 13_333, 13_334]);
    expect((await view(A, o.id)).summary).toMatchObject({ paid: 40_000, remaining: 0 });
  });
  it("7. ürün seçimi: birimler sırayla; fazla adet reddedilir; dağılım kalem bazında", async () => {
    const o = await order(A);
    const [burger, ayran] = o.items;
    mock.mockQueue("SUCCESS");
    const r = ok(await start(A, o.id, { mode: "ITEMS", items: [{ orderItemId: ayran!.id, quantity: 1 }] }));
    expect(r.amountMinor).toBe(5_000);
    const v = await view(A, o.id);
    expect(v.lines.find((l) => l.id === ayran!.id)).toMatchObject({ allocatedUnits: 1, remainingUnits: 1 });
    expect(await start(A, o.id, { mode: "ITEMS", items: [{ orderItemId: ayran!.id, quantity: 2 }] })).toEqual({ ok: false, reason: "items_invalid" });
    expect(await start(A, o.id, { mode: "ITEMS", items: [{ orderItemId: "cmnotanitemnotanitemnota", quantity: 1 }] })).toEqual({ ok: false, reason: "items_invalid" });
    mock.mockQueue("SUCCESS");
    ok(await start(A, o.id, { mode: "ITEMS", items: [{ orderItemId: burger!.id, quantity: 1 }, { orderItemId: ayran!.id, quantity: 1 }] }));
    expect((await view(A, o.id)).summary.state).toBe("PAID");
    const allocs = await prisma.paymentAllocation.findMany({ where: { orderId: o.id } });
    expect(allocs.reduce((s, a) => s + a.amountMinor, 0)).toBe(40_000);
  });
  it("8. tutar ödemesi + ürün ödemesi birlikte: kalanı aşan ürün seçimi reddedilir", async () => {
    const o = await order(A);
    mock.mockQueue("SUCCESS");
    ok(await start(A, o.id, { mode: "AMOUNT", amountMinor: 38_000 }));
    expect(await start(A, o.id, { mode: "ITEMS", items: [{ orderItemId: o.items[0]!.id, quantity: 1 }] })).toEqual({ ok: false, reason: "amount_invalid" });
  });
});

describe("indirim dağılımı (Sprint 18 toplamı esas)", () => {
  it("9. kuponlu sipariş: ödenecek = kalıcı toplam; kalem payları toplamı = toplam", async () => {
    const r = await admin.saveCoupon(A.actor, null, { name: "P100", description: null, type: "FIXED_AMOUNT", valueMinor: 10_000, percentageBps: null, maxDiscountMinor: null, minimumOrderMinor: null, scope: "ALL", productIds: [], categoryIds: [], freeProductId: null, branchId: null, startsAt: null, endsAt: null, daysMask: null, startMinute: null, endMinute: null, usageLimit: null, perCustomerLimit: null, audience: "ANYONE", status: "ACTIVE", code: "PAY100", codeNormalized: "PAY100" });
    expect(r.ok).toBe(true);
    const o = await order(A, { coupon: "PAY100" });
    expect(o.totalMinor).toBe(30_000);
    const v = await view(A, o.id);
    expect(v.lines.reduce((s, l) => s + l.payableMinor, 0)).toBe(30_000);
    // Kupon sonradan değişse de ödeme kalıcı toplamdan
    await prisma.coupon.updateMany({ where: { tenantId: A.tenantId, codeNormalized: "PAY100" }, data: { valueMinor: 1 } });
    mock.mockQueue("SUCCESS");
    expect(ok(await start(A, o.id, { mode: "FULL" })).amountMinor).toBe(30_000);
  });
});

describe("ödenebilirlik", () => {
  it("10. SUBMITTED / REJECTED / CANCELLED ödenemez; ayarlar kapalıyken reddedilir", async () => {
    const sub = await order(A, { accept: false });
    expect(await start(A, sub.id, { mode: "FULL" })).toEqual({ ok: false, reason: "not_payable" });
    expect((await rejectOrder(A.actor, sub.id, null)).ok).toBe(true);
    expect(await start(A, sub.id, { mode: "FULL" })).toEqual({ ok: false, reason: "not_payable" });
    const c = await order(A);
    expect((await cancelOrder(A.actor, c.id, "test iptal")).ok).toBe(true);
    expect(await start(A, c.id, { mode: "FULL" })).toEqual({ ok: false, reason: "not_payable" });
    await prisma.paymentSettings.update({ where: { tenantId: A.tenantId }, data: { enabled: false } });
    const o = await order(A);
    expect(await start(A, o.id, { mode: "FULL" })).toEqual({ ok: false, reason: "disabled" });
    expect(await svc.onlinePaymentsAvailable(A.tenantId)).toBe(false);
    await prisma.paymentSettings.update({ where: { tenantId: A.tenantId }, data: { enabled: true } });
    expect(await svc.onlinePaymentsAvailable(A.tenantId)).toBe(true);
  });
});

describe("idempotency ve eşzamanlılık", () => {
  it("11. aynı anahtar + aynı istek → aynı ödeme (çift tıklama); aynı anahtar + farklı tutar → çakışma", async () => {
    const o = await order(A);
    const k = key();
    const a = ok(await start(A, o.id, { mode: "AMOUNT", amountMinor: 1000, idempotencyKey: k }));
    const b = ok(await start(A, o.id, { mode: "AMOUNT", amountMinor: 1000, idempotencyKey: k }));
    expect(b.publicId).toBe(a.publicId);
    expect(b.replay).toBe(true);
    expect(await start(A, o.id, { mode: "AMOUNT", amountMinor: 2000, idempotencyKey: k })).toEqual({ ok: false, reason: "idempotency_conflict" });
    expect(await prisma.payment.count({ where: { orderId: o.id } })).toBe(1);
  });
  it("12. yarış: ₺400 kalan, iki eşzamanlı TAMAMINI öde → en fazla biri başlar", async () => {
    const o = await order(A);
    const results = await Promise.all([start(A, o.id, { mode: "FULL" }), start(A, o.id, { mode: "FULL" }), start(A, o.id, { mode: "AMOUNT", amountMinor: 40_000 })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && (r.reason === "nothing_due" || r.reason === "amount_invalid"))).toBe(true);
    expect(await prisma.payment.count({ where: { orderId: o.id, status: { in: ["PENDING", "PROCESSING"] } } })).toBe(1);
  });
  it("13. eşzamanlı başarılar: iki yarım ödeme + fazladan biri → toplam asla aşılmaz", async () => {
    const o = await order(A);
    mock.mockQueue("SUCCESS", "SUCCESS", "SUCCESS");
    const results = await Promise.all([1, 2, 3].map(() => start(A, o.id, { mode: "AMOUNT", amountMinor: 20_000 })));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const paid = await prisma.payment.aggregate({ where: { orderId: o.id, status: "SUCCEEDED" }, _sum: { amountMinor: true } });
    expect(paid._sum.amountMinor).toBe(40_000);
  });
});

describe("rezervasyon ve sağlayıcı hataları", () => {
  it("14. rezervasyon süresi dolunca serbest kalır (CANCELLED + deneme EXPIRED)", async () => {
    const o = await order(A);
    const first = ok(await start(A, o.id, { mode: "FULL" }));
    expect(await start(A, o.id, { mode: "FULL" })).toEqual({ ok: false, reason: "nothing_due" });
    const later = new Date(Date.now() + 16 * MIN);
    const second = ok(await start(A, o.id, { mode: "FULL" }, later));
    const p1 = await paymentByPublic(first.publicId);
    expect(p1).toMatchObject({ status: "CANCELLED", failureCode: "reservation_expired" });
    expect(p1.attempts[0]!.status).toBe("EXPIRED");
    expect((await paymentByPublic(second.publicId)).status).toBe("PROCESSING");
  });
  it("15. süresi dolmuş ödemenin GEÇ onayı: bakiye doluysa kesinleşmez, 'iade gerekli'; boşsa kabul edilir", async () => {
    const o = await order(A);
    const first = ok(await start(A, o.id, { mode: "FULL" }));
    const later = new Date(Date.now() + 16 * MIN);
    mock.mockQueue("SUCCESS");
    ok(await start(A, o.id, { mode: "FULL" }, later));
    await deliver(await providerRef(first.publicId), "payment.succeeded");
    expect(await paymentByPublic(first.publicId)).toMatchObject({ status: "CANCELLED", needsRefund: true, failureCode: "late_capacity_conflict" });
    expect((await prisma.payment.aggregate({ where: { orderId: o.id, status: "SUCCEEDED" }, _sum: { amountMinor: true } }))._sum.amountMinor).toBe(40_000);
    // Bakiye boşken geç onay → kabul
    const o2 = await order(A);
    const late = ok(await start(A, o2.id, { mode: "FULL" }));
    await svc.startOnlinePayment({ tenantId: A.tenantId, orderId: o2.id, customerId: null, returnUrl: "/", request: { mode: "AMOUNT", amountMinor: 1, idempotencyKey: key() }, now: later }); // süreyi doldurur
    expect((await paymentByPublic(late.publicId)).status).toBe("CANCELLED");
    await deliver(await providerRef(late.publicId), "payment.succeeded");
    expect(await paymentByPublic(late.publicId)).toMatchObject({ status: "SUCCEEDED", needsRefund: false });
    expect((await view(A, o2.id)).summary.paid).toBe(40_000);
  });
  it("16. sağlayıcı reddi → FAILED, rezervasyon serbest; zaman aşımı → 'kullanılamıyor', sipariş etkilenmez", async () => {
    const o = await order(A);
    mock.mockQueue("FAIL");
    const f = ok(await start(A, o.id, { mode: "FULL" }));
    expect(f.status).toBe("FAILED");
    expect((await view(A, o.id)).summary).toMatchObject({ reserved: 0, available: 40_000 });
    mock.mockQueue("TIMEOUT");
    expect(await start(A, o.id, { mode: "FULL" })).toEqual({ ok: false, reason: "provider_unavailable" });
    expect((await view(A, o.id)).summary.available).toBe(40_000);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("ACCEPTED");
  });
  it("17. kayıp webhook: sağlayıcı sorgusu (dönüş sayfası / mutabakat) kesinleştirir", async () => {
    const o = await order(A);
    const r = ok(await start(A, o.id, { mode: "FULL" }));
    const p = getPaymentProvider() as ReturnType<typeof mock.createMockProvider>;
    p.buildEvent(await providerRef(r.publicId), "payment.succeeded"); // sağlayıcıda başarılı, webhook teslim EDİLMEDİ
    const id = (await paymentByPublic(r.publicId)).id;
    expect(await svc.refreshFromProvider(A.tenantId, id)).toBe("SUCCEEDED");
    expect(await svc.reconcilePayment(A.actor, id)).toMatchObject({ local: "SUCCEEDED", provider: "SUCCEEDED", after: "SUCCEEDED" });
  });
});

describe("manuel ödeme ve iade", () => {
  it("18. nakit kaydı: idempotent, denetim kaydı, bakiye kuralına uyar; kapalı yöntem reddedilir", async () => {
    const o = await order(A);
    const k = key();
    const a = await svc.recordManualPayment(A.actor, { orderId: o.id, method: "CASH", amountMinor: 15_000, idempotencyKey: k });
    const b = await svc.recordManualPayment(A.actor, { orderId: o.id, method: "CASH", amountMinor: 15_000, idempotencyKey: k });
    expect(a.ok && b.ok && a.publicId === b.publicId).toBe(true);
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "PAYMENT_MANUAL_RECORDED" } })).toBeGreaterThanOrEqual(1);
    expect(await svc.recordManualPayment(A.actor, { orderId: o.id, method: "CARD_TERMINAL", amountMinor: 25_001, idempotencyKey: key() })).toEqual({ ok: false, reason: "amount_invalid" });
    const full = await svc.recordManualPayment(A.actor, { orderId: o.id, method: "CARD_TERMINAL", amountMinor: null, idempotencyKey: key() });
    expect(full.ok && full.amountMinor).toBe(25_000);
    expect((await view(A, o.id)).summary.state).toBe("PAID");
    await prisma.paymentSettings.update({ where: { tenantId: A.tenantId }, data: { allowCash: false } });
    const o2 = await order(A);
    expect(await svc.recordManualPayment(A.actor, { orderId: o2.id, method: "CASH", amountMinor: null, idempotencyKey: key() })).toEqual({ ok: false, reason: "disabled" });
    await prisma.paymentSettings.update({ where: { tenantId: A.tenantId }, data: { allowCash: true } });
  });
  it("19. iade: kısmi → tam; sınır aşımı reddedilir; bakiye yeniden açılmaz; denetim + değiştirilemez kayıt", async () => {
    const o = await order(A);
    mock.mockQueue("SUCCESS");
    const r = ok(await start(A, o.id, { mode: "FULL" }));
    const id = (await paymentByPublic(r.publicId)).id;
    expect(await svc.refundPayment(A.actor, { paymentId: id, amountMinor: 10_000, reason: "soğuk geldi", idempotencyKey: key() })).toMatchObject({ ok: true, status: "SUCCEEDED", refundedMinor: 10_000 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).status).toBe("PARTIALLY_REFUNDED");
    expect(await svc.refundPayment(A.actor, { paymentId: id, amountMinor: 30_001, reason: null, idempotencyKey: key() })).toEqual({ ok: false, reason: "over_limit" });
    const k = key();
    expect(await svc.refundPayment(A.actor, { paymentId: id, amountMinor: 30_000, reason: null, idempotencyKey: k })).toMatchObject({ ok: true, refundedMinor: 40_000 });
    expect(await svc.refundPayment(A.actor, { paymentId: id, amountMinor: 30_000, reason: null, idempotencyKey: k })).toMatchObject({ ok: true, replay: true });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).status).toBe("REFUNDED");
    expect((await view(A, o.id)).summary).toMatchObject({ remaining: 0, refunded: 40_000, state: "REFUNDED" });
    expect(await prisma.paymentRefund.count({ where: { paymentId: id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "PAYMENT_REFUNDED", entityId: id } })).toBe(2);
    const refund = await prisma.paymentRefund.findFirstOrThrow({ where: { paymentId: id } });
    await expect(prisma.paymentRefund.update({ where: { id: refund.id }, data: { amountMinor: 1 } })).rejects.toThrow();
    // Sipariş durumu değişmez (sadakat / kupon sipariş yaşam döngüsünü izler)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("ACCEPTED");
  });
  it("20. sağlayıcı iadeyi reddederse: kayıt FAILED, iade tutarı değişmez; eşzamanlı iki tam iade → biri", async () => {
    const o = await order(A);
    mock.mockQueue("SUCCESS");
    const id = (await paymentByPublic(ok(await start(A, o.id, { mode: "FULL" })).publicId)).id;
    mock.mockSetRefundFail(true);
    expect(await svc.refundPayment(A.actor, { paymentId: id, amountMinor: 5_000, reason: null, idempotencyKey: key() })).toMatchObject({ ok: true, status: "FAILED", refundedMinor: 0 });
    mock.mockSetRefundFail(false);
    const both = await Promise.all([svc.refundPayment(A.actor, { paymentId: id, amountMinor: 40_000, reason: null, idempotencyKey: key() }), svc.refundPayment(A.actor, { paymentId: id, amountMinor: 40_000, reason: null, idempotencyKey: key() })]);
    expect(both.filter((r) => r.ok && r.status === "SUCCEEDED")).toHaveLength(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id } })).refundedMinor).toBe(40_000);
  });
});

describe("veritabanı korumaları ve kiracı izolasyonu", () => {
  it("21. tetikleyiciler: doğrudan fazla ödeme, tutar değişimi, geri dönüş, dağılım güncellemesi, geçersiz son 4 reddedilir", async () => {
    const o = await order(A);
    await svc.recordManualPayment(A.actor, { orderId: o.id, method: "CASH", amountMinor: null, idempotencyKey: key() });
    const p = await prisma.payment.findFirstOrThrow({ where: { orderId: o.id }, include: { allocations: true } });
    const branchId = A.ctx.branchId;
    const base = { tenantId: A.tenantId, branchId, orderId: o.id, provider: "manual", method: "CASH" as const, splitMode: "AMOUNT" as const, currency: "TRY", requestHash: "x", idempotencyKeyHash: randomBytes(32).toString("hex") };
    await expect(prisma.payment.create({ data: { ...base, publicId: randomBytes(16).toString("base64url"), status: "SUCCEEDED", amountMinor: 1 } })).rejects.toThrow(/overpayment/);
    await expect(prisma.payment.update({ where: { id: p.id }, data: { amountMinor: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.payment.update({ where: { id: p.id }, data: { status: "FAILED" } })).rejects.toThrow(/regress/);
    await expect(prisma.paymentAllocation.update({ where: { id: p.allocations[0]!.id }, data: { amountMinor: 1 } })).rejects.toThrow(/append-only/);
    await expect(prisma.payment.update({ where: { id: p.id }, data: { cardLast4: "42424242" } })).rejects.toThrow();
    await expect(prisma.payment.create({ data: { ...base, idempotencyKeyHash: randomBytes(32).toString("hex"), publicId: randomBytes(16).toString("base64url"), status: "PENDING", amountMinor: 1, method: "ONLINE" } })).rejects.toThrow(); // ONLINE ⇔ sağlayıcı ≠ manual
  });
  it("22. kiracı izolasyonu: B, A'nın siparişini / ödemesini göremez, ödeyemez, iade edemez", async () => {
    const o = await order(A);
    mock.mockQueue("SUCCESS");
    const id = (await paymentByPublic(ok(await start(A, o.id, { mode: "FULL" })).publicId)).id;
    expect(await svc.loadOrderPaymentView(prisma, B.tenantId, o.id)).toBeNull();
    expect(await start(B, o.id, { mode: "FULL" })).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.recordManualPayment(B.actor, { orderId: o.id, method: "CASH", amountMinor: null, idempotencyKey: key() })).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.refundPayment(B.actor, { paymentId: id, amountMinor: 1, reason: null, idempotencyKey: key() })).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.reconcilePayment(B.actor, id)).toBeNull();
    // Çapraz kiracı dağılımı DB düzeyinde reddedilir (bileşik FK)
    await expect(prisma.paymentAllocation.create({ data: { tenantId: B.tenantId, paymentId: id, orderId: o.id, amountMinor: 1 } })).rejects.toThrow();
  });
  it("23. analitik: ödenmiş / kısmi / ödenmemiş + online / kasada / iade (yalnızca kendi kiracısı)", async () => {
    const m = await paymentMetrics(A.scope, { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 60_000) });
    expect(m.paidOrders).toBeGreaterThan(0);
    expect(m.onlineMinor).toBeGreaterThan(0);
    expect(m.manualMinor).toBeGreaterThan(0);
    expect(m.refundedMinor).toBeGreaterThanOrEqual(80_000);
    const mb = await paymentMetrics(B.scope, { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 60_000) });
    expect(mb).toMatchObject({ onlineMinor: 0, manualMinor: 0, refundedMinor: 0 });
  });
});

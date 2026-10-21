import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OrderContext } from "@/server/services/orders/submit-order.service";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { submitOrder } = await import("@/server/services/orders/submit-order.service");
const { acceptOrder, rejectOrder, cancelOrder } = await import("@/server/services/orders/order-status.service");
const { reverseLoyaltyInTx, updateLoyaltySettings } = await import("@/server/crm/loyalty.service");
const admin = await import("@/server/promotions/admin.service");
const { setConsents } = await import("./support-consents");

/**
 * Sprint 18 — kupon / ödül / kampanya, gerçek PostgreSQL (Neon). İki geçici kiracı; sonunda silinir.
 * Sepet: Burger 300 ₺ + 2× Ayran 50 ₺ = 400 ₺ (40.000 kuruş). Ayran "Soğuk" kategorisinde, o da "İçecek" altında.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };
const DAY = 86_400_000;

async function makeTenant(label: string) {
  const t = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Promo ${label} ${run}`,
      slug: `promo-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr" } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }, { name: "Kadıköy", slug: "kadikoy" }] },
      users: { create: { email: `promo-${label}-${run}@masanovai.test`, firstName: "P", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, branches: { select: { id: true, slug: true } }, users: { select: { id: true } } },
  });
  const tenantId = t.id;
  const merkez = t.branches.find((b) => b.slug === "merkez")!.id;
  const kadikoy = t.branches.find((b) => b.slug === "kadikoy")!.id;
  const ana = await prisma.menuCategory.create({ data: { tenantId, name: "Ana", slug: "ana" } });
  const icecek = await prisma.menuCategory.create({ data: { tenantId, name: "İçecek", slug: "icecek" } });
  const soguk = await prisma.menuCategory.create({ data: { tenantId, name: "Soğuk", slug: "soguk", parentId: icecek.id } });
  const burger = await prisma.product.create({ data: { tenantId, categoryId: ana.id, name: "Burger", slug: "burger", basePriceMinor: 30000 } });
  const ayran = await prisma.product.create({ data: { tenantId, categoryId: soguk.id, name: "Ayran", slug: "ayran", basePriceMinor: 5000 } });
  const tatli = await prisma.product.create({ data: { tenantId, categoryId: ana.id, name: "Sütlaç", slug: "sutlac", basePriceMinor: 12000 } });
  const station = await prisma.preparationStation.create({ data: { tenantId, branchId: merkez, name: "Mutfak", type: "KITCHEN" } });
  await prisma.branch.update({ where: { id: merkez }, data: { defaultStationId: station.id, defaultStationBranchId: merkez } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId: merkez, name: "Masa 1" } });
  const token = await prisma.tableQrToken.create({ data: { tenantId, branchId: merkez, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
  const ctx: OrderContext = { tenantId, branchId: merkez, tableId: table.id, tokenId: token.id, branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" };
  const userId = t.users[0]!.id;
  const scope = createTenantScope(tenantId);
  return { tenantId, scope, actor: { userId, scope, meta }, merkez, kadikoy, ctx, cats: { ana: ana.id, icecek: icecek.id, soguk: soguk.id }, products: { burger: burger.id, ayran: ayran.id, tatli: tatli.id } };
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
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

type Promo = { kind: "coupon"; code: string } | { kind: "reward"; rewardId: string } | null;
const lines = (extra: { product: string; quantity?: number; price: number }[] = []) => [{ product: "burger", price: 30000 }, { product: "ayran", quantity: 2, price: 5000 }, ...extra];
const input = (promotion: Promo, opts: { key?: string; items?: { product: string; quantity?: number; price: number }[]; raw?: Record<string, unknown> } = {}) =>
  submitOrderSchema.parse({
    items: (opts.items ?? lines()).map((l) => ({ product: l.product, variant: null, modifiers: [], quantity: l.quantity ?? 1, note: null, expectedUnitPriceMinor: l.price })),
    note: null,
    idempotencyKey: opts.key ?? randomBytes(18).toString("base64url"),
    locale: "tr",
    promotion,
    ...opts.raw,
  });
const place = (f: typeof A, promotion: Promo, opts: Parameters<typeof input>[1] & { customerId?: string | null } = {}) => submitOrder({ ...f.ctx, customerId: opts.customerId ?? null }, input(promotion, opts));
const coupon = async (f: typeof A, over: Partial<Parameters<typeof admin.saveCoupon>[2]> & { code: string }) => {
  const r = await admin.saveCoupon(f.actor, null, { name: over.code, description: null, type: "FIXED_AMOUNT", valueMinor: 10_000, percentageBps: null, maxDiscountMinor: null, minimumOrderMinor: null, scope: "ALL", productIds: [], categoryIds: [], freeProductId: null, branchId: null, startsAt: null, endsAt: null, daysMask: null, startMinute: null, endMinute: null, usageLimit: null, perCustomerLimit: null, audience: "ANYONE", status: "ACTIVE", ...over, codeNormalized: over.code });
  if (!r.ok) throw new Error(`coupon ${r.reason}`);
  return r.id;
};
const customer = async (f: typeof A, points = 0, opts: { member?: boolean } = {}) => {
  const c = await prisma.customer.create({ data: { tenantId: f.tenantId, publicId: randomBytes(16).toString("base64url"), firstName: "Müşteri", source: "QR_OPT_IN" }, select: { id: true } });
  if (opts.member !== false) {
    const acc = await prisma.loyaltyAccount.create({ data: { tenantId: f.tenantId, customerId: c.id, active: true }, select: { id: true } });
    if (points) await prisma.loyaltyLedger.create({ data: { tenantId: f.tenantId, accountId: acc.id, type: "ADJUSTMENT", points, reason: "test" } });
  }
  return c.id;
};
const balance = async (f: typeof A, customerId: string) => {
  const acc = await prisma.loyaltyAccount.findFirstOrThrow({ where: { tenantId: f.tenantId, customerId } });
  return (await prisma.loyaltyLedger.aggregate({ where: { accountId: acc.id }, _sum: { points: true } }))._sum.points ?? 0;
};
const created = (r: Awaited<ReturnType<typeof submitOrder>>) => {
  if (r.kind !== "created" && r.kind !== "duplicate") throw new Error(`not created: ${JSON.stringify(r)}`);
  return r.order;
};
const orderId = async (publicId: string) => (await prisma.order.findUniqueOrThrow({ where: { publicId }, select: { id: true } })).id;

describe("kupon hesapları", () => {
  it("1. sabit 100 ₺: indirim + değiştirilemez kopya + kullanım kaydı; toplam = ara toplam − indirim", async () => {
    await coupon(A, { code: "SABIT100" });
    const o = created(await place(A, { kind: "coupon", code: " sabit100 " }));
    expect(o).toMatchObject({ subtotalMinor: 40000, discountMinor: 10000, totalMinor: 30000 });
    const id = await orderId(o.publicId);
    const promo = await prisma.orderPromotion.findUniqueOrThrow({ where: { orderId: id } });
    expect(promo).toMatchObject({ kind: "COUPON", codeSnapshot: "SABIT100", discountMinor: 10000, label: "SABIT100" });
    expect(await prisma.couponRedemption.count({ where: { orderId: id } })).toBe(1);
    // Kopya canlı kupona bağlı değil: kupon değişse de sipariş aynı kalır; kopya UPDATE edilemez
    await prisma.coupon.updateMany({ where: { tenantId: A.tenantId, codeNormalized: "SABIT100" }, data: { name: "Değişti", valueMinor: 1 } });
    expect((await prisma.orderPromotion.findUniqueOrThrow({ where: { orderId: id } })).label).toBe("SABIT100");
    await expect(prisma.orderPromotion.update({ where: { orderId: id }, data: { discountMinor: 0 } })).rejects.toThrow();
    // CHECK: toplam ≠ ara toplam − indirim yazılamaz
    await expect(prisma.order.update({ where: { id }, data: { totalMinor: 40000 } })).rejects.toThrow();
  });
  it("2–3. yüzde (%10) ve tavan (%50, en fazla 50 ₺)", async () => {
    await coupon(A, { code: "YUZDE10", type: "PERCENTAGE", valueMinor: null, percentageBps: 1000 });
    await coupon(A, { code: "YARI50", type: "PERCENTAGE", valueMinor: null, percentageBps: 5000, maxDiscountMinor: 5000 });
    expect(created(await place(A, { kind: "coupon", code: "YUZDE10" })).discountMinor).toBe(4000);
    expect(created(await place(A, { kind: "coupon", code: "YARI50" })).discountMinor).toBe(5000);
  });
  it("4–7. en az sepet / süresi dolmuş / pasif / yanlış şube → sipariş OLUŞMAZ", async () => {
    await coupon(A, { code: "MIN500", minimumOrderMinor: 50000 });
    await coupon(A, { code: "ESKI", endsAt: new Date(Date.now() - DAY), startsAt: new Date(Date.now() - 10 * DAY) });
    await coupon(A, { code: "PASIF", status: "INACTIVE" });
    await coupon(A, { code: "KADIKOY", branchId: A.kadikoy });
    const before = await prisma.order.count({ where: { tenantId: A.tenantId } });
    expect(await place(A, { kind: "coupon", code: "MIN500" })).toEqual({ kind: "promotion_rejected", reason: "minimum_not_met" });
    expect(await place(A, { kind: "coupon", code: "ESKI" })).toEqual({ kind: "promotion_rejected", reason: "expired" });
    expect(await place(A, { kind: "coupon", code: "PASIF" })).toEqual({ kind: "promotion_rejected", reason: "invalid" });
    expect(await place(A, { kind: "coupon", code: "KADIKOY" })).toEqual({ kind: "promotion_rejected", reason: "branch" });
    expect(await prisma.order.count({ where: { tenantId: A.tenantId } })).toBe(before);
  });
  it("8–9. ürün kapsamı (yalnız ayran) ve kategori kapsamı (üst kategori İçecek)", async () => {
    const pid = await coupon(A, { code: "AYRANYARI", type: "PERCENTAGE", valueMinor: null, percentageBps: 5000, scope: "PRODUCTS", productIds: [A.products.ayran] });
    await coupon(A, { code: "ICECEK10", type: "PERCENTAGE", valueMinor: null, percentageBps: 1000, scope: "CATEGORIES", categoryIds: [A.cats.icecek] });
    expect(created(await place(A, { kind: "coupon", code: "AYRANYARI" })).discountMinor).toBe(5000);
    expect(created(await place(A, { kind: "coupon", code: "ICECEK10" })).discountMinor).toBe(1000);
    expect(await place(A, { kind: "coupon", code: "AYRANYARI" }, { items: [{ product: "burger", price: 30000 }] })).toEqual({ kind: "promotion_rejected", reason: "no_eligible_items" });
    expect(await prisma.couponProduct.count({ where: { couponId: pid } })).toBe(1);
  });
  it("ücretsiz ürün: yalnızca yapılandırılan ürün, bir birim, adet değişmez", async () => {
    await coupon(A, { code: "TATLI", type: "FREE_ITEM", valueMinor: null, freeProductId: A.products.tatli });
    expect(await place(A, { kind: "coupon", code: "TATLI" })).toEqual({ kind: "promotion_rejected", reason: "free_item_missing" });
    const o = created(await place(A, { kind: "coupon", code: "TATLI" }, { items: lines([{ product: "sutlac", quantity: 2, price: 12000 }]) }));
    expect(o).toMatchObject({ subtotalMinor: 64000, discountMinor: 12000, totalMinor: 52000, itemCount: 5 });
    expect((await prisma.orderPromotion.findUniqueOrThrow({ where: { orderId: await orderId(o.publicId) } })).freeItemName).toBe("Sütlaç");
  });
});

describe("kitle ve kullanım sınırları", () => {
  it("10–11. genel kupon anonim çalışır; üye-only kupon anonimde reddedilir, kayıtlıda çalışır", async () => {
    await coupon(A, { code: "UYEYE", audience: "IDENTIFIED" });
    await coupon(A, { code: "GENEL100" });
    expect(created(await place(A, { kind: "coupon", code: "GENEL100" })).discountMinor).toBe(10000);
    expect(await place(A, { kind: "coupon", code: "UYEYE" })).toEqual({ kind: "promotion_rejected", reason: "identified_only" });
    const c = await customer(A);
    expect(created(await place(A, { kind: "coupon", code: "UYEYE" }, { customerId: c })).discountMinor).toBe(10000);
  });
  it("12. toplam kullanım sınırı; reddedilen siparişin kullanımı sayılmaz", async () => {
    await coupon(A, { code: "TEK", usageLimit: 1 });
    const first = created(await place(A, { kind: "coupon", code: "TEK" }));
    expect(await place(A, { kind: "coupon", code: "TEK" })).toEqual({ kind: "promotion_rejected", reason: "usage_limit" });
    expect((await rejectOrder(A.actor, await orderId(first.publicId), "test")).ok).toBe(true);
    expect(created(await place(A, { kind: "coupon", code: "TEK" })).discountMinor).toBe(10000);
  });
  it("13. kişi başı sınır yalnız tanınan müşteride; eşzamanlı son hak tek kez", async () => {
    await coupon(A, { code: "KISIBASI", perCustomerLimit: 1 });
    const c = await customer(A);
    const both = await Promise.all([place(A, { kind: "coupon", code: "KISIBASI" }, { customerId: c }), place(A, { kind: "coupon", code: "KISIBASI" }, { customerId: c })]);
    expect(both.filter((r) => r.kind === "created")).toHaveLength(1);
    expect(both.filter((r) => r.kind === "promotion_rejected" && r.reason === "customer_limit")).toHaveLength(1);
    expect(created(await place(A, { kind: "coupon", code: "KISIBASI" })).discountMinor).toBe(10000); // anonim: kişi başı uygulanamaz (belgelendi)
  });
});

describe("sadakat ödülü", () => {
  let reward500 = "";
  beforeAll(async () => {
    await updateLoyaltySettings(A.actor, { enabled: true, minorPerPoint: 1000, earnOn: "ACCEPTED" });
    const r = await admin.saveReward(A.actor, null, { name: "50 ₺ indirim", description: null, pointsCost: 500, rewardType: "FIXED_AMOUNT", fixedDiscountMinor: 5000, percentageBps: null, maxDiscountMinor: null, minimumOrderMinor: null, freeProductId: null, isActive: true, startsAt: null, endsAt: null });
    if (!r.ok) throw new Error("reward");
    reward500 = r.id;
  });

  it("14–15. ödül: puan siparişle aynı anda düşer; yetersiz puan → sipariş yok; anonim ödül yok", async () => {
    const c = await customer(A, 600);
    const o = created(await place(A, { kind: "reward", rewardId: reward500 }, { customerId: c }));
    expect(o.discountMinor).toBe(5000);
    expect(await balance(A, c)).toBe(100);
    const redeem = await prisma.loyaltyLedger.findFirstOrThrow({ where: { orderId: await orderId(o.publicId), type: "REDEEM" } });
    expect(redeem).toMatchObject({ points: -500, rewardId: reward500 });
    const before = await prisma.order.count({ where: { tenantId: A.tenantId } });
    expect(await place(A, { kind: "reward", rewardId: reward500 }, { customerId: c })).toEqual({ kind: "promotion_rejected", reason: "insufficient_points" });
    expect(await place(A, { kind: "reward", rewardId: reward500 })).toEqual({ kind: "promotion_rejected", reason: "not_identified" });
    expect(await place(A, { kind: "reward", rewardId: reward500 }, { customerId: await customer(A, 0, { member: false }) })).toEqual({ kind: "promotion_rejected", reason: "not_member" });
    expect(await prisma.order.count({ where: { tenantId: A.tenantId } })).toBe(before);
  });

  it("16. eşzamanlı iki ödül (bakiye 500, ödül 500) → tam olarak bir kazanır", async () => {
    const c = await customer(A, 500);
    const results = await Promise.all([place(A, { kind: "reward", rewardId: reward500 }, { customerId: c }), place(A, { kind: "reward", rewardId: reward500 }, { customerId: c })]);
    expect(results.filter((r) => r.kind === "created")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "promotion_rejected" && r.reason === "insufficient_points")).toHaveLength(1);
    expect(await balance(A, c)).toBe(0);
  }, 60_000);

  it("17. aynı sipariş yeniden denenince puan iki kez düşmez (aynı sonuç)", async () => {
    const c = await customer(A, 1000);
    const key = randomBytes(18).toString("base64url");
    const [a, b] = await Promise.all([place(A, { kind: "reward", rewardId: reward500 }, { customerId: c, key }), place(A, { kind: "reward", rewardId: reward500 }, { customerId: c, key })]);
    const again = await place(A, { kind: "reward", rewardId: reward500 }, { customerId: c, key });
    expect(new Set([a, b, again].map((r) => created(r).publicId)).size).toBe(1);
    expect(created(again).discountMinor).toBe(5000);
    expect(await balance(A, c)).toBe(500);
    // Aynı anahtar + farklı promosyon → ret
    expect(await place(A, { kind: "coupon", code: "SABIT100" }, { customerId: c, key })).toEqual({ kind: "rejected", reason: "idempotency_conflict" });
  });

  it("18. ret / iptal: kullanılan puan iade, kazanılan puan geri alınır — tek kez (yeni defter satırı)", async () => {
    const c = await customer(A, 500);
    const o = created(await place(A, { kind: "reward", rewardId: reward500 }, { customerId: c }));
    const id = await orderId(o.publicId);
    expect(await balance(A, c)).toBe(0);
    expect((await acceptOrder(A.actor, id)).ok).toBe(true); // ACCEPTED → EARN (net 350 ₺ → 35 puan)
    expect(await balance(A, c)).toBe(35);
    expect((await cancelOrder(A.actor, id, "Müşteri vazgeçti")).ok).toBe(true);
    expect(await balance(A, c)).toBe(500);
    const reversals = await prisma.loyaltyLedger.findMany({ where: { type: "REVERSAL", reversesEntry: { orderId: id } } });
    expect(reversals.map((r) => r.points).sort((x, y) => x - y)).toEqual([-35, 500]);
    // Yeniden çağrı / yarış: ikinci geri alma yok; eski satırlar değişmez
    expect(await prisma.$transaction((tx) => reverseLoyaltyInTx(tx, { tenantId: A.tenantId, orderId: id }))).toBe(0);
    await expect(prisma.loyaltyLedger.update({ where: { id: reversals[0]!.id }, data: { points: 1 } })).rejects.toThrow();
    // Veritabanı: geçersiz geri alma (yanlış tutar) reddedilir
    const redeem = await prisma.loyaltyLedger.findFirstOrThrow({ where: { orderId: id, type: "REDEEM" } });
    await expect(prisma.loyaltyLedger.create({ data: { tenantId: A.tenantId, accountId: redeem.accountId, type: "REVERSAL", points: 1, reversesEntryId: redeem.id } })).rejects.toThrow();
  });

  it("ödül toplamı eksiye düşüremez (1.000 ₺ ödül, 400 ₺ sepet → toplam 0)", async () => {
    const big = await admin.saveReward(A.actor, null, { name: "Büyük", description: null, pointsCost: 10, rewardType: "FIXED_AMOUNT", fixedDiscountMinor: 100000, percentageBps: null, maxDiscountMinor: null, minimumOrderMinor: null, freeProductId: null, isActive: true, startsAt: null, endsAt: null });
    const c = await customer(A, 10);
    const o = created(await place(A, { kind: "reward", rewardId: big.ok ? big.id : "x" }, { customerId: c }));
    expect(o).toMatchObject({ subtotalMinor: 40000, discountMinor: 40000, totalMinor: 0 });
  });
});

describe("güvenlik ve bütünlük", () => {
  it("19. sipariş başarısız olursa kupon kullanımı / puan TÜKETİLMEZ", async () => {
    await coupon(A, { code: "BIRKEZ", usageLimit: 1 });
    // Başka kiracının müşterisi → sipariş yazımı (bileşik FK) başarısız → tüm transaction geri alınır
    const foreign = await customer(B);
    await expect(place(A, { kind: "coupon", code: "BIRKEZ" }, { customerId: foreign })).rejects.toThrow();
    const c = await prisma.coupon.findFirstOrThrow({ where: { tenantId: A.tenantId, codeNormalized: "BIRKEZ" } });
    expect(await prisma.couponRedemption.count({ where: { couponId: c.id } })).toBe(0);
    expect(created(await place(A, { kind: "coupon", code: "BIRKEZ" })).discountMinor).toBe(10000); // hak hâlâ duruyor
    // Fiyat değişti (mutabakat) → kupon da tüketilmez
    expect((await place(A, { kind: "coupon", code: "SABIT100" }, { items: [{ product: "burger", price: 1 }] })).kind).toBe("reconcile");
  });

  it("20. kiracı izolasyonu: A'nın kodu B'de geçersiz (nötr); aynı kod B'de bağımsız; B, A'nın kuponunu değiştiremez", async () => {
    expect(await place(B, { kind: "coupon", code: "YUZDE10" })).toEqual({ kind: "promotion_rejected", reason: "invalid" });
    await coupon(B, { code: "SABIT100", valueMinor: 2000 });
    expect(created(await place(B, { kind: "coupon", code: "SABIT100" })).discountMinor).toBe(2000);
    const aCoupon = await prisma.coupon.findFirstOrThrow({ where: { tenantId: A.tenantId, codeNormalized: "YUZDE10" } });
    expect(await admin.setCouponStatus(B.actor, aCoupon.id, "ARCHIVED")).toBe(false);
    expect(await admin.saveCoupon(B.actor, null, { name: "x", description: null, type: "FREE_ITEM", valueMinor: null, percentageBps: null, maxDiscountMinor: null, minimumOrderMinor: null, scope: "ALL", productIds: [], categoryIds: [], freeProductId: A.products.tatli, branchId: null, startsAt: null, endsAt: null, daysMask: null, startMinute: null, endMinute: null, usageLimit: null, perCustomerLimit: null, audience: "ANYONE", status: "ACTIVE", code: "CAPRAZ", codeNormalized: "CAPRAZ" })).toEqual({ ok: false, reason: "invalid_refs" });
    // A'nın ödülü B müşterisiyle kullanılamaz
    const rewardA = await prisma.loyaltyReward.findFirstOrThrow({ where: { tenantId: A.tenantId } });
    expect(await place(B, { kind: "reward", rewardId: rewardA.id }, { customerId: await customer(B, 10_000) })).toEqual({ kind: "promotion_rejected", reason: "loyalty_off" });
  });

  it("tarayıcı fiyat / indirim alanları yok sayılır; SQL parçası kod olarak geçersiz; yığma reddedilir", async () => {
    const o = created(await place(A, { kind: "coupon", code: "GENEL100" }, { raw: { discountMinor: 999999, totalMinor: 1 } }));
    expect(o).toMatchObject({ discountMinor: 10000, totalMinor: 30000 });
    expect(await place(A, { kind: "coupon", code: "' OR 1=1 --" })).toEqual({ kind: "promotion_rejected", reason: "invalid" });
    expect(await prisma.coupon.count({ where: { tenantId: A.tenantId } })).toBeGreaterThan(5); // tablo bozulmadı
  });

  it("21. destek modu / yetkisiz aktör: kampanya kitlesi yalnız SAYI döner; yazma servisleri kiracı dışını değiştiremez", async () => {
    const preview = await admin.campaignAudience(A.tenantId, "ALL_OPTED_IN", "EMAIL");
    expect(Object.keys(preview).sort()).toEqual(["deletionRequested", "eligible", "inSegment", "missingContact", "noConsent"]);
    const campaign = await admin.saveCampaign(A.actor, null, { name: "Taslak", channel: "EMAIL", segment: "ALL_OPTED_IN", couponId: null, messageTemplate: "Merhaba {{firstName}}" });
    expect(campaign.ok && (await admin.setCampaignStatus(B.actor, campaign.id, "ARCHIVED"))).toBe(false);
  });

  it("22. kampanya kitlesi GÜNCEL onaya göre süzülür; geri alınan izin anında düşer; kampanya onay üretmez", async () => {
    const base = await admin.campaignAudience(B.tenantId, "ALL_OPTED_IN", "EMAIL"); // önceki testlerin müşterileri (izinsiz)
    const mk = async (email: string | null) => (await prisma.customer.create({ data: { tenantId: B.tenantId, publicId: randomBytes(16).toString("base64url"), email, emailNormalized: email, source: "QR_OPT_IN" }, select: { id: true } })).id;
    const granted = await mk("a@x.test");
    const revoked = await mk("b@x.test");
    await mk("c@x.test"); // hiç izin yok
    const noEmail = await mk(null);
    await setConsents(prisma, B.tenantId, granted, ["MARKETING_EMAIL"], []);
    await setConsents(prisma, B.tenantId, revoked, ["MARKETING_EMAIL"], ["MARKETING_EMAIL"]);
    await setConsents(prisma, B.tenantId, noEmail, ["MARKETING_EMAIL"], []);
    const consentsBefore = await prisma.customerConsent.count({ where: { tenantId: B.tenantId } });
    const k = await admin.saveCampaign(B.actor, null, { name: "Kış", channel: "EMAIL", segment: "ALL_OPTED_IN", couponId: null, messageTemplate: "x" });
    expect(k.ok).toBe(true);
    const p = await admin.campaignAudience(B.tenantId, "ALL_OPTED_IN", "EMAIL");
    expect(p).toMatchObject({ eligible: base.eligible + 1, noConsent: base.noConsent + 2, missingContact: base.missingContact + 1 });
    expect(base.eligible).toBe(0);
    expect((await admin.campaignAudience(B.tenantId, "ALL_OPTED_IN", "SMS")).eligible).toBe(0);
    await setConsents(prisma, B.tenantId, granted, [], ["MARKETING_EMAIL"]);
    expect((await admin.campaignAudience(B.tenantId, "ALL_OPTED_IN", "EMAIL")).eligible).toBe(0);
    expect(await admin.setCampaignStatus(B.actor, k.ok ? k.id : "x", "READY")).toBe(true);
    const saved = await prisma.campaign.findFirstOrThrow({ where: { tenantId: B.tenantId, name: "Kış" } });
    expect(saved.audienceSnapshot).toMatchObject({ eligible: 0 });
    expect(await prisma.customerConsent.count({ where: { tenantId: B.tenantId } })).toBe(consentsBefore + 1); // yalnızca testin geri alma satırı
  });

  it("analitik toplamları (brüt / indirim / net) iptal-ret hariç tutarlı", async () => {
    const m = await admin.promotionMetrics(A.scope, { from: new Date(Date.now() - DAY), to: new Date(Date.now() + DAY) });
    expect(m.grossMinor - m.discountMinor).toBe(m.netMinor);
    expect(m.couponUses).toBeGreaterThan(5);
    expect(m.rewardRedemptions).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(m)).not.toMatch(/@|Müşteri/);
  });
});

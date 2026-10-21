import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OrderContext } from "@/server/services/orders/submit-order.service";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { submitOrder } = await import("@/server/services/orders/submit-order.service");
const { updateLoyaltySettings } = await import("@/server/crm/loyalty.service");
const admin = await import("@/server/promotions/admin.service");

/**
 * Sprint 18 ölçümü (npm run load:db): kuponun / ödülün sipariş gönderimine eklediği gecikme. 100 kupon kullanım
 * geçmişi olan bir kupon dahil. YEREL ölçüm (Neon, ağ dahil); SLA iddiası değildir → tmp/load/promotions.json.
 */
const run = randomBytes(3).toString("hex");
let tenantId = "";
let ctx: OrderContext;
let rewardId = "";
let customerId = "";

beforeAll(async () => {
  const t = await prisma.tenant.create({
    data: { subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } }, name: `Promo yük ${run}`, slug: `promo-load-${run}`, status: "ACTIVE", settings: { create: {} }, branches: { create: { name: "Merkez", slug: "merkez" } }, users: { create: { email: `promo-load-${run}@masanovai.test`, firstName: "L", lastName: "L", role: "TENANT_OWNER" } } },
    select: { id: true, branches: { select: { id: true } }, users: { select: { id: true } } },
  });
  tenantId = t.id;
  const branchId = t.branches[0]!.id;
  const scope = createTenantScope(tenantId);
  const actor = { scope, userId: t.users[0]!.id, meta: { ipAddress: null, userAgent: "load" } };
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Ana", slug: "ana" } });
  await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Burger", slug: "burger", basePriceMinor: 30000 } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId, name: "Masa 1" } });
  const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
  ctx = { tenantId, branchId, tableId: table.id, tokenId: token.id, branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" };
  await admin.saveCoupon(actor, null, { code: "YUK10", codeNormalized: "YUK10", name: "Yük", description: null, type: "PERCENTAGE", valueMinor: null, percentageBps: 1000, maxDiscountMinor: null, minimumOrderMinor: null, scope: "ALL", productIds: [], categoryIds: [], freeProductId: null, branchId: null, startsAt: null, endsAt: null, daysMask: null, startMinute: null, endMinute: null, usageLimit: 100000, perCustomerLimit: null, audience: "ANYONE", status: "ACTIVE" });
  await updateLoyaltySettings(actor, { enabled: true, minorPerPoint: 1000, earnOn: "SERVED" });
  const r = await admin.saveReward(actor, null, { name: "Ödül", description: null, pointsCost: 10, rewardType: "FIXED_AMOUNT", fixedDiscountMinor: 1000, percentageBps: null, maxDiscountMinor: null, minimumOrderMinor: null, freeProductId: null, isActive: true, startsAt: null, endsAt: null });
  rewardId = r.ok ? r.id : "";
  const c = await prisma.customer.create({ data: { tenantId, publicId: randomBytes(16).toString("base64url"), source: "QR_OPT_IN" }, select: { id: true } });
  customerId = c.id;
  const acc = await prisma.loyaltyAccount.create({ data: { tenantId, customerId, active: true }, select: { id: true } });
  await prisma.loyaltyLedger.create({ data: { tenantId, accountId: acc.id, type: "ADJUSTMENT", points: 100000, reason: "yük" } });
  // Kupon geçmişi: 100 kullanım (sınır sayımı gerçek sorgu yapsın)
  for (let i = 0; i < 100; i++) await submitOrder(ctx, input({ kind: "coupon", code: "YUK10" }));
}, 600_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}, 300_000);

function input(promotion: { kind: "coupon"; code: string } | { kind: "reward"; rewardId: string } | null) {
  return submitOrderSchema.parse({ items: [{ product: "burger", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 30000 }], note: null, idempotencyKey: randomBytes(18).toString("base64url"), locale: "tr", promotion });
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: Math.round(s[Math.floor(s.length / 2)]!), p95: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!) };
};

describe("promosyon gecikmesi", () => {
  it("sipariş gönderimi: promosyonsuz / kuponlu / ödüllü (her biri 15)", async () => {
    const measure = async (promo: Parameters<typeof input>[0], customer: string | null) => {
      const xs: number[] = [];
      for (let i = 0; i < 15; i++) {
        const t0 = performance.now();
        const r = await submitOrder({ ...ctx, customerId: customer }, input(promo));
        xs.push(performance.now() - t0);
        expect(r.kind).toBe("created");
      }
      return stats(xs);
    };
    const report = {
      measuredAt: new Date().toISOString(),
      plain: await measure(null, null),
      coupon: await measure({ kind: "coupon", code: "YUK10" }, null),
      reward: await measure({ kind: "reward", rewardId }, customerId),
    };
    const fs = await import("node:fs");
    fs.mkdirSync("tmp/load", { recursive: true });
    fs.writeFileSync("tmp/load/promotions.json", JSON.stringify(report, null, 2));
    console.log("PROMOTION_LOAD", JSON.stringify(report));
  }, 600_000);
});

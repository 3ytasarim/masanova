import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PayRequest } from "@/server/payments/payment.service";
import type { OrderContext } from "@/server/services/orders/submit-order.service";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));
process.env.PAYMENT_PROVIDER = "mock";

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { submitOrder } = await import("@/server/services/orders/submit-order.service");
const { acceptOrder } = await import("@/server/services/orders/order-status.service");
const svc = await import("@/server/payments/payment.service");
const { getPaymentProvider } = await import("@/server/payments/providers");
const mock = await import("@/server/payments/providers/mock");

/**
 * Sprint 19 ölçümü (npm run load:db): ödeme başlatma (anlık / barındırılan), webhook işleme, ürün bazlı bölme, kasada
 * ödeme ve durum sorgusu. TEST sağlayıcısı (ağ yok) → ölçülen yalnızca MasaNova + Neon. YEREL ölçüm; SLA değildir →
 * tmp/load/payments.json. Gerçek sağlayıcının ağ gecikmesi BU SAYILARA DAHİL DEĞİLDİR.
 */
const run = randomBytes(3).toString("hex");
let tenantId = "";
let ctx: OrderContext;
let actor: { scope: ReturnType<typeof createTenantScope>; userId: string; meta: { ipAddress: null; userAgent: string } };

beforeAll(async () => {
  const t = await prisma.tenant.create({
    data: { subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } }, name: `Ödeme yük ${run}`, slug: `pay-load-${run}`, status: "ACTIVE", settings: { create: {} }, paymentSettings: { create: { enabled: true } }, branches: { create: { name: "Merkez", slug: "merkez" } }, users: { create: { email: `pay-load-${run}@masanovai.test`, firstName: "L", lastName: "L", role: "TENANT_OWNER" } } },
    select: { id: true, branches: { select: { id: true } }, users: { select: { id: true } } },
  });
  tenantId = t.id;
  const branchId = t.branches[0]!.id;
  actor = { scope: createTenantScope(tenantId), userId: t.users[0]!.id, meta: { ipAddress: null, userAgent: "load" } };
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Ana", slug: "ana" } });
  await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Burger", slug: "burger", basePriceMinor: 30000 } });
  await prisma.product.create({ data: { tenantId, categoryId: cat.id, name: "Ayran", slug: "ayran", basePriceMinor: 5000 } });
  const station = await prisma.preparationStation.create({ data: { tenantId, branchId, name: "Mutfak", type: "KITCHEN" } });
  await prisma.branch.update({ where: { id: branchId }, data: { defaultStationId: station.id, defaultStationBranchId: branchId } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId, name: "Masa 1" } });
  const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
  ctx = { tenantId, branchId, tableId: table.id, tokenId: token.id, branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" };
}, 300_000);

afterAll(async () => {
  await prisma.paymentWebhookEvent.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}, 300_000);

async function acceptedOrder() {
  const r = await submitOrder(
    { ...ctx, customerId: null },
    submitOrderSchema.parse({ items: [{ product: "burger", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 30000 }, { product: "ayran", variant: null, modifiers: [], quantity: 4, note: null, expectedUnitPriceMinor: 5000 }], note: null, idempotencyKey: randomBytes(18).toString("base64url"), locale: "tr", promotion: null }),
  );
  if (r.kind !== "created") throw new Error(r.kind);
  const o = await prisma.order.findUniqueOrThrow({ where: { publicId: r.order.publicId }, select: { id: true, items: { select: { id: true } } } });
  await acceptOrder(actor, o.id);
  return o;
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: Math.round(s[Math.floor(s.length / 2)]!), p95: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!) };
};
const key = () => randomBytes(18).toString("base64url");
const start = (orderId: string, request: Omit<PayRequest, "idempotencyKey">) => svc.startOnlinePayment({ tenantId, orderId, customerId: null, returnUrl: "/", request: { ...request, idempotencyKey: key() } });

describe("ödeme gecikmesi", () => {
  it("başlatma / webhook / bölme / kasada / durum (her biri 15)", async () => {
    const N = 15;
    const orders = [];
    for (let i = 0; i < N; i++) orders.push(await acceptedOrder());
    const full: number[] = [];
    const hosted: number[] = [];
    const webhook: number[] = [];
    const items: number[] = [];
    const manual: number[] = [];
    const status: number[] = [];
    const provider = getPaymentProvider() as ReturnType<typeof mock.createMockProvider>;
    for (const o of orders) {
      // 1) ürün bazlı (1 ayran) anlık başarı
      mock.mockQueue("SUCCESS");
      let t0 = performance.now();
      expect((await start(o.id, { mode: "ITEMS", items: [{ orderItemId: o.items[1]!.id, quantity: 1 }] })).ok).toBe(true);
      items.push(performance.now() - t0);
      // 2) barındırılan akış başlatma + imzalı webhook
      t0 = performance.now();
      const h = await start(o.id, { mode: "AMOUNT", amountMinor: 5000 });
      hosted.push(performance.now() - t0);
      if (!h.ok) throw new Error(h.reason);
      const ref = (await prisma.paymentAttempt.findFirstOrThrow({ where: { payment: { publicId: h.publicId } } })).providerReference!;
      const e = provider.buildEvent(ref, "payment.succeeded");
      t0 = performance.now();
      expect((await svc.processWebhook("mock", e.rawBody, new Headers({ "x-masanova-signature": e.signature }))).outcome).toBe("processed");
      webhook.push(performance.now() - t0);
      // 3) kasada kısmi
      t0 = performance.now();
      expect((await svc.recordManualPayment(actor, { orderId: o.id, method: "CASH", amountMinor: 5000, idempotencyKey: key() })).ok).toBe(true);
      manual.push(performance.now() - t0);
      // 4) durum sorgusu (müşteri sayfası)
      t0 = performance.now();
      await svc.loadOrderPaymentView(prisma, tenantId, o.id);
      status.push(performance.now() - t0);
      // 5) kalanın tamamı anlık başarı
      mock.mockQueue("SUCCESS");
      t0 = performance.now();
      expect((await start(o.id, { mode: "FULL" })).ok).toBe(true);
      full.push(performance.now() - t0);
    }
    const report = { measuredAt: new Date().toISOString(), provider: "mock (ağ yok)", fullInstant: stats(full), hostedStart: stats(hosted), webhook: stats(webhook), itemSplit: stats(items), manualCash: stats(manual), statusView: stats(status) };
    const fs = await import("node:fs");
    fs.mkdirSync("tmp/load", { recursive: true });
    fs.writeFileSync("tmp/load/payments.json", JSON.stringify(report, null, 2));
    console.log("PAYMENT_LOAD", JSON.stringify(report));
  }, 900_000);
});

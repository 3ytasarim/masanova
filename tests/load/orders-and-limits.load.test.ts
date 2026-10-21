import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startFakeRedis, type FakeRedis } from "../support/fake-redis";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { submitOrderSchema } = await import("@/lib/validation/orders");
const { submitOrder } = await import("@/server/services/orders/submit-order.service");
const { createRedisBackend, createMemoryBackend } = await import("@/server/rate-limit/providers");

/**
 * Yük temeli (ölçüm + doğruluk): eşzamanlı sipariş gönderimi (benzersiz + yinelenen anahtarlar) ve hız sınırı arka
 * uçlarının verimi. Sayılar ORTAMA bağlıdır (yerel makine + uzak Neon); SLA değildir — rapora "gözlenen" olarak yazılır.
 */
const run = randomBytes(3).toString("hex");
let tenantId = "";
let ctx: Parameters<typeof submitOrder>[0];
let fake: FakeRedis;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } }, name: `Yük ${run}`, slug: `load-${run}`, status: "ACTIVE", settings: { create: { defaultLocale: "tr" } }, branches: { create: [{ name: "Merkez", slug: "merkez" }] } }, select: { id: true, branches: { select: { id: true } } } });
  tenantId = tenant.id;
  const branchId = tenant.branches[0]!.id;
  const station = await prisma.preparationStation.create({ data: { tenantId, branchId, name: "Mutfak" }, select: { id: true } });
  await prisma.branch.updateMany({ where: { id: branchId, tenantId }, data: { defaultStationId: station.id, defaultStationBranchId: branchId } });
  const category = await prisma.menuCategory.create({ data: { tenantId, name: "Çorbalar", slug: "corbalar" } });
  await prisma.product.create({ data: { tenantId, categoryId: category.id, name: "Çorba", slug: "corba", basePriceMinor: 12000 } });
  const table = await prisma.diningTable.create({ data: { tenantId, branchId, name: "Masa 1" } });
  const token = await prisma.tableQrToken.create({ data: { tenantId, branchId, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
  ctx = { tenantId, branchId, tableId: table.id, tokenId: token.id, branchName: "Merkez", tableName: "Masa 1", areaName: null, defaultLocale: "tr" };
  fake = await startFakeRedis();
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await fake.close();
});

const order = (key: string) => submitOrderSchema.parse({ items: [{ product: "corba", variant: null, modifiers: [], quantity: 1, note: null, expectedUnitPriceMinor: 12000 }], note: null, idempotencyKey: key, locale: "tr" });

describe("yük: sipariş gönderimi", () => {
  it("60 benzersiz + 20 yinelenen (aynı anahtar) eşzamanlı gönderim: tam 60 sipariş, sıra numaraları tekil", async () => {
    const keys = Array.from({ length: 60 }, () => randomBytes(18).toString("base64url"));
    const jobs = [...keys, ...keys.slice(0, 20)];
    const latencies: number[] = [];
    const started = performance.now();
    let next = 0;
    const outcomes: string[] = [];
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        while (next < jobs.length) {
          const key = jobs[next++]!;
          const t = performance.now();
          outcomes.push((await submitOrder(ctx, order(key))).kind);
          latencies.push(performance.now() - t);
        }
      }),
    );
    const elapsed = (performance.now() - started) / 1000;
    latencies.sort((a, b) => a - b);
    console.info(JSON.stringify({ label: "order-submit", submits: jobs.length, concurrency: 10, perSecond: Math.round(jobs.length / elapsed), p50: Math.round(latencies[Math.floor(latencies.length / 2)]!), p95: Math.round(latencies[Math.floor(latencies.length * 0.95)]!), outcomes: outcomes.reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {}) }));
    expect(await prisma.order.count({ where: { tenantId } })).toBe(60);
    const numbers = (await prisma.order.findMany({ where: { tenantId }, select: { orderNumber: true } })).map((o) => o.orderNumber);
    expect(new Set(numbers).size).toBe(60);
  });
});

describe("yük: hız sınırı arka uçları", () => {
  it("bellek ve Redis (sahte, RESP): 2000 eşzamanlı vuruş — sınır tam uygulanır; verim ölçülür", async () => {
    const mem = createMemoryBackend();
    const c1 = new Redis({ port: fake.port, host: "127.0.0.1" });
    const c2 = new Redis({ port: fake.port, host: "127.0.0.1" });
    const redis = [createRedisBackend(c1), createRedisBackend(c2)];
    for (const [label, hit] of [
      ["memory", (i: number) => mem.hit("k-mem", 500, 60_000).then((r) => (void i, r))],
      ["redis-2-clients", (i: number) => redis[i % 2]!.hit("k-redis", 500, 60_000)],
    ] as const) {
      const started = performance.now();
      const results = await Promise.all(Array.from({ length: 2000 }, (_, i) => hit(i)));
      const elapsed = performance.now() - started;
      console.info(JSON.stringify({ label: `ratelimit-${label}`, hits: 2000, allowed: results.filter((r) => r.allowed).length, opsPerSecond: Math.round(2000 / (elapsed / 1000)) }));
      expect(results.filter((r) => r.allowed)).toHaveLength(500);
    }
    c1.disconnect();
    c2.disconnect();
  });
});

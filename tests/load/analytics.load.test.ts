import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { resolveAnalyticsContext } = await import("@/server/analytics/filter");
const { computeSection, ANALYTICS_SECTIONS } = await import("@/server/analytics/dashboard.service");
const { csvText } = await import("@/server/analytics/csv.service");

/**
 * Analitik yük fikstürü: GEÇİCİ kiracıya 10.000 sipariş, ~25.000 satır, ~12.000 fiş, 3.000 servis talebi, 600 AI turu
 * (son 30 güne yayılmış). Her bölüm 5 kez hesaplanır (önbelleksiz) → p50 / p95; ana sorguların EXPLAIN ANALYZE planı
 * tmp/analytics-explain.txt'ye yazılır. Kiracı sonunda silinir (demo verisi kirlenmez).  npm run load:db
 */
const run = randomBytes(3).toString("hex");
let tenantId = "";
let scope: ReturnType<typeof createTenantScope>;
const NOW = new Date();
const ORDERS = 10_000;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } }, name: `Analitik Yük ${run}`, slug: `an-load-${run}`, status: "ACTIVE", plan: "AI", settings: { create: { defaultLocale: "tr", timezone: "Europe/Istanbul" } }, branches: { create: [{ name: "Merkez", slug: "merkez" }, { name: "Şube 2", slug: "sube-2" }] } },
    select: { id: true, branches: { select: { id: true } } },
  });
  tenantId = tenant.id;
  scope = createTenantScope(tenantId);
  const branchIds = tenant.branches.map((b) => b.id);
  const cat = await prisma.menuCategory.create({ data: { tenantId, name: "Ana", slug: "ana" } });
  const products = await Promise.all(Array.from({ length: 40 }, (_, i) => prisma.product.create({ data: { tenantId, categoryId: cat.id, name: `Ürün ${i}`, slug: `urun-${i}`, basePriceMinor: 5000 + i * 700 } })));
  const tables = await Promise.all(Array.from({ length: 30 }, (_, i) => prisma.diningTable.create({ data: { tenantId, branchId: branchIds[i % 2]!, name: `M${i}` } })));
  const stations = await Promise.all(branchIds.flatMap((b) => [prisma.preparationStation.create({ data: { tenantId, branchId: b, name: "Mutfak" } }), prisma.preparationStation.create({ data: { tenantId, branchId: b, name: "Bar", type: "BAR" } })]));

  const orders: Prisma.OrderCreateManyInput[] = [];
  const items: Prisma.OrderItemCreateManyInput[] = [];
  const tickets: Prisma.OrderTicketCreateManyInput[] = [];
  const seqByBranch = new Map<string, number>();
  const statuses = ["SERVED", "SERVED", "SERVED", "READY", "ACCEPTED", "REJECTED", "CANCELLED", "SUBMITTED"] as const;
  for (let i = 0; i < ORDERS; i++) {
    const table = tables[i % tables.length]!;
    const created = new Date(NOW.getTime() - Math.floor(((i * 7919) % 1000) / 1000 * 30 * 86_400_000));
    const status = statuses[i % statuses.length]!;
    const accepted = status === "REJECTED" || status === "SUBMITTED" ? null : new Date(created.getTime() + 60_000);
    const id = `ld${run}${String(i).padStart(6, "0")}`;
    const n = (seqByBranch.get(table.branchId) ?? 1000) + 1;
    seqByBranch.set(table.branchId, n);
    let total = 0;
    for (let k = 0; k < 2 + (i % 3); k++) {
      const p = products[(i + k * 7) % products.length]!;
      const qty = 1 + ((i + k) % 3);
      total += p.basePriceMinor * qty;
      items.push({ tenantId, orderId: id, productId: p.id, productName: p.name, productNameDefault: p.name, basePriceMinor: p.basePriceMinor, modifiersTotalMinor: 0, unitPriceMinor: p.basePriceMinor, quantity: qty, lineTotalMinor: p.basePriceMinor * qty, sortOrder: k });
    }
    orders.push({ id, tenantId, branchId: table.branchId, tableId: table.id, publicId: randomBytes(16).toString("base64url"), orderNumber: n, status, currency: "TRY", subtotalMinor: total, totalMinor: total, itemCount: 3, locale: "tr", branchName: "Merkez", tableName: table.name, areaName: i % 2 ? "Bahçe" : "Salon", idempotencyKeyHash: randomBytes(16).toString("hex"), requestHash: "x", submittedAt: created, createdAt: created, acceptedAt: accepted, readyAt: accepted && status !== "ACCEPTED" ? new Date(accepted.getTime() + (5 + (i % 20)) * 60_000) : null, servedAt: status === "SERVED" ? new Date(accepted!.getTime() + 30 * 60_000) : null });
    if (accepted && status !== "CANCELLED") {
      const own = stations.filter((s) => s.branchId === table.branchId);
      for (const st of own.slice(0, 1 + (i % 2))) tickets.push({ tenantId, branchId: table.branchId, orderId: id, stationId: st.id, stationName: st.name, stationType: st.type, status: "READY", createdAt: accepted, startedAt: new Date(accepted.getTime() + 60_000), readyAt: new Date(accepted.getTime() + (4 + (i % 15)) * 60_000) });
    }
  }
  for (let i = 0; i < orders.length; i += 2000) await prisma.order.createMany({ data: orders.slice(i, i + 2000) });
  for (let i = 0; i < items.length; i += 5000) await prisma.orderItem.createMany({ data: items.slice(i, i + 5000) });
  for (let i = 0; i < tickets.length; i += 5000) await prisma.orderTicket.createMany({ data: tickets.slice(i, i + 5000) });
  const requests: Prisma.TableServiceRequestCreateManyInput[] = Array.from({ length: 3000 }, (_, i) => {
    const table = tables[i % tables.length]!;
    const created = new Date(NOW.getTime() - ((i * 104729) % (30 * 86_400_000)));
    return { tenantId, branchId: table.branchId, tableId: table.id, publicId: randomBytes(16).toString("base64url"), type: (["WAITER", "WATER", "NAPKIN", "BILL"] as const)[i % 4], status: "COMPLETED", activeSlot: null, branchName: "Merkez", tableName: table.name, areaName: i % 2 ? "Bahçe" : "Salon", createdAt: created, acknowledgedAt: new Date(created.getTime() + (30 + (i % 300)) * 1000), completedAt: new Date(created.getTime() + 600_000) };
  });
  await prisma.tableServiceRequest.createMany({ data: requests });
  // Teşhis: toplu eklemeden HEMEN sonra (istatistikler bayatken) satış adedi sorgusunun planı
  const stalePlan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`EXPLAIN SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id WHERE oi.tenant_id = ${tenantId} AND o.created_at >= ${new Date(NOW.getTime() - 30 * 86_400_000)} AND o.created_at < ${NOW}`);
  console.info(JSON.stringify({ label: "stale-stats-plan", plan: stalePlan.map((r) => r["QUERY PLAN"]).join(" | ") }));
  console.info(JSON.stringify({ fixture: { orders: orders.length, items: items.length, tickets: tickets.length, serviceRequests: requests.length } }));
}, 600_000);

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
}, 300_000);

describe("analitik yük temeli", () => {
  it("her bölüm (son 30 gün, önbelleksiz) — p50 / p95; CSV 10k satır", async () => {
    const r = await resolveAnalyticsContext(scope, { range: "last30" }, NOW);
    if (!r.ok) throw new Error(r.error);
    const report: Record<string, { p50: number; p95: number }> = {};
    for (const section of ANALYTICS_SECTIONS) {
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        await computeSection(r.context, section);
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      report[section] = { p50: Math.round(times[2]!), p95: Math.round(times[4]!) };
    }
    const overview = await computeSection(r.context, "overview");
    expect(overview.funnel.submitted).toBeGreaterThan(9_000);
    const t = performance.now();
    const csv = await csvText("orders", r.context);
    const csvMs = Math.round(performance.now() - t);
    expect(csv.split("\r\n").filter(Boolean).length).toBe(overview.funnel.submitted + 1);
    console.info(JSON.stringify({ label: "analytics-sections-ms", ...report, csvOrdersMs: csvMs, csvBytes: csv.length }));
  });

  it("genel bakış alt sorguları ayrı ayrı (aykırı değer teşhisi)", async () => {
    const { orderKpis, orderFunnel, orderTrend, orderHeatmap } = await import("@/server/analytics/orders.analytics");
    const { orderTimings } = await import("@/server/analytics/kds.analytics");
    const { serviceSummary } = await import("@/server/analytics/service.analytics");
    const r = await resolveAnalyticsContext(scope, { range: "last30" }, NOW);
    if (!r.ok) throw new Error(r.error);
    const f = r.context.filter;
    const parts: Record<string, () => Promise<unknown>> = { kpis: () => orderKpis(f), prevKpis: () => orderKpis(r.context.previousFilter), funnel: () => orderFunnel(f), timings: () => orderTimings(f), service: () => serviceSummary(f), trend: () => orderTrend(f, "day"), heatmap: () => orderHeatmap(f) };
    const out: Record<string, number[]> = {};
    for (let round = 0; round < 3; round++) {
      for (const [name, fn] of Object.entries(parts)) {
        const t = performance.now();
        await fn();
        (out[name] ??= []).push(Math.round(performance.now() - t));
      }
    }
    const t = performance.now();
    await Promise.all(Object.values(parts).map((fn) => fn()));
    console.info(JSON.stringify({ label: "overview-parts-ms", ...out, parallelAllMs: Math.round(performance.now() - t) }));
  });

  it("sorgu planları (EXPLAIN ANALYZE) — tmp/analytics-explain.txt", async () => {
    const start = new Date(NOW.getTime() - 30 * 86_400_000);
    const plans: Record<string, string> = {};
    const explain = async (name: string, sql: Prisma.Sql) => {
      const rows = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
      plans[name] = rows.map((r) => r["QUERY PLAN"]).join("\n");
    };
    await explain("orders_kpis", Prisma.sql`SELECT COUNT(*), SUM(total_minor) FROM orders o WHERE o.tenant_id = ${tenantId} AND o.created_at >= ${start} AND o.created_at < ${NOW}`);
    await explain("products", Prisma.sql`SELECT oi.product_id, SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.tenant_id = oi.tenant_id WHERE oi.tenant_id = ${tenantId} AND o.tenant_id = ${tenantId} AND o.created_at >= ${start} AND o.created_at < ${NOW} GROUP BY 1`);
    await explain("tickets", Prisma.sql`SELECT t.station_id, COUNT(*) FROM order_tickets t WHERE t.tenant_id = ${tenantId} AND t.created_at >= ${start} AND t.created_at < ${NOW} GROUP BY 1`);
    await explain("service", Prisma.sql`SELECT r.type, COUNT(*) FROM table_service_requests r WHERE r.tenant_id = ${tenantId} AND r.created_at >= ${start} AND r.created_at < ${NOW} GROUP BY 1`);
    const out = path.resolve(import.meta.dirname, "../../tmp/analytics-explain.txt");
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, Object.entries(plans).map(([k, v]) => `== ${k}\n${v}\n`).join("\n"));
    const summary = Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, { seqScan: /Seq Scan on (orders|order_items|order_tickets|table_service_requests)/.test(v), indexes: [...new Set([...v.matchAll(/Index (?:Only )?Scan (?:Backward )?using (\S+)/g)].map((m) => m[1]))], execMs: Number(/Execution Time: ([\d.]+)/.exec(v)?.[1] ?? NaN) }]));
    console.info(JSON.stringify({ label: "explain", ...summary }));
    expect(Object.keys(plans)).toHaveLength(4);
  });
});

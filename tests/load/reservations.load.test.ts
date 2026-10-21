import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { addDays, localParts, zonedLocalToUtc } = await import("@/lib/reservations/time");
const { DEFAULT_POLICY } = await import("@/lib/reservations/rules");
const settings = await import("@/server/reservations/settings.service");
const { dayAvailability } = await import("@/server/reservations/availability.service");
const { createReservation } = await import("@/server/reservations/booking.service");

/**
 * Sprint 17 yük ölçümü (npm run load:db ile): 100 masa + 10.000 rezervasyon (90 güne yayılmış), geçici kiracı.
 * Ölçülen: tek gün uygunluk sorgusu (public kanal) ve kilitli oluşturma. SONUÇLAR YEREL ÖLÇÜMDÜR (Neon, ağ dahil);
 * SLA iddiası değildir. Rapor tmp/load/reservations.json'a yazılır.
 */
const TZ = "Europe/Istanbul";
const run = randomBytes(3).toString("hex");
let tenantId = "";
let branchId = "";
let actor: Parameters<typeof settings.savePolicy>[0];
const today = localParts(new Date(), TZ).date;

beforeAll(async () => {
  const t = await prisma.tenant.create({
    data: { subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } }, name: `Rez Yük ${run}`, slug: `rez-load-${run}`, status: "ACTIVE", settings: { create: {} }, branches: { create: { name: "Merkez", slug: "merkez", timezone: TZ } }, users: { create: { email: `rez-load-${run}@masanovai.test`, firstName: "L", lastName: "L", role: "TENANT_OWNER" } } },
    select: { id: true, branches: { select: { id: true } }, users: { select: { id: true } } },
  });
  tenantId = t.id;
  branchId = t.branches[0]!.id;
  actor = { scope: createTenantScope(tenantId), userId: t.users[0]!.id, meta: { ipAddress: null, userAgent: "load" }, canOverride: true };
  const area = await prisma.diningArea.create({ data: { tenantId, branchId, name: "Salon", slug: "salon" } });
  await prisma.diningTable.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ tenantId, branchId, diningAreaId: area.id, name: `M${i + 1}`, capacity: [2, 4, 4, 6][i % 4]!, sortOrder: i })) });
  const tables = await prisma.diningTable.findMany({ where: { tenantId }, select: { id: true } });
  await settings.setOpeningHours(actor, branchId, Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, intervals: [{ opensMinute: 12 * 60, closesMinute: 1440 }] })));
  await settings.savePolicy(actor, { ...DEFAULT_POLICY, enabled: true, publicBookingEnabled: true, defaultDurationMinutes: 120, slotIntervalMinutes: 15, minAdvanceMinutes: 0, maxAdvanceDays: 120 });

  // 10.000 rezervasyon: 90 gün × ~111 / gün, masa başına çakışmasız 2 saatlik bloklar (12:00–24:00 = 6 blok).
  const reservations: Prisma.ReservationCreateManyInput[] = [];
  const blocks: { id: string; tableId: string; startsAt: Date; endsAt: Date }[] = [];
  let n = 0;
  for (let d = -45; d < 45 && n < 10_000; d++) {
    const date = addDays(today, d);
    for (let k = 0; k < 112 && n < 10_000; k++, n++) {
      const tableId = tables[k % 100]!.id;
      const slot = Math.floor(k / 100) * 3 + (k % 3); // aynı masada çakışmasız
      const z = zonedLocalToUtc(date, 12 * 60 + slot * 120, TZ);
      if (z.kind === "missing") continue;
      const id = `rl${run}${String(n).padStart(6, "0")}`;
      const endsAt = new Date(z.at.getTime() + 120 * 60_000);
      reservations.push({ id, tenantId, branchId, publicId: `${id}p`, manageTokenHash: `${id}h`, manageTokenNonce: "n", guestName: `Misafir ${n}`, partySize: 2, startsAt: z.at, endsAt, durationMinutes: 120, status: d < 0 ? "COMPLETED" : "CONFIRMED", source: "STAFF" });
      blocks.push({ id, tableId, startsAt: z.at, endsAt });
    }
  }
  for (let i = 0; i < reservations.length; i += 2000) await prisma.reservation.createMany({ data: reservations.slice(i, i + 2000) });
  for (let i = 0; i < blocks.length; i += 2000) {
    await prisma.reservationTable.createMany({ data: blocks.slice(i, i + 2000).map((b) => ({ tenantId, branchId, reservationId: b.id, tableId: b.tableId, startsAt: b.startsAt, blockedUntil: b.endsAt, active: b.startsAt.getTime() > Date.now() })) });
  }
}, 600_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}, 300_000);

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: s[Math.floor(s.length * 0.5)]!, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!, max: s[s.length - 1]! };
};

describe("rezervasyon yükü", () => {
  it("100 masa + 10.000 rezervasyon: uygunluk ve oluşturma süreleri", async () => {
    expect(await prisma.reservation.count({ where: { tenantId } })).toBe(10_000);
    const availability: number[] = [];
    let slots = 0;
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const r = await dayAvailability(tenantId, { branchId, date: addDays(today, 1 + (i % 10)), partySize: 2 + (i % 4), channel: "public" });
      availability.push(performance.now() - started);
      if (r.kind === "ok") slots += r.slots.length;
    }
    const creates: number[] = [];
    for (let i = 0; i < 10; i++) {
      const z = zonedLocalToUtc(addDays(today, 50 + i), 19 * 60, TZ);
      const started = performance.now();
      const r = await createReservation(tenantId, { branchId, startsAt: z.kind === "missing" ? new Date() : z.at, partySize: 4, guestName: "Yük", guestPhone: null, guestEmail: null, preferredAreaId: null, specialRequest: null, source: "STAFF", customerId: null, locale: "tr" }, actor);
      creates.push(performance.now() - started);
      expect(r.ok).toBe(true);
    }
    const report = { measuredAt: new Date().toISOString(), fixture: { tables: 100, reservations: 10_000, days: 90 }, availabilityMs: stats(availability), avgSlotsPerQuery: slots / 20, createMs: stats(creates) };
    const fs = await import("node:fs");
    fs.mkdirSync("tmp/load", { recursive: true });
    fs.writeFileSync("tmp/load/reservations.json", JSON.stringify(report, null, 2));
    console.log("RESERVATION_LOAD", JSON.stringify(report));
    expect(slots).toBeGreaterThan(0);
  });
});

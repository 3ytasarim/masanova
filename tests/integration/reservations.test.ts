import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { addDays, localParts, zonedLocalToUtc } = await import("@/lib/reservations/time");
const { DEFAULT_POLICY, isManageTokenFormat } = await import("@/lib/reservations/rules");
const POLICY = { ...DEFAULT_POLICY, enabled: true, publicBookingEnabled: true, defaultDurationMinutes: 120, minAdvanceMinutes: 30 };
const booking = await import("@/server/reservations/booking.service");
const settings = await import("@/server/reservations/settings.service");
const { dayAvailability } = await import("@/server/reservations/availability.service");
const { reservationDetail, listDay, reservationMetrics, seatedByTable } = await import("@/server/reservations/queries.service");
const { listKdsTickets } = await import("@/server/repositories/kds.repository");

/**
 * Sprint 17 — rezervasyon, gerçek PostgreSQL (Neon). İki geçici kiracı (A: İstanbul + Berlin şubesi, B), sonunda silinir.
 * Tarih: İstanbul'da bugünden 3 gün sonra (ileri tarih kuralına takılmaz).
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };
const TZ = "Europe/Istanbul";
const DAY = addDays(localParts(new Date(), TZ).date, 3);
const local = (hhmm: string, date = DAY, tz = TZ) => {
  const r = zonedLocalToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz);
  if (r.kind === "missing") throw new Error("missing");
  return r.at;
};

async function makeTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Rez ${label} ${run}`,
      slug: `rez-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr" } },
      branches: { create: [{ name: "Merkez", slug: "merkez", timezone: TZ }, { name: "Berlin", slug: "berlin", timezone: "Europe/Berlin" }] },
      users: { create: { email: `rez-${label}-${run}@masanovai.test`, firstName: "R", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, branches: { select: { id: true, slug: true } }, users: { select: { id: true } } },
  });
  const tenantId = tenant.id;
  const merkez = tenant.branches.find((b) => b.slug === "merkez")!.id;
  const berlin = tenant.branches.find((b) => b.slug === "berlin")!.id;
  const salon = await prisma.diningArea.create({ data: { tenantId, branchId: merkez, name: "İç Salon", slug: "salon" } });
  const bahce = await prisma.diningArea.create({ data: { tenantId, branchId: merkez, name: "Bahçe", slug: "bahce" } });
  const mk = (branchId: string, name: string, capacity: number | null, areaId: string | null, extra: object = {}) => prisma.diningTable.create({ data: { tenantId, branchId, name, capacity, diningAreaId: areaId, ...extra }, select: { id: true, name: true } });
  const tables = {
    t2: await mk(merkez, "Masa 2", 2, salon.id),
    t4: await mk(merkez, "Masa 4", 4, salon.id),
    t4b: await mk(merkez, "Bahçe 4", 4, bahce.id),
    t6: await mk(merkez, "Bahçe 6", 6, bahce.id),
    tNoCap: await mk(merkez, "Masa 12", null, salon.id),
    solo: await mk(berlin, "Tek Masa", 4, null),
  };
  const userId = tenant.users[0]!.id;
  const scope = createTenantScope(tenantId);
  const actor = { scope, userId, meta, canOverride: true };
  const allDay = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, intervals: [{ opensMinute: 0, closesMinute: 1440 }] }));
  await settings.setOpeningHours(actor, merkez, allDay);
  await settings.setOpeningHours(actor, berlin, allDay);
  await settings.savePolicy(actor, { enabled: true, publicBookingEnabled: true, autoConfirm: true, defaultDurationMinutes: 120, slotIntervalMinutes: 30, minAdvanceMinutes: 30, maxAdvanceDays: 60, minPartySize: 1, maxPartySize: 8, bufferMinutes: 0, cancellationCutoffMinutes: 60, noShowGraceMinutes: 15 });
  return { tenantId, scope, actor, merkez, berlin, areas: { salon: salon.id, bahce: bahce.id }, tables };
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
  expect(await prisma.reservation.count({ where: { tenantId: { in: ids } } })).toBe(0);
});

type Over = Partial<Parameters<typeof booking.createReservation>[1]>;
const input = (f: typeof A, startsAt: Date, over: Over = {}) => ({
  branchId: f.merkez,
  startsAt,
  partySize: 2,
  guestName: "Ayşe Test",
  guestPhone: "+905321112233",
  guestEmail: "ayse@mail.test",
  preferredAreaId: null,
  specialRequest: "Pencere kenarı",
  source: "PUBLIC_WEB" as const,
  customerId: null,
  locale: "tr",
  ...over,
});
const tablesOf = async (id: string) => (await prisma.reservationTable.findMany({ where: { reservationId: id }, select: { tableId: true, active: true } }));

let firstId = "";
let firstToken = "";

describe("oluşturma ve atama", () => {
  it("1–2. public rezervasyon: CONFIRMED (otomatik onay), en küçük uygun masa, belirteç + geçmiş + denetim", async () => {
    const r = await booking.createReservation(A.tenantId, input(A, local("18:00")), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    firstId = r.reservation.id;
    firstToken = r.manageToken;
    expect(r.reservation.status).toBe("CONFIRMED");
    expect(r.reservation.tableNames).toEqual(["Masa 2"]);
    expect(isManageTokenFormat(r.manageToken)).toBe(true);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: firstId } });
    expect(row.manageTokenHash).not.toContain(r.manageToken);
    expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(120 * 60_000);
    expect(await prisma.reservationStatusHistory.count({ where: { reservationId: firstId } })).toBe(1);
    const audit = await prisma.auditLog.findMany({ where: { tenantId: A.tenantId, entityId: firstId } });
    expect(audit.map((x) => x.action).sort()).toEqual(["RESERVATION_CONFIRMED", "RESERVATION_CREATED", "RESERVATION_TABLE_ASSIGNED"]);
    // Denetimde iletişim / ham belirteç yok
    expect(JSON.stringify(audit)).not.toMatch(/905321112233|ayse@mail|Pencere/);
    expect(JSON.stringify(audit)).not.toContain(r.manageToken);
  });

  it("3. çakışma yok: aynı masa aynı saatte ikinci kez atanamaz; motor sonraki uygun masayı verir; veritabanı da reddeder", async () => {
    const forced = await booking.createReservation(A.tenantId, input(A, local("19:00"), { source: "STAFF", tableIds: [A.tables.t2.id] }), A.actor);
    expect(forced).toEqual({ ok: false, reason: "no_table" });
    const auto = await booking.createReservation(A.tenantId, input(A, local("19:00")), null);
    expect(auto.ok && auto.reservation.tableNames.length).toBe(1);
    expect(auto.ok && ["Masa 4", "Bahçe 4"].includes(auto.reservation.tableNames[0]!)).toBe(true);
    // Kod atlansa bile EXCLUDE kısıtı: elle çakışan etkin satır
    const other = auto.ok ? auto.reservation.id : "";
    await expect(prisma.reservationTable.create({ data: { tenantId: A.tenantId, branchId: A.merkez, reservationId: other, tableId: A.tables.t2.id, startsAt: local("19:00"), blockedUntil: local("21:00"), active: true } })).rejects.toThrow();
  });

  it("5–6. çakışmayan ve bitişik (20:00) saat aynı masaya verilir", async () => {
    const adjacent = await booking.createReservation(A.tenantId, input(A, local("20:00"), { source: "STAFF", tableIds: [A.tables.t2.id] }), A.actor);
    expect(adjacent.ok).toBe(true);
    const later = await booking.createReservation(A.tenantId, input(A, local("22:00"), { source: "STAFF", tableIds: [A.tables.t2.id] }), A.actor);
    expect(later.ok).toBe(true);
  });

  it("7. temizlik payı: 15 dk pay ile 14:00 reddedilir, 14:15 kabul", async () => {
    await settings.savePolicy(A.actor, { ...POLICY, bufferMinutes: 15 });
    const first = await booking.createReservation(A.tenantId, input(A, local("12:00"), { source: "STAFF", tableIds: [A.tables.t4b.id] }), A.actor);
    expect(first.ok).toBe(true);
    expect(await booking.createReservation(A.tenantId, input(A, local("14:00"), { source: "STAFF", tableIds: [A.tables.t4b.id] }), A.actor)).toEqual({ ok: false, reason: "no_table" });
    expect((await booking.createReservation(A.tenantId, input(A, local("14:15"), { source: "STAFF", tableIds: [A.tables.t4b.id] }), A.actor)).ok).toBe(true);
    // Pay öncesi de korunur: 09:45–11:45 + 15 = 12:00 → bitişik kabul; 10:00 reddedilir
    expect(await booking.createReservation(A.tenantId, input(A, local("10:00"), { source: "STAFF", tableIds: [A.tables.t4b.id] }), A.actor)).toEqual({ ok: false, reason: "no_table" });
    expect((await booking.createReservation(A.tenantId, input(A, local("09:45"), { source: "STAFF", tableIds: [A.tables.t4b.id] }), A.actor)).ok).toBe(true);
    await settings.savePolicy(A.actor, { ...POLICY, bufferMinutes: 0 });
  });

  it("10. bölge tercihi: bahçe istenince bahçedeki en küçük boş masa", async () => {
    const r = await booking.createReservation(A.tenantId, input(A, local("07:00"), { preferredAreaId: A.areas.bahce }), null);
    expect(r.ok && r.reservation.tableNames).toEqual(["Bahçe 4"]);
    expect(await booking.createReservation(A.tenantId, input(A, local("07:00"), { preferredAreaId: B.areas.bahce }), null)).toEqual({ ok: false, reason: "area_invalid" });
  });

  it("11. masa birleşimi: 6'dan büyük grup tanımlı birleşime; kapasitesi boş masa hiç atanmaz", async () => {
    expect(await settings.createCombination(A.actor, A.merkez, "Masa 4 + Bahçe 6", [A.tables.t4.id, A.tables.t6.id])).toBe("ok");
    expect(await settings.createCombination(A.actor, A.merkez, "Yabancı", [A.tables.t4.id, B.tables.t6.id])).toBe("invalid");
    const r = await booking.createReservation(A.tenantId, input(A, local("13:00"), { partySize: 8 }), null);
    expect(r.ok && r.reservation.tableNames.sort()).toEqual(["Bahçe 6", "Masa 4"]);
    const nine = await booking.createReservation(A.tenantId, input(A, local("13:00"), { partySize: 9, source: "STAFF" }), A.actor);
    expect(nine).toMatchObject({ ok: false, reason: "no_table", maxSeatable: 10 });
    expect(await prisma.reservationTable.count({ where: { tableId: A.tables.tNoCap.id } })).toBe(0);
  });

  it("public: kişi sınırı, kapalı saat, kapalı dönem, tarayıcı masa seçemez / walk-in yapamaz", async () => {
    expect(await booking.createReservation(A.tenantId, input(A, local("15:00"), { partySize: 9 }), null)).toMatchObject({ ok: false, reason: "party_too_large", maxSeatable: 8 });
    await settings.setOpeningHours(A.actor, A.merkez, Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, intervals: [{ opensMinute: 9 * 60, closesMinute: 1440 }] })));
    expect(await booking.createReservation(A.tenantId, input(A, local("03:00")), null)).toEqual({ ok: false, reason: "closed" });
    expect(await settings.addBlackout(A.actor, A.merkez, { startsAt: local("11:00"), endsAt: local("12:00"), reason: "Özel etkinlik" })).toBe(true);
    expect(await booking.createReservation(A.tenantId, input(A, local("11:30")), null)).toEqual({ ok: false, reason: "blackout" });
    const sneaky = await booking.createReservation(A.tenantId, input(A, local("17:00"), { tableIds: [A.tables.t6.id], walkIn: true }), null);
    expect(sneaky.ok && sneaky.reservation.status).toBe("CONFIRMED");
    expect(sneaky.ok && sneaky.reservation.tableNames).not.toContain("Bahçe 6");
    expect(await prisma.reservation.count({ where: { tenantId: A.tenantId, source: "WALK_IN" } })).toBe(0);
    // Yönetici kural aşabilir (denetlenir) ama çakışmayı aşamaz
    const over = await booking.createReservation(A.tenantId, input(A, local("03:00"), { source: "STAFF" }), A.actor, { override: true });
    expect(over.ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "RESERVATION_OVERRIDE", entityId: over.ok ? over.reservation.id : "x" } })).toBe(1);
    expect(await booking.createReservation(A.tenantId, input(A, local("18:00"), { source: "STAFF", tableIds: [A.tables.t2.id] }), A.actor, { override: true })).toEqual({ ok: false, reason: "no_table" });
  });
});

describe("eşzamanlılık ve idempotency", () => {
  it("4. 10 eşzamanlı istek, tek masa, aynı saat → tam olarak 1 kazanır", async () => {
    const at = local("19:00");
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => booking.createReservation(A.tenantId, { ...input(A, at), branchId: A.berlin, guestName: `Yarış ${i}` }, null)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "no_table")).toHaveLength(9);
    expect(await prisma.reservationTable.count({ where: { tableId: A.tables.solo.id, active: true } })).toBe(1);
  }, 60_000);

  it("19. idempotency: aynı anahtar + içerik → aynı rezervasyon (eşzamanlı da); farklı içerik → ret", async () => {
    const key = randomBytes(12).toString("base64url");
    const base = { ...input(A, local("21:00"), { partySize: 4 }), idempotencyKey: key, requestHash: "h1" };
    const [a, b, c] = await Promise.all([booking.createReservation(A.tenantId, base, null), booking.createReservation(A.tenantId, base, null), booking.createReservation(A.tenantId, base, null)]);
    const ids = [a, b, c].map((r) => (r.ok ? r.reservation.id : null));
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).not.toBeNull();
    expect([a, b, c].filter((r) => r.ok && r.replay)).toHaveLength(2);
    // Yeniden denemede aynı yönetim bağlantısı (ham belirteç saklanmadan türetilir)
    expect(new Set([a, b, c].map((r) => (r.ok ? r.manageToken : "")))).toHaveProperty("size", 1);
    expect(await booking.createReservation(A.tenantId, { ...base, partySize: 3, requestHash: "h2" }, null)).toEqual({ ok: false, reason: "idempotency_conflict" });
    expect(await prisma.reservation.count({ where: { tenantId: A.tenantId, idempotencyKeyHash: { not: null }, startsAt: local("21:00") } })).toBe(1);
  }, 60_000);
});

describe("durumlar", () => {
  it("12. walk-in: şimdi, WALK_IN, doğrudan SEATED, masa atanır; masalar sayfasında bağlam", async () => {
    const r = await booking.createReservation(A.tenantId, { ...input(A, new Date()), source: "WALK_IN", guestName: "Walk-in", guestPhone: null, guestEmail: null, specialRequest: null, walkIn: true, partySize: 3 }, A.actor);
    expect(r.ok && r.reservation.status).toBe("SEATED");
    const seated = await seatedByTable(A.scope);
    expect([...seated.values()].some((s) => s.guestName === "Walk-in" && s.partySize === 3)).toBe(true);
  });

  it("13–14. masaya al → tamamla: masa serbest kalır, aynı saat yeniden verilebilir", async () => {
    expect(await booking.transitionReservation(A.actor, firstId, "SEATED")).toEqual({ ok: true });
    expect(await booking.transitionReservation(A.actor, firstId, "COMPLETED")).toEqual({ ok: true });
    expect((await tablesOf(firstId)).every((t) => !t.active)).toBe(true);
    const again = await booking.createReservation(A.tenantId, input(A, local("18:00"), { source: "STAFF", tableIds: [A.tables.t2.id] }), A.actor);
    expect(again.ok).toBe(true);
    expect(await booking.transitionReservation(A.actor, firstId, "SEATED")).toEqual({ ok: false, reason: "invalid_transition" });
    const history = await prisma.reservationStatusHistory.findMany({ where: { reservationId: firstId }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.toStatus)).toEqual(["CONFIRMED", "SEATED", "COMPLETED"]);
    // Geçmiş değiştirilemez
    await expect(prisma.reservationStatusHistory.update({ where: { id: history[0]!.id }, data: { reason: "x" } })).rejects.toThrow();
  });

  it("15–16. iptal masayı serbest bırakır; gelmedi yalnızca bekleme payından sonra", async () => {
    const r = await booking.createReservation(A.tenantId, input(A, local("21:30"), { source: "PHONE" }), A.actor);
    if (!r.ok) throw new Error("create");
    expect(await booking.transitionReservation(A.actor, r.reservation.id, "CANCELLED")).toEqual({ ok: true });
    expect((await tablesOf(r.reservation.id)).every((t) => !t.active)).toBe(true);
    const n = await booking.createReservation(A.tenantId, input(A, local("21:30"), { source: "PHONE" }), A.actor);
    if (!n.ok) throw new Error("create");
    expect(await booking.transitionReservation(A.actor, n.reservation.id, "NO_SHOW")).toEqual({ ok: false, reason: "too_early" });
    expect(await booking.transitionReservation(A.actor, n.reservation.id, "NO_SHOW", { now: new Date(local("21:30").getTime() + 16 * 60_000) })).toEqual({ ok: true });
    const m = await reservationMetrics(A.scope, { from: local("00:00"), to: local("00:00", addDays(DAY, 1)), timeZone: TZ });
    expect(m.byStatus.NO_SHOW).toBe(1);
    expect(m.byStatus.CANCELLED).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(m)).not.toMatch(/Ayşe|905321112233/);
  });

  it("60. masa değiştirme: kendi bloğu hariç, dolu masaya izin yok", async () => {
    const r = await booking.createReservation(A.tenantId, input(A, local("09:00"), { source: "STAFF" }), A.actor);
    if (!r.ok) throw new Error("create");
    const moved = await booking.reassignTables(A.actor, r.reservation.id, [A.tables.t6.id]);
    expect(moved).toEqual({ ok: true, tableNames: ["Bahçe 6"] });
    const blocker = await booking.createReservation(A.tenantId, input(A, local("09:00"), { source: "STAFF", tableIds: [A.tables.t4.id] }), A.actor);
    expect(blocker.ok).toBe(true);
    expect(await booking.reassignTables(A.actor, r.reservation.id, [A.tables.t4.id])).toEqual({ ok: false, reason: "no_table" });
    expect(await booking.reassignTables(B.actor, r.reservation.id, [A.tables.t4.id])).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("müşteri bağlantısı ve izolasyon", () => {
  it("17. yönetim belirteci: yalnız gerekli alanlar (iç not yok), iptal; iptal sınırı uygulanır", async () => {
    await booking.updateInternalNote(A.actor, firstId, "VIP — gizli not");
    const view = await booking.findByManageToken(A.tenantId, firstToken);
    expect(view?.id).toBe(firstId);
    expect(Object.keys(view!)).not.toContain("internalNote");
    expect(JSON.stringify(view)).not.toContain("gizli not");
    const r = await booking.createReservation(A.tenantId, input(A, local("20:00", addDays(DAY, 1))), null);
    if (!r.ok) throw new Error("create");
    expect(await booking.cancelByManageToken(A.tenantId, r.manageToken)).toEqual({ ok: true });
    const soon = await booking.createReservation(A.tenantId, input(A, local("20:00", addDays(DAY, 2)), { source: "STAFF" }), A.actor);
    if (!soon.ok) throw new Error("create");
    expect(await booking.cancelByManageToken(A.tenantId, soon.manageToken, new Date(local("20:00", addDays(DAY, 2)).getTime() - 30 * 60_000))).toEqual({ ok: false, reason: "cutoff" });
  });

  it("18. belirteç izolasyonu: başka kiracı / rastgele belirteç / biçimsiz değer → yok", async () => {
    expect(await booking.findByManageToken(B.tenantId, firstToken)).toBeNull();
    expect(await booking.cancelByManageToken(B.tenantId, firstToken)).toEqual({ ok: false, reason: "not_found" });
    expect(await booking.findByManageToken(A.tenantId, randomBytes(32).toString("base64url").slice(0, 43))).toBeNull();
    expect(await booking.findByManageToken(A.tenantId, firstId)).toBeNull();
  });

  it("8–9. şube ve kiracı izolasyonu", async () => {
    // Başka şubenin masası seçilemez; şubeler birbirinin doluluğunu görmez
    expect(await booking.createReservation(A.tenantId, input(A, local("19:00"), { source: "STAFF", tableIds: [A.tables.solo.id] }), A.actor)).toEqual({ ok: false, reason: "tables_invalid" });
    expect((await listDay(A.scope, { id: A.berlin, timezone: "Europe/Berlin" }, DAY)).every((r) => r.tableNames.every((n) => n === "Tek Masa"))).toBe(true);
    // Başka kiracı göremez / değiştiremez / masasını kullanamaz
    expect(await reservationDetail(B.scope, firstId, { reveal: true })).toBeNull();
    expect(await booking.transitionReservation(B.actor, firstId, "CANCELLED")).toEqual({ ok: false, reason: "not_found" });
    expect(await booking.createReservation(B.tenantId, input(B, local("19:00"), { source: "STAFF", tableIds: [A.tables.t6.id] }), B.actor)).toEqual({ ok: false, reason: "tables_invalid" });
    expect(await booking.createReservation(B.tenantId, { ...input(B, local("19:00")), branchId: A.merkez }, null)).toEqual({ ok: false, reason: "branch_invalid" });
    expect(await booking.updateInternalNote(B.actor, firstId, "x")).toBe(false);
  });

  it("20. CRM: yalnızca tanınan müşteri bağlanır; anonim rezervasyon CRM profili ya da pazarlama izni OLUŞTURMAZ", async () => {
    const customers = await prisma.customer.count({ where: { tenantId: A.tenantId } });
    const anon = await booking.createReservation(A.tenantId, input(A, local("15:00"), { guestPhone: "+905559998877" }), null);
    expect(anon.ok).toBe(true);
    expect(await prisma.customer.count({ where: { tenantId: A.tenantId } })).toBe(customers);
    expect(await prisma.customerConsent.count({ where: { tenantId: A.tenantId } })).toBe(0);
    const c = await prisma.customer.create({ data: { tenantId: A.tenantId, publicId: randomBytes(16).toString("base64url"), firstName: "Kayıtlı", source: "QR_OPT_IN" }, select: { id: true } });
    const linked = await booking.createReservation(A.tenantId, input(A, local("15:30"), { customerId: c.id, partySize: 4 }), null);
    expect(linked.ok).toBe(true);
    const d = await reservationDetail(A.scope, linked.ok ? linked.reservation.id : "x", { reveal: true });
    expect(d?.customer).toEqual({ id: c.id, name: "Kayıtlı" });
    expect(await prisma.customerConsent.count({ where: { tenantId: A.tenantId } })).toBe(0);
    // Başka kiracının müşterisi bağlanamaz (bileşik yabancı anahtar)
    await expect(booking.createReservation(B.tenantId, input(B, local("15:30"), { customerId: c.id }), B.actor)).rejects.toThrow();
  });

  it("21. destek modu / liste: iletişim maskeli", async () => {
    const masked = await reservationDetail(A.scope, firstId, { reveal: false });
    expect(masked?.guestPhone).toBe("0532 *** ** 33");
    expect(masked?.guestEmail).toBe("a***@mail.test");
    const list = await listDay(A.scope, { id: A.merkez, timezone: TZ }, DAY);
    expect(JSON.stringify(list)).not.toContain("905321112233");
  });

  it("KDS rezervasyon verisi içermez", async () => {
    expect(JSON.stringify(await listKdsTickets(A.scope))).not.toMatch(/Ayşe Test|Walk-in|905321112233/);
  });
});

describe("saat dilimi ve uygunluk", () => {
  it("22. İstanbul 19:00 = 16:00Z saklanır; Berlin ileri alma gününde 02:xx slotu yok, geri alma gününde tek", async () => {
    const r = await booking.createReservation(A.tenantId, input(A, local("19:30"), { source: "STAFF", partySize: 2 }), A.actor);
    if (!r.ok) throw new Error("create");
    expect(localParts(r.reservation.startsAt, TZ).minute).toBe(19 * 60 + 30);
    const spring = await dayAvailability(A.tenantId, { branchId: A.berlin, date: "2027-03-28", partySize: 2, channel: "staff", now: new Date("2027-03-20T00:00:00Z") });
    expect(spring.kind).toBe("ok");
    if (spring.kind === "ok") expect(spring.slots.some((s) => s.label.startsWith("02:"))).toBe(false);
    const fall = await dayAvailability(A.tenantId, { branchId: A.berlin, date: "2027-10-31", partySize: 2, channel: "staff", now: new Date("2027-10-20T00:00:00Z") });
    if (fall.kind === "ok") expect(fall.slots.filter((s) => s.label === "02:30")).toHaveLength(1);
  });

  it("uygunluk yalnızca gerçekten masası olan saatleri döner (dolu saat yok)", async () => {
    const at = await dayAvailability(A.tenantId, { branchId: A.berlin, date: DAY, partySize: 2, channel: "public" });
    expect(at.kind).toBe("ok");
    if (at.kind !== "ok") return;
    // Tek masa 19:00–21:00 dolu (yarış testi) → 17:30–20:30 başlangıçları yok (120 dk süre)
    const race = localParts(local("19:00"), "Europe/Berlin"); // tek masa bu andan itibaren 120 dk dolu
    const taken = at.slots.filter((s) => {
      const p = localParts(new Date(s.startsAt), "Europe/Berlin");
      return p.date === race.date && p.minute > race.minute - 120 && p.minute < race.minute + 120;
    });
    expect(at.slots.length).toBeGreaterThan(0);
    expect(taken).toEqual([]);
  });
});

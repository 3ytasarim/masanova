import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import type { RealtimeEnvelope } from "@/lib/realtime/events";
import type { ServiceRequestContext } from "@/server/services/service-requests/customer-request.service";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: () => unknown) => fn }));

const { prisma } = await import("@/lib/db/prisma");
const { createTenantScope } = await import("@/lib/tenant/scope");
const { serviceAbilities } = await import("@/lib/service-requests/status");
const customer = await import("@/server/services/service-requests/customer-request.service");
const staff = await import("@/server/services/service-requests/staff-request.service");
const repo = await import("@/server/repositories/service-requests.repository");
const { getRealtimeProvider, tableChannel, tenantOrdersChannel } = await import("@/server/realtime/bus");

/**
 * Sprint 8 — servis talepleri, gerçek PostgreSQL (Neon). İki geçici kiracı; sonunda silinir.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };

async function makeTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Servis ${label} ${run}`,
      slug: `srv-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: { defaultLocale: "tr", timezone: "Europe/Istanbul" } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }] },
    },
    select: { id: true, branches: { select: { id: true, name: true } } },
  });
  const tenantId = tenant.id;
  const branch = tenant.branches[0]!;
  const area = await prisma.diningArea.create({ data: { tenantId, branchId: branch.id, name: "Bahçe", slug: "bahce" } });
  const users: Record<string, { id: string; role: UserRole }> = {};
  for (const [key, role, first] of [
    ["owner", "TENANT_OWNER", "Sahip"],
    ["manager", "BRANCH_MANAGER", "Müdür"],
    ["w1", "WAITER", "Merve"],
    ["w2", "WAITER", "Can"],
    ["cashier", "CASHIER", "Kasa"],
    ["kitchen", "KITCHEN", "Aşçı"],
  ] as const) {
    const u = await prisma.user.create({ data: { tenantId, email: `srv-${label}-${key}-${run}@masanovai.test`, firstName: first, lastName: "Test", role }, select: { id: true } });
    users[key] = { id: u.id, role };
  }
  const mkTable = async (name: string) => {
    const table = await prisma.diningTable.create({ data: { tenantId, branchId: branch.id, diningAreaId: area.id, name } });
    const token = await prisma.tableQrToken.create({ data: { tenantId, branchId: branch.id, tableId: table.id, tokenHash: randomBytes(32).toString("hex"), tokenNonce: randomBytes(16).toString("base64url") } });
    const ctx: ServiceRequestContext = { tenantId, branchId: branch.id, tableId: table.id, areaId: area.id, tokenId: token.id, branchName: branch.name, areaName: area.name, tableName: name };
    return ctx;
  };
  const scope = createTenantScope(tenantId);
  const actor = (key: string) => {
    const u = users[key]!;
    return { userId: u.id, displayName: `${key}`, scope, meta, abilities: serviceAbilities(u.role) };
  };
  return { tenantId, scope, users, actor, t1: await mkTable("Masa 1"), t2: await mkTable("Masa 2"), t3: await mkTable("Masa 3") };
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
  expect(await prisma.tableServiceRequest.count({ where: { tenantId: { in: ids } } })).toBe(0);
});

const submit = (ctx: ServiceRequestContext, type: "WAITER" | "WATER" | "NAPKIN" | "BILL" | "CUSTOM", note: string | null = null, recentOrderIds: string[] = []) => customer.submitServiceRequest(ctx, { type, note, recentOrderIds });
const internal = (publicId: string) => prisma.tableServiceRequest.findUniqueOrThrow({ where: { publicId }, include: { history: { orderBy: { createdAt: "asc" } } } });

function capture(channel: string) {
  const events: RealtimeEnvelope[] = [];
  const off = getRealtimeProvider().subscribe(channel, (e) => events.push(e));
  return { events, off };
}

describe("oluşturma", () => {
  it("1–4. garson / su / peçete / hesap talepleri; kopyalar, geçmiş, denetim (IP yok)", async () => {
    for (const type of ["WAITER", "WATER", "NAPKIN", "BILL"] as const) {
      const res = await submit(A.t1, type);
      expect(res.kind).toBe("created");
      if (res.kind !== "created") return;
      expect(res.request).toMatchObject({ type, status: "OPEN", staffName: null });
      expect(res.request.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);
      const row = await internal(res.request.publicId);
      expect(row).toMatchObject({ tenantId: A.tenantId, tableName: "Masa 1", areaName: "Bahçe", branchName: "Merkez", activeSlot: "ACTIVE", note: null });
      expect(row.history.map((h) => [h.fromStatus, h.toStatus, h.actorType])).toEqual([[null, "OPEN", "CUSTOMER"]]);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: A.tenantId, action: "SERVICE_REQUEST_CREATED", entityId: row.id } });
      expect(audit.ipAddress).toBeNull();
      expect(audit.userId).toBeNull();
    }
  });

  it("5. özel istek: not zorunlu; düz metin saklanır; diğer tiplerde not tutulmaz", async () => {
    expect(await submit(A.t2, "CUSTOM", null)).toEqual({ kind: "rejected", reason: "invalid" });
    const res = await submit(A.t2, "CUSTOM", "Çocuk sandalyesi rica edebilir miyiz?");
    expect(res.kind === "created" && res.request.note).toBe("Çocuk sandalyesi rica edebilir miyiz?");
    const water = await submit(A.t2, "WATER", "gizli not");
    expect(water.kind === "created" && water.request.note).toBeNull();
    await expect(prisma.tableServiceRequest.updateMany({ where: { tableId: A.t2.tableId, type: "CUSTOM" }, data: { note: "x".repeat(200) } })).rejects.toThrow(); // CHECK
  });

  it("6. mükerrer: aynı masa + tip aktifken mevcut talep döner, ikincisi oluşmaz", async () => {
    const first = await submit(A.t3, "WAITER");
    const again = await submit(A.t3, "WAITER");
    expect(again.kind).toBe("duplicate");
    expect(again.kind !== "rejected" && first.kind !== "rejected" && again.request.publicId === first.request.publicId).toBe(true);
    expect(await prisma.tableServiceRequest.count({ where: { tableId: A.t3.tableId, type: "WAITER" } })).toBe(1);
  });

  it("7. eşzamanlı 8 gönderim → tek aktif talep (veritabanı garantisi); veritabanı ikinci aktifi reddeder", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => submit(A.t3, "NAPKIN")));
    expect(results.filter((r) => r.kind === "created")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "duplicate")).toHaveLength(7);
    expect(new Set(results.map((r) => (r.kind !== "rejected" ? r.request.publicId : "")))).toHaveProperty("size", 1);
    expect(await prisma.tableServiceRequest.count({ where: { tableId: A.t3.tableId, type: "NAPKIN" } })).toBe(1);
    await expect(
      prisma.tableServiceRequest.create({
        data: { tenantId: A.tenantId, branchId: A.t3.branchId, tableId: A.t3.tableId, publicId: randomBytes(16).toString("base64url"), type: "NAPKIN", branchName: "x", tableName: "x" },
      }),
    ).rejects.toThrow();
    // CHECK: tamamlanmış talep aktif yuva tutamaz
    await expect(prisma.tableServiceRequest.updateMany({ where: { tableId: A.t3.tableId, type: "NAPKIN" }, data: { status: "COMPLETED" } })).rejects.toThrow();
  });
});

describe("üstlenme ve tamamlama", () => {
  let id: string;
  let publicId: string;

  beforeAll(async () => {
    const res = await submit(A.t2, "BILL");
    if (res.kind !== "created") throw new Error("bill not created");
    publicId = res.request.publicId;
    id = (await internal(publicId)).id;
  });

  it("8–9. üstlenme atomik: iki garson aynı anda → tam bir kazanan, diğeri net mesaj; üzerine yazma yok", async () => {
    const tableEvents = capture(tableChannel(A.t2.tableId));
    const [x, y] = await Promise.all([staff.claimServiceRequest(A.actor("w1"), id), staff.claimServiceRequest(A.actor("w2"), id)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const loser = x.ok ? y : x;
    expect(loser).toMatchObject({ ok: false, error: "Bu talep başka bir personel tarafından alındı." });
    const row = await internal(publicId);
    const winner = x.ok ? A.users.w1!.id : A.users.w2!.id;
    expect(row).toMatchObject({ status: "ACKNOWLEDGED", acknowledgedByUserId: winner });
    expect(row.history.filter((h) => h.toStatus === "ACKNOWLEDGED")).toHaveLength(1);
    expect(tableEvents.events.map((e) => e.data)).toEqual([{ kind: "BILL", status: "ACKNOWLEDGED" }]);
    tableEvents.off();
    // Müşteri görünümü: personelin güvenli adı
    const view = (await customer.listCustomerRequests(A.t2)).find((r) => r.publicId === publicId);
    expect(view?.staffName).toBe(x.ok ? "w1" : "w2");
  });

  it("10–11. başka garson tamamlayamaz; mutfak hiç yapamaz; üstlenen tamamlar; aktif yuva boşalır → yeni hesap açılabilir", async () => {
    const row = await internal(publicId);
    const assignee = row.acknowledgedByUserId === A.users.w1!.id ? "w1" : "w2";
    const other = assignee === "w1" ? "w2" : "w1";
    expect(await staff.completeServiceRequest(A.actor(other), id)).toMatchObject({ ok: false, error: expect.stringContaining("başka bir personel tarafından üstlenildi") });
    expect(await staff.completeServiceRequest(A.actor("kitchen"), id)).toMatchObject({ ok: false, error: "Bu talebi yönetme yetkiniz yok." });
    expect((await staff.completeServiceRequest(A.actor(assignee), id)).ok).toBe(true);
    const done = await internal(publicId);
    expect(done).toMatchObject({ status: "COMPLETED", activeSlot: null, completedByUserId: A.users[assignee]!.id });
    expect(await staff.completeServiceRequest(A.actor(assignee), id)).toMatchObject({ ok: false, error: "Talep zaten tamamlanmış." });
    expect((await submit(A.t2, "BILL")).kind).toBe("created");
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, entityId: id, action: { in: ["SERVICE_REQUEST_ACKNOWLEDGED", "SERVICE_REQUEST_COMPLETED"] } } })).toBe(2);
  });

  it("yönetici başkasının üstlendiği talebi tamamlar (override); kasiyer yalnızca hesap", async () => {
    const water = await prisma.tableServiceRequest.findFirstOrThrow({ where: { tableId: A.t1.tableId, type: "WATER", status: "OPEN" } });
    expect(await staff.claimServiceRequest(A.actor("cashier"), water.id)).toMatchObject({ ok: false, error: "Bu talebi yönetme yetkiniz yok." });
    await staff.claimServiceRequest(A.actor("w1"), water.id);
    const res = await staff.completeServiceRequest(A.actor("manager"), water.id);
    expect(res.ok).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: water.id, action: "SERVICE_REQUEST_COMPLETED" } });
    expect(audit.metadata).toMatchObject({ override: true });
    const bill = await prisma.tableServiceRequest.findFirstOrThrow({ where: { tableId: A.t1.tableId, type: "BILL", status: "OPEN" } });
    expect((await staff.claimServiceRequest(A.actor("cashier"), bill.id)).ok).toBe(true);
    expect((await staff.completeServiceRequest(A.actor("cashier"), bill.id)).ok).toBe(true);
  });

  it("iptal: garson iptal edemez, yönetici edebilir; müşteri yalnızca OPEN talebini geri alabilir", async () => {
    const napkin = await prisma.tableServiceRequest.findFirstOrThrow({ where: { tableId: A.t1.tableId, type: "NAPKIN", status: "OPEN" } });
    expect((await staff.cancelServiceRequestByStaff(A.actor("w1"), napkin.id)).ok).toBe(false);
    expect((await staff.cancelServiceRequestByStaff(A.actor("manager"), napkin.id)).ok).toBe(true);
    const waiter = await prisma.tableServiceRequest.findFirstOrThrow({ where: { tableId: A.t1.tableId, type: "WAITER", status: "OPEN" } });
    expect(await customer.cancelCustomerRequest(A.t2, waiter.publicId)).toEqual({ ok: false, reason: "not_found" }); // başka masa
    await staff.claimServiceRequest(A.actor("w2"), waiter.id);
    expect(await customer.cancelCustomerRequest(A.t1, waiter.publicId)).toEqual({ ok: false, reason: "wrong_status" });
    const fresh = await submit(A.t1, "NAPKIN");
    expect(fresh.kind === "created" && (await customer.cancelCustomerRequest(A.t1, fresh.request.publicId))).toEqual({ ok: true });
  });
});

describe("izolasyon, bağlam ve geçmiş", () => {
  it("12. kiracı izolasyonu: B, A'nın talebini göremez / üstlenemez; panolar ayrık; olaylar sızmaz", async () => {
    const otherTenant = capture(tenantOrdersChannel(B.tenantId));
    const res = await submit(A.t1, "CUSTOM", "Mama sandalyesi");
    const row = await internal(res.kind !== "rejected" ? res.request.publicId : "");
    expect(await staff.claimServiceRequest(B.actor("w1"), row.id)).toMatchObject({ ok: false, error: "Talep bulunamadı." });
    expect(await staff.completeServiceRequest(B.actor("owner"), row.id)).toMatchObject({ ok: false, error: "Talep bulunamadı." });
    const boardB = await repo.getServiceBoard(B.scope, {});
    expect([...boardB.open, ...boardB.acknowledged, ...boardB.done]).toHaveLength(0);
    const boardA = await repo.getServiceBoard(A.scope, {});
    expect(boardA.open.some((r) => r.id === row.id)).toBe(true);
    expect(otherTenant.events).toHaveLength(0);
    otherTenant.off();
  });

  it("13. masa izolasyonu: müşteri görünümü yalnızca kendi masasının talepleri", async () => {
    const t2 = await customer.listCustomerRequests(A.t2);
    const t2Ids = new Set((await prisma.tableServiceRequest.findMany({ where: { tableId: A.t2.tableId }, select: { publicId: true } })).map((r) => r.publicId));
    expect(t2.every((r) => t2Ids.has(r.publicId))).toBe(true);
    expect(await customer.listCustomerRequests({ tenantId: B.tenantId, tableId: A.t1.tableId })).toEqual([]);
  });

  it("14–15. pasif masa / iptal edilen QR yeni talep açamaz (güvenilir bağlam); mevcut talep personelde kalır ve tamamlanabilir", async () => {
    const { resolveTableQrToken } = await import("@/lib/tables/resolve-table-token");
    const { qrTokenLookup } = await import("@/server/repositories/table-qr.repository");
    const qr = await prisma.tableQrToken.findUniqueOrThrow({ where: { id: A.t3.tokenId } });
    // Token'ın kendisi saklanmaz; çözümleyiciye sahte token yerine kayıt düzeyinde kontrol (hash araması bağlamı)
    const lookup = { findByTokenHash: async () => qrTokenLookup.findByTokenHash(qr.tokenHash) };
    const host = { kind: "tenant" as const, tenant: { id: A.tenantId, slug: `srv-a-${run}`, name: "A", status: "ACTIVE" as const }, hostname: "x" };
    const okBefore = await resolveTableQrToken({ host: host as never, token: "A".repeat(22) }, { lookup });
    expect(okBefore.ok).toBe(true);

    const pending = await submit(A.t3, "WATER");
    const pendingRow = await internal(pending.kind !== "rejected" ? pending.request.publicId : "");
    await prisma.diningTable.update({ where: { id: A.t3.tableId }, data: { active: false } });
    expect(await resolveTableQrToken({ host: host as never, token: "A".repeat(22) }, { lookup })).toEqual({ ok: false, reason: "table_inactive" });
    await prisma.diningTable.update({ where: { id: A.t3.tableId }, data: { active: true } });
    await prisma.tableQrToken.update({ where: { id: A.t3.tokenId }, data: { active: false, revokedAt: new Date() } });
    expect(await resolveTableQrToken({ host: host as never, token: "A".repeat(22) }, { lookup })).toEqual({ ok: false, reason: "revoked" });
    // Mevcut talep silinmez; personel panosunda kalır ve tamamlanabilir
    expect((await repo.getServiceBoard(A.scope, {})).open.some((r) => r.id === pendingRow.id)).toBe(true);
    await staff.claimServiceRequest(A.actor("w1"), pendingRow.id);
    expect((await staff.completeServiceRequest(A.actor("w1"), pendingRow.id)).ok).toBe(true);
    expect((await internal(pendingRow.publicId)).qrTokenId).toBe(A.t3.tokenId);
  });

  it("16. masa yeniden adlandırılsa da geçmiş talep kopyası değişmez", async () => {
    const before = await prisma.tableServiceRequest.findFirstOrThrow({ where: { tableId: A.t1.tableId }, orderBy: { createdAt: "asc" } });
    await prisma.diningTable.update({ where: { id: A.t1.tableId }, data: { name: "Teras 1" } });
    expect((await prisma.tableServiceRequest.findUniqueOrThrow({ where: { id: before.id } })).tableName).toBe("Masa 1");
    const history = await repo.listServiceHistory(A.scope, { page: 1, pageSize: 50 });
    expect(history.items.every((r) => r.tableName !== "Teras 1")).toBe(true);
  });

  it("17. yanıt / tamamlanma zamanları ve metrikler gerçek veriden; bugün = restoran saat dilimi", async () => {
    const res = await submit(A.t2, "NAPKIN", null);
    const row = await internal(res.kind !== "rejected" ? res.request.publicId : "");
    const created = row.createdAt.getTime();
    await staff.claimServiceRequest(A.actor("w1"), row.id, new Date(created + 90_000));
    await staff.completeServiceRequest(A.actor("w1"), row.id, new Date(created + 240_000));
    const done = await internal(row.publicId);
    expect(done.acknowledgedAt!.getTime() - created).toBe(90_000);
    expect(done.completedAt!.getTime() - created).toBe(240_000);
    expect(done.history.map((h) => h.toStatus)).toEqual(["OPEN", "ACKNOWLEDGED", "COMPLETED"]);
    // Her metrik kendi olayının gününe göre sayılır; "şimdi" olayın anı seçilir — gece yarısına yakın koşuda
    // (onay 23:59, tamamlanma 00:01) ortak bir "şimdi" metriklerden birini dünde bırakıyordu.
    expect((await repo.getServiceMetrics(A.scope, {}, new Date(created + 240_000))).completedToday).toBeGreaterThanOrEqual(1);
    expect((await repo.getServiceMetrics(A.scope, {}, new Date(created + 90_000))).avgResponseMs).not.toBeNull();
    const empty = await repo.getServiceMetrics(B.scope, {});
    expect(empty).toMatchObject({ open: 0, acknowledged: 0, completedToday: 0, avgResponseMs: null });
    const summary = await repo.getTableServiceSummary(A.scope, A.t2.tableId);
    expect(summary.avgResponseMs).not.toBeNull();
  });

  it("18. olaylar commit sonrası; reddedilen / mükerrer işlem olay üretmez; yük sır içermez", async () => {
    const staffEvents = capture(tenantOrdersChannel(A.tenantId));
    const tableEvents = capture(tableChannel(A.t2.tableId));
    const res = await submit(A.t2, "WAITER");
    const dup = await submit(A.t2, "WAITER");
    expect(dup.kind).toBe("duplicate");
    const row = await internal(res.kind !== "rejected" ? res.request.publicId : "");
    await staff.claimServiceRequest(A.actor("w1"), row.id);
    await staff.claimServiceRequest(A.actor("w2"), row.id); // kaybeder → olay yok
    expect(staffEvents.events.map((e) => e.type)).toEqual(["SERVICE_REQUEST_CREATED", "SERVICE_REQUEST_ACKNOWLEDGED"]);
    expect(tableEvents.events.map((e) => e.data)).toEqual([
      { kind: "WAITER", status: "OPEN" },
      { kind: "WAITER", status: "ACKNOWLEDGED" },
    ]);
    const blob = JSON.stringify([...staffEvents.events, ...tableEvents.events]);
    expect(blob).not.toContain(row.publicId);
    // Anahtar düzeyinde: rastgele kimlik değerleri (cuid) "ip" / "note" alt dizesi içerebilir — değer değil ALAN aranır.
    expect(blob).not.toMatch(/"(token|tenantId|email|note|ip|ipAddress|phone)"\s*:/i);
    expect(blob).not.toMatch(/@|\btoken=/i);
    expect(JSON.stringify(tableEvents.events)).not.toContain(row.id);
    staffEvents.off();
    tableEvents.off();
  });

  it("hesap talebi müşterinin doğrulanmış siparişine bağlanır (başka masanın siparişi bağlanmaz); sipariş zorunlu değil", async () => {
    const mkOrder = async (tableId: string, n: number) =>
      prisma.order.create({
        data: {
          tenantId: A.tenantId,
          branchId: A.t2.branchId,
          tableId,
          publicId: randomBytes(16).toString("base64url"),
          orderNumber: n,
          currency: "TRY",
          locale: "tr",
          subtotalMinor: 1000,
          totalMinor: 1000,
          itemCount: 1,
          branchName: "Merkez",
          tableName: "Masa",
          idempotencyKeyHash: randomBytes(16).toString("hex"),
          requestHash: "x",
        },
        select: { id: true, publicId: true },
      });
    const own = await mkOrder(A.t1.tableId, 5001);
    const foreign = await mkOrder(A.t2.tableId, 5002);
    await prisma.tableServiceRequest.updateMany({ where: { tableId: A.t1.tableId, type: "BILL", activeSlot: "ACTIVE" }, data: { status: "CANCELLED", activeSlot: null } });
    const linked = await submit(A.t1, "BILL", null, [foreign.publicId, own.publicId]);
    expect((await internal(linked.kind !== "rejected" ? linked.request.publicId : "")).relatedOrderId).toBe(own.id);
    const unlinked = await submit(A.t3, "BILL", null, [own.publicId]);
    expect((await internal(unlinked.kind !== "rejected" ? unlinked.request.publicId : "")).relatedOrderId).toBeNull();
  });
});

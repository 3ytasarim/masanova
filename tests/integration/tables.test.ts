import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getTenantUrl } from "@/lib/domain/get-tenant-url";
import { buildStableQrUrl } from "@/lib/domain/qr-entry";
import { DEFAULT_LABEL_OPTIONS } from "@/lib/tables/label-options";
import { resolveTableQrToken } from "@/lib/tables/resolve-table-token";
import type { TenantResolution } from "@/lib/tenant/resolve-tenant";
import { createTenantScope } from "@/lib/tenant/scope";
import { areaSchema, bulkTablesSchema, tableSchema } from "@/lib/validation/tables";
import { qrTokenLookup, recordQrScan } from "@/server/repositories/table-qr.repository";
import { createArea, moveArea, setAreaActive, updateArea } from "@/server/services/tables/area.service";
import { buildSheetPdf, buildTableLabel, resolveSheetTables } from "@/server/services/tables/label.service";
import { createTableQr, ensureTablesHaveQr, regenerateTableQr, revealTableQr, revokeTableQr } from "@/server/services/tables/qr.service";
import { bulkCreateTables, createTable, moveTableToArea, setTableActive, updateTable } from "@/server/services/tables/table.service";
import type { TablesActor } from "@/server/services/tables/tables-common";

/**
 * Masalar & QR — gerçek PostgreSQL (Neon). İki geçici kiracı (A, B) oluşturulur ve sonunda silinir.
 * Zorunlu IDOR senaryoları: A, B'nin bölge/masa/QR/etiket/toplu baskı kayıtlarına hiçbir yoldan dokunamaz;
 * A'nın token'ı B'nin alan adında çalışmaz.
 */
const run = randomBytes(3).toString("hex");
const meta = { ipAddress: null, userAgent: "vitest" };

type Fixture = { tenantId: string; branchId: string; branch2Id: string; hostname: string; actor: TablesActor; host: TenantResolution };
let A: Fixture;
let B: Fixture;

async function makeTenant(label: string): Promise<Fixture> {
  const hostname = `tbl-${label}-${run}.localhost`;
  const tenant = await prisma.tenant.create({
    data: {
      subscription: { create: { plan: "AI", status: "ACTIVE", internal: true } },
      name: `Masa ${label} ${run}`,
      slug: `tbl-${label}-${run}`,
      status: "ACTIVE",
      settings: { create: {} },
      domains: { create: { hostname, type: "SUBDOMAIN", isPrimary: true } },
      branches: { create: [{ name: "Merkez", slug: "merkez" }, { name: "Kadıköy", slug: "kadikoy" }] },
      users: { create: { email: `tbl-${label}-${run}@masanovai.test`, firstName: "T", lastName: label, role: "TENANT_OWNER" } },
    },
    select: { id: true, name: true, slug: true, status: true, plan: true, branches: { orderBy: { slug: "desc" }, select: { id: true } }, users: { select: { id: true } } },
  });
  return {
    tenantId: tenant.id,
    branchId: tenant.branches[0]!.id,
    branch2Id: tenant.branches[1]!.id,
    hostname,
    actor: { userId: tenant.users[0]!.id, scope: createTenantScope(tenant.id), meta },
    host: { kind: "tenant", tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status, plan: tenant.plan, domain: { hostname, type: "SUBDOMAIN", isPrimary: true } } },
  };
}

const area = (name: string, slug: string, active = true) => areaSchema.parse({ name, slug, active });
const table = (name: string, extra: Record<string, unknown> = {}) => tableSchema.parse({ name, active: true, ...extra });
const idOf = (r: { ok: boolean; data?: unknown }) => {
  if (!r.ok) throw new Error(`beklenmeyen hata: ${JSON.stringify(r)}`);
  return (r.data as { id: string }).id;
};
const tokenOf = (url: string) => url.split("/q/")[1]!;
async function revealUrl(f: Fixture, tableId: string) {
  const r = await revealTableQr(f.actor.scope, tableId);
  if (!r.ok) throw new Error(r.reason);
  return r.qr.url;
}
const resolve = (host: TenantResolution, token: string) => resolveTableQrToken({ host, token }, { lookup: qrTokenLookup });

let salonA = "";
let salonB = "";
let tableA = "";
let tableB = "";

beforeAll(async () => {
  A = await makeTenant("a");
  B = await makeTenant("b");
  salonA = idOf(await createArea(A.actor, A.branchId, area("Salon", "salon")));
  salonB = idOf(await createArea(B.actor, B.branchId, area("Salon", "salon")));
  tableA = idOf(await createTable(A.actor, A.branchId, table("Masa 1", { number: "1", diningAreaId: salonA })));
  tableB = idOf(await createTable(B.actor, B.branchId, table("Masa 1", { number: "1", diningAreaId: salonB })));
});

afterAll(async () => {
  const ids = [A?.tenantId, B?.tenantId].filter(Boolean) as string[];
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantDomain.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

describe("bölgeler", () => {
  it("oluşturma, kısa ad şube içinde benzersiz, güncelleme, pasifleştirme, sıralama", async () => {
    const dup = await createArea(A.actor, A.branchId, area("Salon 2", "salon"));
    expect(dup).toMatchObject({ ok: false, fieldErrors: { slug: expect.any(String) } });
    // Aynı kısa ad başka şubede serbest.
    expect((await createArea(A.actor, A.branch2Id, area("Salon", "salon"))).ok).toBe(true);
    const teras = idOf(await createArea(A.actor, A.branchId, area("Teras", "teras")));
    expect((await updateArea(A.actor, teras, area("Teras Üst", "teras"))).ok).toBe(true);
    expect((await setAreaActive(A.actor, teras, false)).ok).toBe(true);
    expect((await moveArea(A.actor, teras, "up")).ok).toBe(true);
    const areas = await prisma.diningArea.findMany({ where: { tenantId: A.tenantId, branchId: A.branchId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, active: true } });
    expect(areas.map((a) => a.name)).toEqual(["Teras Üst", "Salon"]);
    expect(areas[0]!.active).toBe(false);
    await setAreaActive(A.actor, teras, true);
  });
});

describe("masalar", () => {
  it("ad (büyük/küçük harf duyarsız), numara ve kod şube içinde benzersiz", async () => {
    expect(await createTable(A.actor, A.branchId, table("MASA 1"))).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect(await createTable(A.actor, A.branchId, table("Masa X", { number: "1" }))).toMatchObject({ ok: false, fieldErrors: { number: expect.any(String) } });
    // Başka şubede aynı ad serbest.
    expect((await createTable(A.actor, A.branch2Id, table("Masa 1", { number: "1" }))).ok).toBe(true);
  });

  it("güncelleme ve aynı şubede bölge taşıma; başka şubenin bölgesine taşınamaz", async () => {
    const teras = idOf(await createArea(A.actor, A.branchId, area("Teras", "teras-2")));
    expect((await updateTable(A.actor, tableA, table("Masa 1", { number: "1", capacity: "4", code: "S-1", diningAreaId: teras }))).ok).toBe(true);
    const moved = await prisma.diningTable.findUniqueOrThrow({ where: { id: tableA }, select: { diningAreaId: true, capacity: true, code: true } });
    expect(moved).toEqual({ diningAreaId: teras, capacity: 4, code: "S-1" });
    expect((await moveTableToArea(A.actor, tableA, salonA)).ok).toBe(true);
    const otherBranchArea = await prisma.diningArea.findFirstOrThrow({ where: { tenantId: A.tenantId, branchId: A.branch2Id }, select: { id: true } });
    expect(await moveTableToArea(A.actor, tableA, otherBranchArea.id)).toMatchObject({ ok: false });
  });

  it("toplu oluşturma tek transaction: 10 masa + QR; çakışmada hiçbir masa oluşmaz", async () => {
    const before = await prisma.diningTable.count({ where: { tenantId: A.tenantId, branchId: A.branchId } });
    const ok = await bulkCreateTables(A.actor, A.branchId, { ...bulkTablesSchema.parse({ count: "10", startNumber: "10", pattern: "Masa {n}", capacity: "2", diningAreaId: salonA }), withQr: true });
    expect(ok).toMatchObject({ ok: true, data: { count: 10 } });
    const created = await prisma.diningTable.findMany({ where: { tenantId: A.tenantId, number: { gte: 10, lte: 19 } }, select: { name: true, capacity: true, diningAreaId: true, _count: { select: { qrTokens: true } } } });
    expect(created).toHaveLength(10);
    expect(created.every((t) => t.capacity === 2 && t.diningAreaId === salonA && t._count.qrTokens === 1)).toBe(true);

    // 15–24: 15..19 çakışır → işlem tamamen geri alınır.
    const conflict = await bulkCreateTables(A.actor, A.branchId, { ...bulkTablesSchema.parse({ count: "10", startNumber: "15", pattern: "Masa {n}" }), withQr: true });
    expect(conflict).toMatchObject({ ok: false });
    expect(await prisma.diningTable.count({ where: { tenantId: A.tenantId, branchId: A.branchId } })).toBe(before + 10);
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "TABLE_BULK_CREATED" } })).toBe(1);
  });
});

describe("QR yaşam döngüsü", () => {
  it("oluşturma: tek etkin token; etiket kararlı /q/<token> adresini kodlar (kiracı alan adından bağımsız); düz token saklanmaz", async () => {
    expect((await createTableQr(A.actor, tableA)).ok).toBe(true);
    expect(await createTableQr(A.actor, tableA)).toMatchObject({ ok: false });
    const url = await revealUrl(A, tableA);
    expect(url).toMatch(/\/q\/[A-Za-z0-9_-]{22}$/);
    expect(url).toBe(buildStableQrUrl(tokenOf(url)));
    expect(url).not.toContain(A.hostname);
    const revealed = await revealTableQr(A.actor.scope, tableA);
    expect(revealed.ok && revealed.qr.directUrl).toBe(getTenantUrl(A.hostname, `/t/${tokenOf(url)}`));
    const rows = await prisma.tableQrToken.findMany({ where: { tableId: tableA } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(tokenOf(url));
    expect(await resolve(A.host, tokenOf(url))).toMatchObject({ ok: true, context: { table: { name: "Masa 1" }, area: { name: "Salon" }, branch: { name: "Merkez" } } });
  });

  it("yenileme: eski adres ANINDA çalışmaz, yeni adres çalışır; geçmiş satır korunur", async () => {
    const oldToken = tokenOf(await revealUrl(A, tableA));
    expect((await regenerateTableQr(A.actor, tableA)).ok).toBe(true);
    const newToken = tokenOf(await revealUrl(A, tableA));
    expect(newToken).not.toBe(oldToken);
    expect(await resolve(A.host, oldToken)).toEqual({ ok: false, reason: "revoked" });
    expect((await resolve(A.host, newToken)).ok).toBe(true);
    const rows = await prisma.tableQrToken.findMany({ where: { tableId: tableA }, select: { active: true, revokedAt: true } });
    expect(rows.filter((r) => r.active)).toHaveLength(1);
    expect(rows.filter((r) => !r.active && r.revokedAt)).toHaveLength(1);
  });

  it("iptal: adres çalışmaz, iptal edilen token yeniden etkinleşmez; yeni QR yeni adres üretir", async () => {
    const token = tokenOf(await revealUrl(A, tableA));
    expect((await revokeTableQr(A.actor, tableA)).ok).toBe(true);
    expect(await resolve(A.host, token)).toEqual({ ok: false, reason: "revoked" });
    expect(await revokeTableQr(A.actor, tableA)).toMatchObject({ ok: false });
    expect(await revealTableQr(A.actor.scope, tableA)).toEqual({ ok: false, reason: "no_active_qr" });
    expect((await createTableQr(A.actor, tableA)).ok).toBe(true);
    const fresh = tokenOf(await revealUrl(A, tableA));
    expect(fresh).not.toBe(token);
    expect(await resolve(A.host, token)).toEqual({ ok: false, reason: "revoked" });
  });

  it("okutma sayacı: etkin token'da artar, iptal edilmişte artmaz", async () => {
    const row = await prisma.tableQrToken.findFirstOrThrow({ where: { tableId: tableA, active: true } });
    await recordQrScan(row.id, A.tenantId);
    await recordQrScan(row.id, A.tenantId);
    await recordQrScan(row.id, B.tenantId); // yanlış kiracı → etkisiz
    const after = await prisma.tableQrToken.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.scanCount).toBe(2);
    expect(after.lastUsedAt).toBeInstanceOf(Date);
    const revoked = await prisma.tableQrToken.findFirstOrThrow({ where: { tableId: tableA, active: false } });
    await recordQrScan(revoked.id, A.tenantId);
    expect((await prisma.tableQrToken.findUniqueOrThrow({ where: { id: revoked.id } })).scanCount).toBe(revoked.scanCount);
  });

  it("pasif masa / pasif bölge / pasif şube: token reddedilir; yeniden aktifleşince çalışır", async () => {
    const token = tokenOf(await revealUrl(A, tableA));
    await setTableActive(A.actor, tableA, false);
    expect(await resolve(A.host, token)).toEqual({ ok: false, reason: "table_inactive" });
    await setTableActive(A.actor, tableA, true);
    await setAreaActive(A.actor, salonA, false);
    expect(await resolve(A.host, token)).toEqual({ ok: false, reason: "area_inactive" });
    await setAreaActive(A.actor, salonA, true);
    await prisma.branch.update({ where: { id: A.branchId }, data: { active: false } });
    expect(await resolve(A.host, token)).toEqual({ ok: false, reason: "branch_inactive" });
    await prisma.branch.update({ where: { id: A.branchId }, data: { active: true } });
    expect((await resolve(A.host, token)).ok).toBe(true);
  });

  it("denetim kayıtlarında token ya da özeti yer almaz", async () => {
    const token = tokenOf(await revealUrl(A, tableA));
    const rows = await prisma.tableQrToken.findMany({ where: { tenantId: A.tenantId }, select: { tokenHash: true, tokenNonce: true } });
    const logs = JSON.stringify(await prisma.auditLog.findMany({ where: { tenantId: A.tenantId }, select: { action: true, metadata: true } }));
    expect(logs).toContain("TABLE_QR_REGENERATED");
    expect(logs).toContain("TABLE_QR_REVOKED");
    expect(logs).not.toContain(token);
    for (const r of rows) {
      expect(logs).not.toContain(r.tokenHash);
      expect(logs).not.toContain(r.tokenNonce);
    }
  });
});

describe("kiracı izolasyonu (IDOR)", () => {
  it("A, B'nin bölgesini ve masasını düzenleyemez", async () => {
    expect(await updateArea(A.actor, salonB, area("Ele geçirildi", "ele-gecirildi"))).toMatchObject({ ok: false });
    expect(await setAreaActive(A.actor, salonB, false)).toMatchObject({ ok: false });
    expect(await updateTable(A.actor, tableB, table("Ele geçirildi"))).toMatchObject({ ok: false });
    expect(await setTableActive(A.actor, tableB, false)).toMatchObject({ ok: false });
    expect(await createArea(A.actor, B.branchId, area("Sızma", "sizma"))).toMatchObject({ ok: false });
    expect(await createTable(A.actor, B.branchId, table("Sızma"))).toMatchObject({ ok: false });
    expect(await bulkCreateTables(A.actor, B.branchId, { ...bulkTablesSchema.parse({ count: "2", startNumber: "50", pattern: "X {n}" }), withQr: true })).toMatchObject({ ok: false });
    const b = await prisma.diningTable.findUniqueOrThrow({ where: { id: tableB }, include: { area: true } });
    expect(b.name).toBe("Masa 1");
    expect(b.active).toBe(true);
    expect(b.area?.name).toBe("Salon");
    expect(await prisma.diningTable.count({ where: { tenantId: B.tenantId } })).toBe(1);
  });

  it("A, masasını B'nin bölgesine taşıyamaz (servis + veritabanı bileşik FK)", async () => {
    expect(await moveTableToArea(A.actor, tableA, salonB)).toMatchObject({ ok: false });
    expect(await updateTable(A.actor, tableA, table("Masa 1", { diningAreaId: salonB }))).toMatchObject({ ok: false });
    // Uygulama katmanı atlansa bile veritabanı reddeder.
    await expect(prisma.diningTable.update({ where: { id: tableA }, data: { diningAreaId: salonB } })).rejects.toThrow();
    await expect(
      prisma.diningTable.create({ data: { tenantId: A.tenantId, branchId: B.branchId, name: `x-${run}` } }),
    ).rejects.toThrow();
    await expect(
      prisma.tableQrToken.create({ data: { tenantId: A.tenantId, branchId: B.branchId, tableId: tableB, tokenHash: `h-${run}`, tokenNonce: `n-${run}` } }),
    ).rejects.toThrow();
  });

  it("A, B'nin masası için QR oluşturamaz / yenileyemez / iptal edemez / göremez", async () => {
    expect((await createTableQr(B.actor, tableB)).ok).toBe(true);
    const tokenB = tokenOf(await revealUrl(B, tableB));
    expect(await createTableQr(A.actor, tableB)).toMatchObject({ ok: false, error: "Masa bulunamadı." });
    expect(await regenerateTableQr(A.actor, tableB)).toMatchObject({ ok: false, error: "Masa bulunamadı." });
    expect(await revokeTableQr(A.actor, tableB)).toMatchObject({ ok: false, error: "Masa bulunamadı." });
    expect(await revealTableQr(A.actor.scope, tableB)).toEqual({ ok: false, reason: "no_table" });
    expect(await ensureTablesHaveQr(A.actor, [tableB])).toMatchObject({ ok: true, data: { created: 0 } });
    expect((await resolve(B.host, tokenB)).ok).toBe(true);
    expect(await prisma.tableQrToken.count({ where: { tableId: tableB } })).toBe(1);
  });

  it("A, tahmin edilen kimlikle B'nin etiketini indiremez ve B'nin masalarını toplu basamaz", async () => {
    expect(await buildTableLabel(A.actor.scope, tableB, DEFAULT_LABEL_OPTIONS)).toMatchObject({ ok: false, status: 404 });
    expect(await resolveSheetTables(A.actor.scope, { kapsam: "sube", sube: B.branchId })).toBeNull();
    expect(await resolveSheetTables(A.actor.scope, { kapsam: "secili", sube: A.branchId, masalar: [tableB] })).toEqual([]);
    expect(await buildSheetPdf(A.actor, { kapsam: "bolge", sube: A.branchId, bolge: salonB }, DEFAULT_LABEL_OPTIONS)).toMatchObject({ ok: false, status: 404 });
    expect(await buildSheetPdf(A.actor, { kapsam: "sube", sube: B.branchId }, DEFAULT_LABEL_OPTIONS)).toMatchObject({ ok: false, status: 404 });
  });

  it("A'nın token'ı B'nin alan adında çalışmaz (ve tersi)", async () => {
    const tokenA = tokenOf(await revealUrl(A, tableA));
    const tokenB = tokenOf(await revealUrl(B, tableB));
    expect(await resolve(B.host, tokenA)).toEqual({ ok: false, reason: "tenant_mismatch" });
    expect(await resolve(A.host, tokenB)).toEqual({ ok: false, reason: "tenant_mismatch" });
    expect((await resolve(A.host, tokenA)).ok).toBe(true);
  });

  it("askıya alınan kiracının host'u token'ı reddeder", async () => {
    const tokenA = tokenOf(await revealUrl(A, tableA));
    const suspended: TenantResolution = { kind: "unavailable", tenant: { id: A.tenantId, name: "A", slug: "a", status: "SUSPENDED", plan: "STARTER" } };
    expect(await resolve(suspended, tokenA)).toEqual({ ok: false, reason: "tenant_unavailable" });
  });
});

describe("etiket çıktısı (gerçek veri)", () => {
  it("tek etiket ve A4 sayfa PDF üretilir, denetime yazılır", async () => {
    expect((await buildTableLabel(A.actor.scope, tableA, DEFAULT_LABEL_OPTIONS)).ok).toBe(true);
    const sheet = await buildSheetPdf(A.actor, { kapsam: "bolge", sube: A.branchId, bolge: salonA }, DEFAULT_LABEL_OPTIONS);
    expect(sheet).toMatchObject({ ok: true, printed: 11, skipped: 0 });
    if (sheet.ok) expect(Buffer.from(sheet.pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(await prisma.auditLog.count({ where: { tenantId: A.tenantId, action: "LABEL_PDF_GENERATED" } })).toBe(1);
  });
});

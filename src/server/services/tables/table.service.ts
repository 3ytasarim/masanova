import "server-only";
import type { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { BRANCH_TABLE_LIMIT, planBulkTables } from "@/lib/tables/naming";
import { issueQrToken } from "@/lib/tables/qr-token";
import type { BulkTablesInput, TableInput } from "@/lib/validation/tables";
import { swapOrders } from "@/server/services/menu/menu-common";
import { findBranchInScope, getQrSecret, tablesAudit, uniqueViolationFields, type TablesActor } from "@/server/services/tables/tables-common";
import { assertWithinLimit, EntitlementDeniedError } from "@/server/billing/entitlements";
import { deniedResult } from "@/server/billing/action-gate";

/**
 * Masa yönetimi. Masanın şubesi oluşturulduktan sonra değişmez; bölgesi yalnızca AYNI kiracı + AYNI şubenin
 * bölgelerinden seçilebilir (servis kontrolü + bileşik FK). Ad ve numara şube içinde benzersizdir
 * (ad büyük/küçük harf duyarsız karşılaştırılır).
 */

type Tx = Prisma.TransactionClient;

function duplicateError(fields: string[]): ActionResult<never> {
  const joined = fields.join(",");
  if (joined.includes("number")) return { ok: false, error: "Bu numara bu şubede kullanılıyor.", fieldErrors: { number: "Bu numara bu şubede kullanılıyor." } };
  if (joined.includes("code")) return { ok: false, error: "Bu kod bu şubede kullanılıyor.", fieldErrors: { code: "Bu kod bu şubede kullanılıyor." } };
  return { ok: false, error: "Bu ad bu şubede kullanılıyor.", fieldErrors: { name: "Bu ad bu şubede kullanılıyor." } };
}

/** Şube satırını kilitler: aynı şubeye eşzamanlı masa ekleme/toplu oluşturma sıraya girer. */
async function lockBranch(tx: Tx, tenantId: string, branchId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM branches WHERE id = ${branchId} AND tenant_id = ${tenantId} FOR UPDATE`;
  return rows.length === 1;
}

async function areaInBranch(actor: TablesActor, branchId: string, areaId: string | null): Promise<boolean> {
  if (!areaId) return true;
  const area = await prisma.diningArea.findFirst({ where: { id: areaId, tenantId: actor.scope.tenantId, branchId }, select: { id: true } });
  return area !== null;
}

async function nameTaken(tx: Tx, tenantId: string, branchId: string, name: string, excludeId?: string): Promise<boolean> {
  const row = await tx.diningTable.findFirst({
    where: { tenantId, branchId, name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

const AREA_INVALID = { ok: false as const, error: "Bölge bulunamadı.", fieldErrors: { diningAreaId: "Bu şubeye ait bir bölge seçin." } };

export async function createTable(actor: TablesActor, branchId: string, input: TableInput): Promise<ActionResult<{ id: string }>> {
  const branch = await findBranchInScope(actor.scope, branchId);
  if (!branch) return { ok: false, error: "Şube bulunamadı." };
  if (!(await areaInBranch(actor, branchId, input.diningAreaId))) return AREA_INVALID;
  const tenantId = actor.scope.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockBranch(tx, tenantId, branchId);
      if (await nameTaken(tx, tenantId, branchId, input.name)) return duplicateError(["name"]);
      // Paket limiti (Sprint 20): kiracı geneli masa sayısı; mevcut masalar limit düşse de SİLİNMEZ.
      await assertWithinLimit(tx, tenantId, "maxTables", () => tx.diningTable.count({ where: { tenantId } }));
      const count = await tx.diningTable.count({ where: { tenantId, branchId } });
      if (count >= BRANCH_TABLE_LIMIT) return { ok: false as const, error: `Bir şubede en fazla ${BRANCH_TABLE_LIMIT} masa olabilir.` };
      const last = await tx.diningTable.findFirst({ where: { tenantId, branchId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      const created = await tx.diningTable.create({
        data: {
          tenantId,
          branchId,
          diningAreaId: input.diningAreaId,
          name: input.name,
          number: input.number,
          code: input.code,
          capacity: input.capacity,
          capacityMin: input.capacityMin,
          reservable: input.reservable,
          active: input.active,
          sortOrder: (last?.sortOrder ?? 0) + 10,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: tablesAudit(actor, { action: "TABLE_CREATED", entity: "DiningTable", entityId: created.id, metadata: { name: input.name, number: input.number, branchId, diningAreaId: input.diningAreaId } }),
      });
      return { ok: true as const, data: created, message: "Masa oluşturuldu." };
    });
    return result;
  } catch (error) {
    if (error instanceof EntitlementDeniedError) return deniedResult(error);
    const fields = uniqueViolationFields(error);
    if (fields) return duplicateError(fields);
    throw error;
  }
}

export async function updateTable(actor: TablesActor, tableId: string, input: TableInput): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const existing = await prisma.diningTable.findFirst({ where: { id: tableId, tenantId }, select: { branchId: true, diningAreaId: true, active: true, name: true } });
  if (!existing) return { ok: false, error: "Masa bulunamadı." };
  if (!(await areaInBranch(actor, existing.branchId, input.diningAreaId))) return AREA_INVALID;

  try {
    return await prisma.$transaction(async (tx) => {
      if (await nameTaken(tx, tenantId, existing.branchId, input.name, tableId)) return duplicateError(["name"]);
      const updated = await tx.diningTable.updateMany({
        where: { id: tableId, tenantId },
        data: { name: input.name, number: input.number, code: input.code, capacity: input.capacity, capacityMin: input.capacityMin, reservable: input.reservable, diningAreaId: input.diningAreaId, active: input.active },
      });
      if (updated.count !== 1) throw new Error("table_not_found");
      await tx.auditLog.create({
        data: tablesAudit(actor, {
          action: "TABLE_UPDATED",
          entity: "DiningTable",
          entityId: tableId,
          metadata: {
            name: input.name,
            number: input.number,
            active: input.active,
            ...(existing.diningAreaId !== input.diningAreaId ? { movedFrom: existing.diningAreaId, movedTo: input.diningAreaId } : {}),
          },
        }),
      });
      return { ok: true as const, data: undefined, message: "Masa kaydedildi." };
    });
  } catch (error) {
    const fields = uniqueViolationFields(error);
    if (fields) return duplicateError(fields);
    throw error;
  }
}

export async function setTableActive(actor: TablesActor, tableId: string, active: boolean): Promise<ActionResult> {
  const result = await prisma.diningTable.updateMany({ where: { id: tableId, tenantId: actor.scope.tenantId }, data: { active } });
  if (result.count !== 1) return { ok: false, error: "Masa bulunamadı." };
  await prisma.auditLog.create({ data: tablesAudit(actor, { action: "TABLE_UPDATED", entity: "DiningTable", entityId: tableId, metadata: { active } }) });
  return { ok: true, data: undefined, message: active ? "Masa aktif." : "Masa pasif — QR kodu çalışmaz." };
}

/** Masayı aynı şubenin başka bir bölgesine (ya da bölgesiz) taşır. */
export async function moveTableToArea(actor: TablesActor, tableId: string, areaId: string | null): Promise<ActionResult> {
  const table = await prisma.diningTable.findFirst({ where: { id: tableId, tenantId: actor.scope.tenantId }, select: { branchId: true, diningAreaId: true } });
  if (!table) return { ok: false, error: "Masa bulunamadı." };
  if (!(await areaInBranch(actor, table.branchId, areaId))) return AREA_INVALID;
  if (table.diningAreaId === areaId) return { ok: true, data: undefined };
  await prisma.$transaction([
    prisma.diningTable.updateMany({ where: { id: tableId, tenantId: actor.scope.tenantId }, data: { diningAreaId: areaId } }),
    prisma.auditLog.create({ data: tablesAudit(actor, { action: "TABLE_UPDATED", entity: "DiningTable", entityId: tableId, metadata: { movedFrom: table.diningAreaId, movedTo: areaId } }) }),
  ]);
  return { ok: true, data: undefined, message: "Masa taşındı." };
}

export async function moveTable(actor: TablesActor, tableId: string, direction: "up" | "down"): Promise<ActionResult> {
  const table = await prisma.diningTable.findFirst({ where: { id: tableId, tenantId: actor.scope.tenantId }, select: { branchId: true, diningAreaId: true } });
  if (!table) return { ok: false, error: "Masa bulunamadı." };
  const siblings = await prisma.diningTable.findMany({
    where: { tenantId: actor.scope.tenantId, branchId: table.branchId, diningAreaId: table.diningAreaId },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const orders = swapOrders(siblings, tableId, direction);
  if (!orders) return { ok: true, data: undefined };
  await prisma.$transaction(orders.map((o) => prisma.diningTable.updateMany({ where: { id: o.id, tenantId: actor.scope.tenantId }, data: { sortOrder: o.sortOrder } })));
  return { ok: true, data: undefined };
}

/**
 * Toplu masa oluşturma — tek transaction: şube kilitlenir, çakışmalar (ad/numara) önceden kontrol edilir; herhangi
 * bir çakışma ya da hata olursa HİÇBİR masa oluşmaz. `withQr` ile her masaya QR token'ı da aynı transaction'da üretilir.
 */
export async function bulkCreateTables(actor: TablesActor, branchId: string, input: BulkTablesInput & { withQr: boolean }): Promise<ActionResult<{ count: number }>> {
  const branch = await findBranchInScope(actor.scope, branchId);
  if (!branch) return { ok: false, error: "Şube bulunamadı." };
  if (!(await areaInBranch(actor, branchId, input.diningAreaId))) return AREA_INVALID;
  const tenantId = actor.scope.tenantId;
  const secret = input.withQr ? getQrSecret() : null;

  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockBranch(tx, tenantId, branchId);
        const existing = await tx.diningTable.findMany({ where: { tenantId, branchId }, select: { name: true, number: true } });
        const plan = planBulkTables(
          { count: input.count, startNumber: input.startNumber, pattern: input.pattern },
          { names: existing.map((t) => t.name), numbers: existing.map((t) => t.number), total: existing.length },
        );
        if (!plan.ok) {
          const field = plan.reason === "conflict" ? "startNumber" : plan.reason === "limit" ? "count" : "startNumber";
          return { ok: false as const, error: plan.message, fieldErrors: { [field]: plan.message } };
        }
        await assertWithinLimit(tx, tenantId, "maxTables", () => tx.diningTable.count({ where: { tenantId } }), plan.tables.length);
        const last = await tx.diningTable.findFirst({ where: { tenantId, branchId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
        const base = last?.sortOrder ?? 0;
        const created = await tx.diningTable.createManyAndReturn({
          data: plan.tables.map((t, i) => ({ tenantId, branchId, diningAreaId: input.diningAreaId, name: t.name, number: t.number, capacity: input.capacity, sortOrder: base + (i + 1) * 10 })),
          select: { id: true },
        });
        if (secret) {
          await tx.tableQrToken.createMany({
            data: created.map((t) => {
              const issued = issueQrToken(secret);
              return { tenantId, branchId, tableId: t.id, tokenHash: issued.tokenHash, tokenNonce: issued.nonce };
            }),
          });
        }
        await tx.auditLog.create({
          data: tablesAudit(actor, {
            action: "TABLE_BULK_CREATED",
            entity: "DiningTable",
            entityId: null,
            metadata: { branchId, diningAreaId: input.diningAreaId, count: created.length, from: plan.tables[0]!.name, to: plan.tables.at(-1)!.name, qrCreated: secret ? created.length : 0 },
          }),
        });
        return { ok: true as const, data: { count: created.length }, message: `${created.length} masa oluşturuldu${secret ? " (QR kodlarıyla)" : ""}.` };
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof EntitlementDeniedError) return deniedResult(error);
    const fields = uniqueViolationFields(error);
    if (fields) return duplicateError(fields);
    throw error;
  }
}

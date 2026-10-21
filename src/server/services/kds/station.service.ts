import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import type { StationInput } from "@/lib/validation/stations";
import { buildAuditRow, type AuditEvent } from "@/server/services/audit.service";
import { swapOrders } from "@/server/services/menu/menu-common";
import { findBranchInScope, uniqueViolationFields } from "@/server/services/tables/tables-common";

/**
 * Hazırlama istasyonları (Mutfak, Bar, Tatlı…). Her istasyon tek şubeye aittir; şube bileşik FK ile de doğrulanır.
 * İstasyonlar silinmez — pasifleştirilir (geçmiş fişler istasyon adını kopyaladığı için okunur kalır).
 * Şube başına EN FAZLA BİR varsayılan: varsayılan şube satırındaki tek kolondur (branches.default_station_id) ve
 * bileşik FK yalnızca aynı şube + kiracının istasyonuna izin verir.
 * Aktör: requireTenantUser({ permission: "stations.manage", write: true }) — sahip / müdür.
 */
export type StationActor = { userId: string; scope: TenantScope; meta: RequestMeta };

const NAME_TAKEN = { name: "Bu şubede aynı adda bir istasyon var." };

/** Varsayılan iki kolonla yazılır (FK + CHECK: default_station_branch_id = şubenin kendi id'si). */
const defaultTo = (branchId: string, stationId: string) => ({ defaultStationId: stationId, defaultStationBranchId: branchId });
const CLEAR_DEFAULT = { defaultStationId: null, defaultStationBranchId: null };

function audit(actor: StationActor, event: Omit<AuditEvent, "tenantId" | "userId">) {
  return buildAuditRow({ ...event, tenantId: actor.scope.tenantId, userId: actor.userId }, actor.meta);
}

export async function createStation(actor: StationActor, branchId: string, input: StationInput & { isDefault: boolean }): Promise<ActionResult<{ id: string }>> {
  const tenantId = actor.scope.tenantId;
  const branch = await findBranchInScope(actor.scope, branchId);
  if (!branch) return { ok: false, error: "Şube bulunamadı." };
  const last = await prisma.preparationStation.findFirst({ where: { tenantId, branchId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  try {
    const station = await prisma.$transaction(async (tx) => {
      const created = await tx.preparationStation.create({
        data: { tenantId, branchId, name: input.name, type: input.type, active: input.active, sortOrder: (last?.sortOrder ?? 0) + 10 },
        select: { id: true },
      });
      if (input.isDefault && input.active) await tx.branch.updateMany({ where: { id: branchId, tenantId }, data: defaultTo(branchId, created.id) });
      await tx.auditLog.create({
        data: audit(actor, { action: "STATION_CREATED", entity: "PreparationStation", entityId: created.id, metadata: { name: input.name, type: input.type, branchId, isDefault: input.isDefault && input.active } }),
      });
      return created;
    });
    return { ok: true, data: station, message: "İstasyon oluşturuldu." };
  } catch (error) {
    if (uniqueViolationFields(error)) return { ok: false, error: "İstasyon adı kullanımda.", fieldErrors: NAME_TAKEN };
    throw error;
  }
}

export async function updateStation(actor: StationActor, stationId: string, input: StationInput & { isDefault: boolean }): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const existing = await prisma.preparationStation.findFirst({
    where: { id: stationId, tenantId },
    select: { id: true, active: true, branchId: true, branch: { select: { defaultStationId: true } } },
  });
  if (!existing) return { ok: false, error: "İstasyon bulunamadı." };
  const wasDefault = existing.branch.defaultStationId === existing.id;
  // Pasif istasyon varsayılan olamaz.
  const makeDefault = input.isDefault && input.active;
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.preparationStation.updateMany({ where: { id: stationId, tenantId }, data: { name: input.name, type: input.type, active: input.active } });
      if (updated.count !== 1) throw new Error("station_not_found");
      if (makeDefault && !wasDefault) await tx.branch.updateMany({ where: { id: existing.branchId, tenantId }, data: defaultTo(existing.branchId, stationId) });
      if (!makeDefault && wasDefault) await tx.branch.updateMany({ where: { id: existing.branchId, tenantId, defaultStationId: stationId }, data: CLEAR_DEFAULT });
      const deactivated = existing.active && !input.active;
      await tx.auditLog.create({
        data: audit(actor, {
          action: deactivated ? "STATION_DEACTIVATED" : "STATION_UPDATED",
          entity: "PreparationStation",
          entityId: stationId,
          metadata: { name: input.name, type: input.type, active: input.active, isDefault: makeDefault, defaultChanged: makeDefault !== wasDefault },
        }),
      });
    });
  } catch (error) {
    if (uniqueViolationFields(error)) return { ok: false, error: "İstasyon adı kullanımda.", fieldErrors: NAME_TAKEN };
    throw error;
  }
  return { ok: true, data: undefined, message: !input.active && wasDefault ? "İstasyon pasif — şubenin varsayılan istasyonu kalmadı." : "İstasyon kaydedildi." };
}

export async function setStationActive(actor: StationActor, stationId: string, active: boolean): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const station = await prisma.preparationStation.findFirst({ where: { id: stationId, tenantId }, select: { id: true, name: true, branchId: true, active: true } });
  if (!station) return { ok: false, error: "İstasyon bulunamadı." };
  if (station.active === active) return { ok: true, data: undefined };
  const clearedDefault = await prisma.$transaction(async (tx) => {
    await tx.preparationStation.updateMany({ where: { id: stationId, tenantId }, data: { active } });
    const cleared = active ? { count: 0 } : await tx.branch.updateMany({ where: { id: station.branchId, tenantId, defaultStationId: stationId }, data: CLEAR_DEFAULT });
    await tx.auditLog.create({
      data: audit(actor, { action: active ? "STATION_UPDATED" : "STATION_DEACTIVATED", entity: "PreparationStation", entityId: stationId, metadata: { name: station.name, active, statusChanged: true } }),
    });
    return cleared.count > 0;
  });
  return { ok: true, data: undefined, message: active ? "İstasyon aktif." : clearedDefault ? "İstasyon pasif — şubenin varsayılan istasyonu kalmadı." : "İstasyon pasif." };
}

export async function setDefaultStation(actor: StationActor, stationId: string): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const station = await prisma.preparationStation.findFirst({ where: { id: stationId, tenantId }, select: { id: true, name: true, branchId: true, active: true } });
  if (!station) return { ok: false, error: "İstasyon bulunamadı." };
  if (!station.active) return { ok: false, error: "Pasif istasyon varsayılan yapılamaz." };
  await prisma.$transaction([
    prisma.branch.updateMany({ where: { id: station.branchId, tenantId }, data: defaultTo(station.branchId, station.id) }),
    prisma.auditLog.create({ data: audit(actor, { action: "STATION_UPDATED", entity: "PreparationStation", entityId: station.id, metadata: { name: station.name, isDefault: true, defaultChanged: true } }) }),
  ]);
  return { ok: true, data: undefined, message: `${station.name} varsayılan istasyon.` };
}

export async function moveStation(actor: StationActor, stationId: string, direction: "up" | "down"): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const station = await prisma.preparationStation.findFirst({ where: { id: stationId, tenantId }, select: { branchId: true } });
  if (!station) return { ok: false, error: "İstasyon bulunamadı." };
  const siblings = await prisma.preparationStation.findMany({ where: { tenantId, branchId: station.branchId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const orders = swapOrders(siblings, stationId, direction);
  if (!orders) return { ok: true, data: undefined };
  await prisma.$transaction(orders.map((o) => prisma.preparationStation.updateMany({ where: { id: o.id, tenantId }, data: { sortOrder: o.sortOrder } })));
  return { ok: true, data: undefined };
}

/**
 * Ürünün BİR şubedeki istasyonlarını tümüyle değiştirir. Ürün ve istasyonlar kapsam içinde aranır; istasyon başka
 * şubeye / kiracıya aitse reddedilir (ayrıca bileşik FK). Boş liste → ürün şube varsayılanına düşer.
 */
export async function setProductStations(actor: StationActor, productId: string, branchId: string, stationIds: string[]): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const [product, branch] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, tenantId }, select: { id: true, name: true } }),
    findBranchInScope(actor.scope, branchId),
  ]);
  if (!product) return { ok: false, error: "Ürün bulunamadı." };
  if (!branch) return { ok: false, error: "Şube bulunamadı." };
  const stations = stationIds.length ? await prisma.preparationStation.findMany({ where: { id: { in: stationIds }, tenantId, branchId }, select: { id: true, name: true } }) : [];
  if (stations.length !== stationIds.length) return { ok: false, error: "Seçilen istasyonlardan biri bu şubeye ait değil." };
  await prisma.$transaction(async (tx) => {
    await tx.productPreparationStation.deleteMany({ where: { tenantId, branchId, productId } });
    if (stations.length) await tx.productPreparationStation.createMany({ data: stations.map((s) => ({ tenantId, branchId, productId, stationId: s.id })) });
    await tx.auditLog.create({
      data: audit(actor, { action: "PRODUCT_STATIONS_UPDATED", entity: "Product", entityId: productId, metadata: { product: product.name, branchId, stations: stations.map((s) => s.name) } }),
    });
  });
  return { ok: true, data: undefined, message: stations.length ? "İstasyonlar kaydedildi." : "Ürün şubenin varsayılan istasyonuna yönlendirilecek." };
}

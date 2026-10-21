import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import type { AreaInput } from "@/lib/validation/tables";
import { swapOrders } from "@/server/services/menu/menu-common";
import { findBranchInScope, tablesAudit, uniqueViolationFields, type TablesActor } from "@/server/services/tables/tables-common";

/**
 * Bölge (Salon, Bahçe, Teras…) yönetimi. Bölge yalnızca kapsam içindeki bir şubeye bağlanır; şube bileşik FK ile
 * de doğrulanır. Bölgeler silinmez — pasifleştirilir (içindeki masaların QR'ları "bölge pasif" ile reddedilir).
 */

const SLUG_TAKEN = { slug: "Bu kısa ad bu şubede başka bir bölgede kullanılıyor." };

export async function createArea(actor: TablesActor, branchId: string, input: AreaInput): Promise<ActionResult<{ id: string }>> {
  const branch = await findBranchInScope(actor.scope, branchId);
  if (!branch) return { ok: false, error: "Şube bulunamadı." };
  const last = await prisma.diningArea.findFirst({ where: { tenantId: actor.scope.tenantId, branchId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  try {
    const area = await prisma.$transaction(async (tx) => {
      const created = await tx.diningArea.create({
        data: { tenantId: actor.scope.tenantId, branchId, name: input.name, slug: input.slug, description: input.description, active: input.active, sortOrder: (last?.sortOrder ?? 0) + 10 },
        select: { id: true },
      });
      await tx.auditLog.create({ data: tablesAudit(actor, { action: "DINING_AREA_CREATED", entity: "DiningArea", entityId: created.id, metadata: { name: input.name, slug: input.slug, branchId } }) });
      return created;
    });
    return { ok: true, data: area, message: "Bölge oluşturuldu." };
  } catch (error) {
    if (uniqueViolationFields(error)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
    throw error;
  }
}

export async function updateArea(actor: TablesActor, areaId: string, input: AreaInput): Promise<ActionResult> {
  const existing = await prisma.diningArea.findFirst({ where: { id: areaId, tenantId: actor.scope.tenantId }, select: { active: true } });
  if (!existing) return { ok: false, error: "Bölge bulunamadı." };
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.diningArea.updateMany({
        where: { id: areaId, tenantId: actor.scope.tenantId },
        data: { name: input.name, slug: input.slug, description: input.description, active: input.active },
      });
      if (updated.count !== 1) throw new Error("area_not_found");
      await tx.auditLog.create({
        data: tablesAudit(actor, { action: "DINING_AREA_UPDATED", entity: "DiningArea", entityId: areaId, metadata: { name: input.name, slug: input.slug, active: input.active, statusChanged: existing.active !== input.active } }),
      });
    });
  } catch (error) {
    if (uniqueViolationFields(error)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
    throw error;
  }
  return { ok: true, data: undefined, message: "Bölge kaydedildi." };
}

export async function setAreaActive(actor: TablesActor, areaId: string, active: boolean): Promise<ActionResult> {
  const result = await prisma.diningArea.updateMany({ where: { id: areaId, tenantId: actor.scope.tenantId }, data: { active } });
  if (result.count !== 1) return { ok: false, error: "Bölge bulunamadı." };
  await prisma.auditLog.create({ data: tablesAudit(actor, { action: "DINING_AREA_UPDATED", entity: "DiningArea", entityId: areaId, metadata: { active, statusChanged: true } }) });
  return { ok: true, data: undefined, message: active ? "Bölge aktif." : "Bölge pasif — içindeki masaların QR kodları çalışmaz." };
}

/** Aynı şubedeki komşu bölgeyle yer değiştirir (önemsiz sıralama: denetim kaydı yok). */
export async function moveArea(actor: TablesActor, areaId: string, direction: "up" | "down"): Promise<ActionResult> {
  const area = await prisma.diningArea.findFirst({ where: { id: areaId, tenantId: actor.scope.tenantId }, select: { branchId: true } });
  if (!area) return { ok: false, error: "Bölge bulunamadı." };
  const siblings = await prisma.diningArea.findMany({
    where: { tenantId: actor.scope.tenantId, branchId: area.branchId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const orders = swapOrders(siblings, areaId, direction);
  if (!orders) return { ok: true, data: undefined };
  await prisma.$transaction(orders.map((o) => prisma.diningArea.updateMany({ where: { id: o.id, tenantId: actor.scope.tenantId }, data: { sortOrder: o.sortOrder } })));
  return { ok: true, data: undefined };
}

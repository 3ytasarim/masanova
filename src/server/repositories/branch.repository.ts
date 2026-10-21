import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * Şube verisi — kiracıya ait (tenant-owned) modellerin REFERANS repository'si.
 *
 * Kural (IDOR koruması): her fonksiyonun ilk parametresi TenantScope'tur ve `tenantId` filtresi
 * çağırandan değil scope'tan gelir. `findUnique({ where: { id } })` gibi kapsamsız sorgu burada YOKTUR;
 * başka kiracının id'si verilse bile sonuç `null` olur (varlığı da sızdırılmaz).
 */

const branchListSelect = {
  id: true,
  name: true,
  slug: true,
  city: true,
  district: true,
  active: true,
} satisfies Prisma.BranchSelect;

export type BranchListItem = Prisma.BranchGetPayload<{ select: typeof branchListSelect }>;

export function listBranches(scope: TenantScope, options: { activeOnly?: boolean } = {}): Promise<BranchListItem[]> {
  return prisma.branch.findMany({
    where: { tenantId: scope.tenantId, ...(options.activeOnly ? { active: true } : {}) },
    select: branchListSelect,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export function findBranchById(scope: TenantScope, branchId: string) {
  return prisma.branch.findFirst({ where: { id: branchId, tenantId: scope.tenantId } });
}

export function countBranches(scope: TenantScope): Promise<number> {
  return prisma.branch.count({ where: { tenantId: scope.tenantId } });
}

/**
 * Kapsamlı güncelleme: `updateMany` + `tenantId` filtresi, yabancı bir kaydı sessizce 0 satır günceller.
 * Döndürülen `false` çağırana "bulunamadı" olarak yansıtılmalı (403 değil — varlık sızdırılmaz).
 */
export async function setBranchActive(scope: TenantScope, branchId: string, active: boolean): Promise<boolean> {
  const result = await prisma.branch.updateMany({
    where: { id: branchId, tenantId: scope.tenantId },
    data: { active },
  });
  return result.count === 1;
}

/** Yönetim ekranı için şubenin tüm alanları (kiracı kapsamlı). */
export function listBranchesDetailed(scope: TenantScope) {
  return prisma.branch.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

export async function isBranchSlugTaken(scope: TenantScope, slug: string, excludeBranchId?: string): Promise<boolean> {
  const found = await prisma.branch.findUnique({
    where: { tenantId_slug: { tenantId: scope.tenantId, slug } },
    select: { id: true },
  });
  return !!found && found.id !== excludeBranchId;
}

export function createBranch(scope: TenantScope, data: Omit<Prisma.BranchUncheckedCreateInput, "tenantId" | "id">) {
  // tenantId girdiden DEĞİL, kapsamdan gelir.
  return prisma.branch.create({ data: { ...data, tenantId: scope.tenantId }, select: { id: true } });
}

/** Kapsamlı tam güncelleme; yabancı kiracının şubesi için false döner. */
export async function updateBranch(
  scope: TenantScope,
  branchId: string,
  data: Omit<Prisma.BranchUncheckedUpdateManyInput, "tenantId" | "id">,
): Promise<boolean> {
  const result = await prisma.branch.updateMany({ where: { id: branchId, tenantId: scope.tenantId }, data });
  return result.count === 1;
}

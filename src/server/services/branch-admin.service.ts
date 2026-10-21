import "server-only";
import { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import type { TenantScope } from "@/lib/tenant/scope";
import type { BranchFields, BranchUpdate } from "@/lib/validation/tenant";
import { findBranchById, isBranchSlugTaken, updateBranch } from "@/server/repositories/branch.repository";
import { recordAudit } from "@/server/services/audit.service";
import { assertWithinLimit, EntitlementDeniedError } from "@/server/billing/entitlements";
import { prisma } from "@/lib/db/prisma";

/** Şube yönetimi. Kiracı her zaman kapsamdan gelir; şube id'si yalnızca o kiracı içinde aranır. */
type Actor = { userId: string };

const SLUG_TAKEN = { slug: "Bu kısa ad bu işletmede başka bir şubede kullanılıyor." };

export async function createTenantBranch(actor: Actor, scope: TenantScope, input: BranchFields): Promise<ActionResult<{ id: string }>> {
  if (await isBranchSlugTaken(scope, input.slug)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
  try {
    const branch = await prisma.$transaction(async (tx) => {
      await assertWithinLimit(tx, scope.tenantId, "maxBranches", () => tx.branch.count({ where: { tenantId: scope.tenantId } }));
      return tx.branch.create({ data: { ...input, tenantId: scope.tenantId }, select: { id: true } });
    });
    await recordAudit({ action: "BRANCH_CREATED", entity: "Branch", entityId: branch.id, tenantId: scope.tenantId, userId: actor.userId, metadata: { name: input.name, slug: input.slug } });
    return { ok: true, data: branch, message: "Şube oluşturuldu." };
  } catch (error) {
    if (error instanceof EntitlementDeniedError) return { ok: false, error: "Paket şube limitine ulaşıldı. Paketi yükseltin ya da Abonelik sayfasından limit istisnası tanımlayın." };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
    throw error;
  }
}

/** Başka kiracının şube id'si verilirse "bulunamadı" döner — varlığı doğrulanmaz, hiçbir şey değişmez. */
export async function updateTenantBranch(actor: Actor, scope: TenantScope, branchId: string, input: BranchUpdate): Promise<ActionResult> {
  const before = await findBranchById(scope, branchId);
  if (!before) return { ok: false, error: "Şube bulunamadı." };
  if (await isBranchSlugTaken(scope, input.slug, branchId)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };

  const data = {
    name: input.name,
    slug: input.slug,
    phone: input.phone ?? null,
    email: input.email ?? null,
    country: input.country,
    city: input.city ?? null,
    district: input.district ?? null,
    address: input.address ?? null,
    timezone: input.timezone,
    currency: input.currency,
    locale: input.locale,
    active: input.active,
  };
  try {
    const updated = await updateBranch(scope, branchId, data);
    if (!updated) return { ok: false, error: "Şube bulunamadı." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: SLUG_TAKEN };
    throw error;
  }

  const changed = Object.fromEntries(Object.entries(data).filter(([key, value]) => before[key as keyof typeof before] !== value));
  await recordAudit({ action: "BRANCH_UPDATED", entity: "Branch", entityId: branchId, tenantId: scope.tenantId, userId: actor.userId, metadata: { changed } });
  return { ok: true, data: undefined, message: "Şube güncellendi." };
}

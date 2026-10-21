"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { setFlash } from "@/lib/flash";
import { branchFieldsSchema, branchUpdateSchema, tenantGeneralSchema } from "@/lib/validation/tenant";
import { createTenantBranch, updateTenantBranch } from "@/server/services/branch-admin.service";
import { invalidatePublicMenu } from "@/server/services/public-menu/public-menu-cache";
import { updateTenantGeneral } from "@/server/services/tenant-admin.service";

/**
 * İşletme ayarları (panel). requireTenantUser({ permission: "settings.manage", write: true }) — yalnızca işletme sahibi;
 * destek modu reddedilir. Super Admin ekranıyla AYNI servisler (tek iş kuralı); kiracı her zaman oturumdan.
 */
type FormState = ActionResult | null;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};
const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/);

async function settingsActor() {
  const ctx = await requireTenantUser({ permission: "settings.manage", write: true });
  return { actor: { userId: ctx.user.id }, scope: ctx.scope };
}

function branchInput(fd: FormData) {
  return {
    name: str(fd, "name"),
    slug: str(fd, "slug"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    country: str(fd, "country"),
    city: str(fd, "city"),
    district: str(fd, "district"),
    address: str(fd, "address"),
    timezone: str(fd, "timezone"),
    currency: str(fd, "currency"),
    locale: str(fd, "locale"),
  };
}

export async function updateBusinessGeneralAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { actor, scope } = await settingsActor();
  const parsed = tenantGeneralSchema.safeParse({ name: str(fd, "name"), defaultLocale: str(fd, "defaultLocale"), defaultCurrency: str(fd, "defaultCurrency"), timezone: str(fd, "timezone") });
  if (!parsed.success) return invalid(parsed.error);
  const result = await updateTenantGeneral(actor, scope, parsed.data);
  if (result.ok) invalidatePublicMenu(scope.tenantId);
  revalidatePath("/panel", "layout");
  return result.ok ? { ...result, message: "İşletme bilgileri kaydedildi." } : result;
}

export async function createOwnBranchAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { actor, scope } = await settingsActor();
  const parsed = branchFieldsSchema.safeParse(branchInput(fd));
  if (!parsed.success) return invalid(parsed.error);
  const result = await createTenantBranch(actor, scope, parsed.data);
  if (!result.ok) return result;
  await setFlash("Şube oluşturuldu.");
  redirect("/panel/ayarlar");
}

export async function updateOwnBranchAction(branchId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { actor, scope } = await settingsActor();
  if (!idSchema.safeParse(branchId).success) return { ok: false, error: "Şube bulunamadı." };
  const parsed = branchUpdateSchema.safeParse({ ...branchInput(fd), active: str(fd, "active") === "on" });
  if (!parsed.success) return invalid(parsed.error);
  const result = await updateTenantBranch(actor, scope, branchId, parsed.data);
  if (!result.ok) return result;
  invalidatePublicMenu(scope.tenantId);
  await setFlash("Şube güncellendi.");
  redirect("/panel/ayarlar");
}

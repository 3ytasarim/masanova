"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireSuperAdmin, requireSuperAdminTenant } from "@/lib/auth/guards";
import { getCurrentSession } from "@/lib/auth/session";
import { setFlash } from "@/lib/flash";
import { getRequestMeta } from "@/lib/security/request-meta";
import { STATUS_LABELS } from "@/lib/tenant/status";
import {
  branchFieldsSchema,
  branchUpdateSchema,
  brandingSchema,
  customDomainCreateSchema,
  planSchema,
  tenantGeneralSchema,
  tenantSlugChangeSchema,
  tenantStatusChangeSchema,
} from "@/lib/validation/tenant";
import { createTenantBranch, updateTenantBranch } from "@/server/services/branch-admin.service";
import { checkDomainVerification, OUTCOME_LABELS } from "@/server/services/domain-verification.service";
import { addCustomDomain, regenerateDomainChallenge, removeCustomDomain, setPrimaryDomain } from "@/server/services/domain.service";
import { startSupportMode, stopSupportMode } from "@/server/services/support.service";
import { changeTenantPlan, changeTenantSlug, changeTenantStatus, updateTenantBranding, updateTenantGeneral } from "@/server/services/tenant-admin.service";
import { invalidatePublicMenu } from "@/server/services/public-menu/public-menu-cache";
import { recordAudit } from "@/server/services/audit.service";

/**
 * Super Admin kiracı yönetimi eylemleri. Her eylem:
 *   1) requireSuperAdminTenant(tenantId) — rol + kiracının varlığı (URL/form'daki id yetki değildir),
 *   2) Zod ile FormData doğrulaması,
 *   3) servis çağrısı (kapsamlı sorgular + denetim kaydı).
 * İlk iki bağımsız değişken .bind() ile sunucu bileşeninde bağlanır.
 */
type FormState = ActionResult | null;

const str = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
};

function tenantPath(tenantId: string, sub = "") {
  return `/admin/isletmeler/${tenantId}${sub}`;
}

export async function updateTenantGeneralAction(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  const parsed = tenantGeneralSchema.safeParse({
    name: str(formData, "name"),
    defaultLocale: str(formData, "defaultLocale"),
    defaultCurrency: str(formData, "defaultCurrency"),
    timezone: str(formData, "timezone"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await updateTenantGeneral({ userId: user.id }, scope, parsed.data);
  if (result.ok) invalidatePublicMenu(scope.tenantId);
  revalidatePath(tenantPath(tenantId), "layout");
  return result;
}

export async function updateTenantBrandingAction(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  const parsed = brandingSchema.safeParse({
    logoUrl: str(formData, "logoUrl"),
    primaryColor: str(formData, "primaryColor"),
    secondaryColor: str(formData, "secondaryColor"),
    accentColor: str(formData, "accentColor"),
  });
  if (!parsed.success) return invalid(parsed.error);
  const result = await updateTenantBranding({ userId: user.id }, scope, parsed.data);
  if (result.ok) invalidatePublicMenu(scope.tenantId);
  revalidatePath(tenantPath(tenantId));
  return result;
}

export async function changeTenantSlugAction(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  const parsed = tenantSlugChangeSchema.safeParse({ slug: str(formData, "slug"), confirm: str(formData, "confirm") });
  if (!parsed.success) return invalid(parsed.error);
  const result = await changeTenantSlug({ userId: user.id }, scope, { slug: parsed.data.slug, moveSubdomain: str(formData, "moveSubdomain") === "on" });
  revalidatePath(tenantPath(tenantId), "layout");
  return result;
}

/** Durum geçişi: hedef durum + kullanıcının gördüğü önceki durum (eşzamanlılık koruması) formdan gelir. */
export async function changeTenantStatusAction(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope, tenant } = await requireSuperAdminTenant(tenantId);
  const parsed = tenantStatusChangeSchema.safeParse({ to: str(formData, "to"), reason: str(formData, "reason") });
  if (!parsed.success) return invalid(parsed.error, "Geçersiz durum.");
  const expectedFrom = str(formData, "from");
  if (expectedFrom !== tenant.status) return { ok: false, error: "İşletmenin durumu bu sırada değişmiş. Sayfayı yenileyin." };
  const result = await changeTenantStatus({ userId: user.id }, scope, { from: tenant.status, to: parsed.data.to, reason: parsed.data.reason });
  if (!result.ok) return result;
  revalidatePath("/admin", "layout");
  return { ok: true, data: undefined, message: `${tenant.name}: ${STATUS_LABELS[tenant.status]} → ${STATUS_LABELS[parsed.data.to]}` };
}

export async function changeTenantPlanAction(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  const parsed = planSchema.safeParse(str(formData, "plan"));
  if (!parsed.success) return invalid(parsed.error, "Geçersiz paket.");
  const result = await changeTenantPlan({ userId: user.id }, scope, parsed.data);
  revalidatePath(tenantPath(tenantId), "layout");
  return result;
}

// ─── Şubeler ────────────────────────────────────────────────────────────────

function branchInput(formData: FormData) {
  return {
    name: str(formData, "name"),
    slug: str(formData, "slug"),
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    country: str(formData, "country"),
    city: str(formData, "city"),
    district: str(formData, "district"),
    address: str(formData, "address"),
    timezone: str(formData, "timezone"),
    currency: str(formData, "currency"),
    locale: str(formData, "locale"),
  };
}

export async function createBranchAction(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  const parsed = branchFieldsSchema.safeParse(branchInput(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await createTenantBranch({ userId: user.id }, scope, parsed.data);
  if (!result.ok) return result;
  await setFlash("Şube oluşturuldu.");
  redirect(tenantPath(tenantId, "/subeler"));
}

export async function updateBranchAction(tenantId: string, branchId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  const parsed = branchUpdateSchema.safeParse({ ...branchInput(formData), active: str(formData, "active") === "on" });
  if (!parsed.success) return invalid(parsed.error);
  const result = await updateTenantBranch({ userId: user.id }, scope, branchId, parsed.data);
  if (!result.ok) return result;
  invalidatePublicMenu(scope.tenantId);
  await setFlash("Şube güncellendi.");
  redirect(tenantPath(tenantId, "/subeler"));
}

// ─── Alan adları ────────────────────────────────────────────────────────────

export async function addCustomDomainAction(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  const parsed = customDomainCreateSchema.safeParse({ hostname: str(formData, "hostname") });
  if (!parsed.success) return invalid(parsed.error);
  const result = await addCustomDomain({ userId: user.id }, scope, parsed.data.hostname);
  revalidatePath(tenantPath(tenantId, "/domainler"));
  return result.ok ? { ok: true, data: undefined, message: result.message } : result;
}

/** Alan adı satır eylemleri (doğrula / birincil yap / kaldır / challenge yenile). */
export async function domainOperationAction(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  const domainId = str(formData, "domainId") ?? "";
  const op = str(formData, "op");
  let result: ActionResult;
  switch (op) {
    case "verify": {
      const check = await checkDomainVerification({ userId: user.id }, scope, domainId, await getRequestMeta());
      if (!check.found) result = { ok: false, error: "Alan adı bulunamadı." };
      else if (check.outcome === "VERIFIED") result = { ok: true, data: undefined, message: `${check.hostname} doğrulandı.` };
      else result = { ok: false, error: OUTCOME_LABELS[check.outcome] };
      break;
    }
    case "primary":
      result = await setPrimaryDomain({ userId: user.id }, scope, domainId);
      break;
    case "remove":
      result = await removeCustomDomain({ userId: user.id }, scope, domainId);
      break;
    case "regenerate":
      result = await regenerateDomainChallenge({ userId: user.id }, scope, domainId);
      break;
    default:
      result = { ok: false, error: "Geçersiz işlem." };
  }
  revalidatePath(tenantPath(tenantId, "/domainler"));
  revalidatePath("/admin/domainler");
  return result;
}

// ─── Destek modu ────────────────────────────────────────────────────────────

/** Onay penceresinden çağrılır (.bind(null, tenantId)); başarıda panele yönlendirir. */
export async function startSupportModeAction(tenantId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  void _prev;
  void _formData;
  const { scope, tenant } = await requireSuperAdminTenant(tenantId);
  const session = await getCurrentSession();
  if (!session) redirect("/giris");
  const result = await startSupportMode(session, scope, tenant.name);
  if (!result.ok) return result;
  redirect("/panel");
}

export async function stopSupportModeAction(): Promise<void> {
  await requireSuperAdmin();
  const session = await getCurrentSession();
  const tenantId = session?.support?.tenantId;
  if (session) await stopSupportMode(session);
  await setFlash("Destek modu kapatıldı.", "info");
  redirect(tenantId ? tenantPath(tenantId) : "/admin");
}

/**
 * Menü önbelleğini elle temizle (Super Admin). Panel ve servis değişiklikleri önbelleği zaten anında geçersiz kılar;
 * bu yalnızca uygulamayı ATLAYAN doğrudan SQL düzenlemelerinden sonra gerekir. Herkese açık uç nokta YOK.
 */
export async function invalidateTenantMenuCacheAction(tenantId: string): Promise<void> {
  const { user, scope } = await requireSuperAdminTenant(tenantId);
  invalidatePublicMenu(scope.tenantId);
  await recordAudit({ action: "TENANT_MENU_CACHE_INVALIDATED", entity: "Tenant", entityId: scope.tenantId, userId: user.id, tenantId: scope.tenantId });
  await setFlash("Menü önbelleği temizlendi.");
  revalidatePath(tenantPath(tenantId));
}

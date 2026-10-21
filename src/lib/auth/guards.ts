import "server-only";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession, type SessionUser } from "@/lib/auth/session";
import { hasPermission, type Permission } from "@/lib/permissions/roles";
import { getTenantContext } from "@/lib/tenant/tenant-context";
import { isTenantAccessible } from "@/lib/tenant/resolve-tenant";
import { createPlatformScope, createTenantScope, type PlatformScope, type TenantScope } from "@/lib/tenant/scope";
import { findTenantSummaryById, type TenantSummaryRow } from "@/server/repositories/tenant-admin.repository";

/**
 * Sunucu tarafı yetki kapıları. Her korumalı layout, sayfa, Server Action ve Route Handler bunlardan
 * birini çağırır. Kapsam (scope) nesneleri YALNIZCA buradan (ve tenant-context'ten) üretilir; böylece
 * kiracı kimliği her zaman doğrulanmış oturumdan gelir, istek gövdesinden/URL'den asla gelmez.
 */

export const LOGIN_PATH = "/giris";

/** Cuid biçimi: URL'den gelen kimlikler veritabanına gitmeden önce biçim olarak süzülür. */
const ID_PATTERN = /^[a-z0-9]{20,40}$/;

export async function requireUser(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) redirect(LOGIN_PATH);
  return session.user;
}

export type SuperAdminContext = { user: SessionUser; platform: PlatformScope };

/** Super Admin olmayan herkese 404 — yönetim yüzeyinin varlığı bile doğrulanmaz. */
export async function requireSuperAdmin(): Promise<SuperAdminContext> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN" || user.tenantId !== null) notFound();
  return { user, platform: createPlatformScope(user.id) };
}

export type SuperAdminTenantContext = SuperAdminContext & { tenant: TenantSummaryRow; scope: TenantScope };

/**
 * Super Admin'in belirli bir kiracıyı yönettiği ekranlar (/admin/isletmeler/[tenantId]/…).
 * URL'deki tenantId bir YETKİ kaynağı değildir: yetki Super Admin rolünden gelir; id yalnızca hangi kiracının
 * yönetileceğini seçer ve var olduğu doğrulanır. Dönen scope ile kiracıya ait alt kayıtlar (şube, alan adı)
 * yalnızca o kiracı içinde aranır — A'nın şube id'si B'nin rotasından düzenlenemez.
 */
export async function requireSuperAdminTenant(tenantId: string): Promise<SuperAdminTenantContext> {
  const ctx = await requireSuperAdmin();
  if (!ID_PATTERN.test(tenantId)) notFound();
  const tenant = await findTenantSummaryById(ctx.platform, tenantId);
  if (!tenant) notFound();
  return { ...ctx, tenant, scope: createTenantScope(tenant.id) };
}

export type TenantUserContext = {
  user: SessionUser;
  tenant: { id: string; name: string; slug: string; status: TenantSummaryRow["status"] };
  scope: TenantScope;
  /** Doluysa: bu bir Super Admin destek oturumudur (salt okunur). */
  support: { startedAt: Date } | null;
};

/**
 * Restoran paneli kapısı.
 * - Oturum zorunlu; kullanıcının kiracısı olmalı ve kiracı TRIAL/ACTIVE olmalı.
 * - İstek bir kiracı alan adından geliyorsa, o alan adının kiracısı oturumdaki kiracıyla aynı olmalı.
 * - `permission` verilirse rol bu yetkiye sahip olmalı.
 * - Destek modu: SUPER_ADMIN, açıkça başlattığı destek oturumunda hedef kiracının panelini İŞLETME SAHİBİ
 *   görünürlüğüyle ama SALT OKUNUR görür. Veri değiştiren her işlem `write: true` ile çağırır ve destek
 *   modunda reddedilir.
 */
export async function requireTenantUser(options: { permission?: Permission; write?: boolean } = {}): Promise<TenantUserContext> {
  const session = await getCurrentSession();
  if (!session) redirect(LOGIN_PATH);
  const { user } = session;

  let tenant: TenantUserContext["tenant"];
  let support: TenantUserContext["support"] = null;

  if (user.role === "SUPER_ADMIN") {
    if (!session.support || options.write) notFound();
    const target = await findTenantSummaryById(createPlatformScope(user.id), session.support.tenantId);
    if (!target) notFound();
    tenant = target;
    support = { startedAt: session.support.startedAt };
    if (options.permission && !hasPermission("TENANT_OWNER", options.permission)) notFound();
  } else {
    if (!user.tenant || !user.tenantId) notFound();
    tenant = user.tenant;
    if (!isTenantAccessible(tenant.status)) redirect(`${LOGIN_PATH}?durum=isletme-pasif`);
    if (options.permission && !hasPermission(user.role, options.permission)) notFound();
  }

  const host = await getTenantContext();
  if ((host.kind === "tenant" && host.tenant.id !== tenant.id) || host.kind === "unavailable" || host.kind === "not_found") {
    notFound();
  }

  return { user, tenant, scope: createTenantScope(tenant.id), support };
}

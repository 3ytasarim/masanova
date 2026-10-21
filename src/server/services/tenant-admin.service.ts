import "server-only";
import { Prisma, type TenantPlan, type TenantStatus } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { buildSubdomainHostname } from "@/lib/domain/get-tenant-url";
import { getRequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { canTransition } from "@/lib/tenant/status";
import type { Branding } from "@/lib/validation/tenant";
import { isHostnameTaken } from "@/server/repositories/domain.repository";
import { isTenantSlugTaken } from "@/server/repositories/tenant-admin.repository";
import { buildAuditRow, recordAudit } from "@/server/services/audit.service";
import { changePlan as changeSubscriptionPlan } from "@/server/billing/subscription.service";

/**
 * Super Admin kiracı yönetimi. Her fonksiyon requireSuperAdminTenant() ile elde edilen kapsamla çağrılır;
 * hiçbir kiracı fiziksel olarak silinmez.
 */
type Actor = { userId: string };

export async function updateTenantGeneral(
  actor: Actor,
  scope: TenantScope,
  input: { name: string; defaultLocale: string; defaultCurrency: string; timezone: string },
): Promise<ActionResult> {
  const before = await prisma.tenant.findUnique({
    where: { id: scope.tenantId },
    select: { name: true, settings: { select: { defaultLocale: true, defaultCurrency: true, timezone: true } } },
  });
  if (!before) return { ok: false, error: "İşletme bulunamadı." };
  const meta = await getRequestMeta();

  await prisma.$transaction([
    prisma.tenant.update({ where: { id: scope.tenantId }, data: { name: input.name } }),
    prisma.tenantSettings.upsert({
      where: { tenantId: scope.tenantId },
      update: { defaultLocale: input.defaultLocale, defaultCurrency: input.defaultCurrency, timezone: input.timezone },
      create: { tenantId: scope.tenantId, defaultLocale: input.defaultLocale, defaultCurrency: input.defaultCurrency, timezone: input.timezone },
    }),
    prisma.auditLog.create({
      data: buildAuditRow(
        {
          action: "TENANT_UPDATED",
          entity: "Tenant",
          entityId: scope.tenantId,
          tenantId: scope.tenantId,
          userId: actor.userId,
          metadata: { before: { name: before.name, ...before.settings }, after: input },
        },
        meta,
      ),
    }),
  ]);
  return { ok: true, data: undefined, message: "İşletme bilgileri kaydedildi." };
}

export async function updateTenantBranding(actor: Actor, scope: TenantScope, input: Branding): Promise<ActionResult> {
  const data = {
    logoUrl: input.logoUrl ?? null,
    primaryColor: input.primaryColor ?? null,
    secondaryColor: input.secondaryColor ?? null,
    accentColor: input.accentColor ?? null,
  };
  await prisma.tenantSettings.upsert({ where: { tenantId: scope.tenantId }, update: data, create: { tenantId: scope.tenantId, ...data } });
  await recordAudit({ action: "TENANT_UPDATED", entity: "Tenant", entityId: scope.tenantId, tenantId: scope.tenantId, userId: actor.userId, metadata: { branding: data } });
  return { ok: true, data: undefined, message: "Marka ayarları kaydedildi." };
}

/**
 * Kısa ad değişikliği. İsteğe bağlı olarak platform alt alan adı da yeni kısa ada taşınır
 * (eski adres artık çözümlenmez — onay ekranında açıkça uyarılır).
 */
export async function changeTenantSlug(
  actor: Actor,
  scope: TenantScope,
  input: { slug: string; moveSubdomain: boolean },
): Promise<ActionResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: scope.tenantId },
    select: { slug: true, domains: { where: { type: "SUBDOMAIN" }, select: { id: true, hostname: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!tenant) return { ok: false, error: "İşletme bulunamadı." };
  if (tenant.slug === input.slug) return { ok: false, error: "Yeni kısa ad mevcut kısa adla aynı.", fieldErrors: { slug: "Mevcut kısa adla aynı." } };
  if (await isTenantSlugTaken(input.slug, scope.tenantId)) return { ok: false, error: "Kısa ad kullanımda.", fieldErrors: { slug: "Bu kısa ad başka bir işletmede kullanılıyor." } };

  const subdomain = tenant.domains[0];
  const newHostname = buildSubdomainHostname(input.slug);
  if (input.moveSubdomain && subdomain && (await isHostnameTaken(newHostname))) {
    return { ok: false, error: "Alt alan adı kullanımda.", fieldErrors: { slug: `${newHostname} başka bir kayıtta kullanılıyor.` } };
  }
  const meta = await getRequestMeta();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: scope.tenantId }, data: { slug: input.slug } });
      if (input.moveSubdomain && subdomain) {
        await tx.tenantDomain.updateMany({ where: { id: subdomain.id, tenantId: scope.tenantId }, data: { hostname: newHostname } });
      }
      await tx.auditLog.create({
        data: buildAuditRow(
          {
            action: "TENANT_SLUG_CHANGED",
            entity: "Tenant",
            entityId: scope.tenantId,
            tenantId: scope.tenantId,
            userId: actor.userId,
            metadata: {
              from: tenant.slug,
              to: input.slug,
              ...(input.moveSubdomain && subdomain ? { subdomainFrom: subdomain.hostname, subdomainTo: newHostname } : {}),
            },
          },
          meta,
        ),
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "Kısa ad ya da alan adı az önce başka bir kayda verildi.", fieldErrors: { slug: "Kullanımda." } };
    }
    throw error;
  }
  return { ok: true, data: undefined, message: "Kısa ad güncellendi." };
}

/**
 * Durum geçişi: yalnızca izinli geçişler ve "önceki durum hâlâ beklenen durum" koşuluyla
 * (iki yönetici aynı anda farklı geçiş yaparsa biri başarısız olur). Hiçbir veri silinmez.
 */
export async function changeTenantStatus(
  actor: Actor,
  scope: TenantScope,
  input: { from: TenantStatus; to: TenantStatus; reason?: string },
): Promise<ActionResult> {
  if (!canTransition(input.from, input.to)) {
    return { ok: false, error: "Bu durum geçişine izin verilmiyor." };
  }
  const meta = await getRequestMeta();
  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.tenant.updateMany({ where: { id: scope.tenantId, status: input.from }, data: { status: input.to } });
    if (result.count !== 1) return false;
    await tx.auditLog.create({
      data: buildAuditRow(
        {
          action: "TENANT_STATUS_CHANGED",
          entity: "Tenant",
          entityId: scope.tenantId,
          tenantId: scope.tenantId,
          userId: actor.userId,
          metadata: { previousStatus: input.from, newStatus: input.to, reason: input.reason ?? null, changedAt: new Date().toISOString() },
        },
        meta,
      ),
    });
    return true;
  });
  if (!changed) return { ok: false, error: "İşletmenin durumu bu sırada değişmiş. Sayfayı yenileyip tekrar deneyin." };
  return { ok: true, data: undefined, message: "İşletme durumu güncellendi." };
}

/** Paket değişikliği ABONELİK üzerinden (Sprint 20): olay + denetim abonelik servisinde; Tenant.plan aynadır. */
export async function changeTenantPlan(actor: Actor, scope: TenantScope, plan: TenantPlan): Promise<ActionResult> {
  const exists = await prisma.tenant.findUnique({ where: { id: scope.tenantId }, select: { id: true } });
  if (!exists) return { ok: false, error: "İşletme bulunamadı." };
  await changeSubscriptionPlan({ userId: actor.userId, meta: await getRequestMeta() }, scope.tenantId, plan);
  return { ok: true, data: undefined, message: "Paket güncellendi." };
}

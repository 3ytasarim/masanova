import "server-only";
import { Prisma } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import { isPlatformSubdomain } from "@/lib/domain/get-tenant-url";
import { ROOT_HOSTNAME } from "@/lib/domain/root-domain";
import { getRequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { findTenantDomain, isHostnameTaken } from "@/server/repositories/domain.repository";
import { buildAuditRow } from "@/server/services/audit.service";
import { newVerificationToken } from "@/server/services/domain-verification.service";

/**
 * Alan adı yönetimi. `verified` ve `isPrimary` istemciden ASLA alınmaz:
 *   - verified yalnızca DNS kontrolüyle (domain-verification.service) true olur,
 *   - birincil yalnızca doğrulanmış bir alan adına aktarılabilir.
 */
type Actor = { userId: string };

export async function addCustomDomain(actor: Actor, scope: TenantScope, hostname: string): Promise<ActionResult<{ id: string }>> {
  if (hostname === ROOT_HOSTNAME || isPlatformSubdomain(hostname)) {
    return { ok: false, error: "Platform alan adı eklenemez.", fieldErrors: { hostname: "Platform alan adı özel alan adı olarak eklenemez." } };
  }
  if (await isHostnameTaken(hostname)) {
    return { ok: false, error: "Alan adı kullanımda.", fieldErrors: { hostname: "Bu alan adı başka bir kayıtta kullanılıyor." } };
  }
  const meta = await getRequestMeta();
  try {
    const domain = await prisma.$transaction(async (tx) => {
      const created = await tx.tenantDomain.create({
        data: {
          tenantId: scope.tenantId,
          hostname,
          type: "CUSTOM_DOMAIN",
          verified: false,
          isPrimary: false,
          verification: { create: { token: newVerificationToken(), status: "PENDING" } },
        },
        select: { id: true },
      });
      const base = { entity: "TenantDomain" as const, entityId: created.id, tenantId: scope.tenantId, userId: actor.userId, metadata: { hostname, type: "CUSTOM_DOMAIN" } };
      await tx.auditLog.createMany({
        data: [buildAuditRow({ ...base, action: "DOMAIN_CREATED" }, meta), buildAuditRow({ ...base, action: "DOMAIN_VERIFICATION_REQUESTED" }, meta)],
      });
      return created;
    });
    return { ok: true, data: domain, message: "Alan adı eklendi. DNS doğrulaması bekleniyor." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "Alan adı kullanımda.", fieldErrors: { hostname: "Bu alan adı az önce başka bir kayda verildi." } };
    }
    throw error;
  }
}

/** Yalnızca birincil olmayan özel alan adları kaldırılabilir (platform alt alanı her zaman kalır). */
export async function removeCustomDomain(actor: Actor, scope: TenantScope, domainId: string): Promise<ActionResult> {
  const domain = await findTenantDomain(scope, domainId);
  if (!domain) return { ok: false, error: "Alan adı bulunamadı." };
  if (domain.type !== "CUSTOM_DOMAIN") return { ok: false, error: "Platform alt alan adı kaldırılamaz." };
  if (domain.isPrimary) return { ok: false, error: "Birincil alan adı kaldırılamaz. Önce başka bir alan adını birincil yapın." };
  const meta = await getRequestMeta();
  await prisma.$transaction([
    prisma.tenantDomain.deleteMany({ where: { id: domain.id, tenantId: scope.tenantId } }),
    prisma.auditLog.create({
      data: buildAuditRow(
        { action: "DOMAIN_REMOVED", entity: "TenantDomain", entityId: domain.id, tenantId: scope.tenantId, userId: actor.userId, metadata: { hostname: domain.hostname, wasVerified: domain.verified } },
        meta,
      ),
    }),
  ]);
  return { ok: true, data: undefined, message: "Alan adı kaldırıldı." };
}

export async function setPrimaryDomain(actor: Actor, scope: TenantScope, domainId: string): Promise<ActionResult> {
  const domain = await findTenantDomain(scope, domainId);
  if (!domain) return { ok: false, error: "Alan adı bulunamadı." };
  if (!domain.verified) return { ok: false, error: "Yalnızca doğrulanmış bir alan adı birincil yapılabilir." };
  if (domain.isPrimary) return { ok: true, data: undefined, message: "Zaten birincil." };
  const meta = await getRequestMeta();
  await prisma.$transaction([
    prisma.tenantDomain.updateMany({ where: { tenantId: scope.tenantId, isPrimary: true }, data: { isPrimary: false } }),
    prisma.tenantDomain.updateMany({ where: { id: domain.id, tenantId: scope.tenantId }, data: { isPrimary: true } }),
    prisma.auditLog.create({
      data: buildAuditRow(
        { action: "DOMAIN_PRIMARY_CHANGED", entity: "TenantDomain", entityId: domain.id, tenantId: scope.tenantId, userId: actor.userId, metadata: { hostname: domain.hostname } },
        meta,
      ),
    }),
  ]);
  return { ok: true, data: undefined, message: "Birincil alan adı güncellendi." };
}

/** Doğrulanmamış alan adı için yeni challenge (eski token geçersizleşir). */
export async function regenerateDomainChallenge(actor: Actor, scope: TenantScope, domainId: string): Promise<ActionResult> {
  const domain = await findTenantDomain(scope, domainId);
  if (!domain || domain.type !== "CUSTOM_DOMAIN" || !domain.verification) return { ok: false, error: "Alan adı bulunamadı." };
  if (domain.verified) return { ok: false, error: "Doğrulanmış alan adının challenge'ı yenilenmez." };
  const meta = await getRequestMeta();
  await prisma.$transaction([
    prisma.domainVerification.update({
      where: { id: domain.verification.id },
      data: { token: newVerificationToken(), status: "PENDING", failureReason: null, attempts: 0, lastCheckedAt: null },
    }),
    prisma.auditLog.create({
      data: buildAuditRow(
        { action: "DOMAIN_VERIFICATION_REQUESTED", entity: "TenantDomain", entityId: domain.id, tenantId: scope.tenantId, userId: actor.userId, metadata: { hostname: domain.hostname, regenerated: true } },
        meta,
      ),
    }),
  ]);
  return { ok: true, data: undefined, message: "Yeni doğrulama kaydı oluşturuldu. DNS'teki TXT değerini güncelleyin." };
}

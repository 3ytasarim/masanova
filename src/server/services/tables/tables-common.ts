import "server-only";
import { Prisma } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import type { RequestMeta } from "@/lib/security/request-meta";
import { getTenantUrl } from "@/lib/domain/get-tenant-url";
import { buildStableQrUrl } from "@/lib/domain/qr-entry";
import { qrTokenPath } from "@/lib/tables/qr-token";
import type { TenantScope } from "@/lib/tenant/scope";
import { prisma } from "@/lib/db/prisma";
import { buildAuditRow, type AuditEvent } from "@/server/services/audit.service";

/**
 * Masa / QR servislerinin ortak parçaları. Aktör her zaman requireTenantUser({ permission: "tables.manage",
 * write: true }) sonucundan kurulur (destek modu reddedilir); kapsam (tenantId) asla girdiden gelmez.
 */
export type TablesActor = { userId: string; scope: TenantScope; meta: RequestMeta };

export function tablesAudit(actor: TablesActor, event: Omit<AuditEvent, "tenantId" | "userId">) {
  return buildAuditRow({ ...event, tenantId: actor.scope.tenantId, userId: actor.userId }, actor.meta);
}

export function getQrSecret(): string {
  return getServerEnv().QR_TOKEN_SECRET;
}

/** Benzersizlik ihlalinde hangi alanın çakıştığı (Prisma meta.target). */
export function uniqueViolationFields(error: unknown): string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
}

export async function findBranchInScope(scope: TenantScope, branchId: string) {
  return prisma.branch.findFirst({ where: { id: branchId, tenantId: scope.tenantId }, select: { id: true, name: true, active: true } });
}

/**
 * Kiracının o anki yayın alan adı: birincil alan adı (alt alan adı ya da DOĞRULANMIŞ özel alan adı);
 * yoksa kiracının alt alan adı. Doğrulanmamış özel alan adı asla kullanılmaz (çözümlenmez).
 */
export async function getQrHostname(scope: TenantScope): Promise<string | null> {
  const domains = await prisma.tenantDomain.findMany({
    where: { tenantId: scope.tenantId, OR: [{ type: "SUBDOMAIN" }, { verified: true }] },
    orderBy: [{ isPrimary: "desc" }, { type: "asc" }, { createdAt: "asc" }],
    select: { hostname: true },
    take: 1,
  });
  return domains[0]?.hostname ?? null;
}

/** Basılı QR'ın kodladığı kanonik (kararlı) adres — kiracı alan adına bağlı DEĞİL (bkz. src/lib/domain/qr-entry.ts). */
export function buildQrUrl(token: string): string {
  return buildStableQrUrl(token);
}

/** Kiracının o anki alan adındaki doğrudan adres (geriye uyumluluk / bilgi amaçlı; etikete basılmaz). */
export function buildDirectQrUrl(hostname: string, token: string): string {
  return getTenantUrl(hostname, qrTokenPath(token));
}

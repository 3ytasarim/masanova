import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * Giriş için e-posta ile kullanıcı arama. Kiracı henüz bilinmediğinden kapsamsızdır;
 * yalnızca auth.service tarafından çağrılır ve parola doğrulamasından ÖNCE hiçbir bilgi döndürülmez.
 */
export function findUserForLogin(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      tenantId: true,
      email: true,
      passwordHash: true,
      role: true,
      active: true,
      tenant: { select: { status: true } },
    },
  });
}

/** Kiracı içi personel sayısı (kapsamlı). */
export function countTenantUsers(scope: TenantScope): Promise<number> {
  return prisma.user.count({ where: { tenantId: scope.tenantId, active: true } });
}

export async function isEmailTaken(email: string): Promise<boolean> {
  return !!(await prisma.user.findUnique({ where: { email }, select: { id: true } }));
}

/** Kiracı kullanıcıları (parola hash'i ASLA seçilmez). */
export function listTenantUsers(scope: TenantScope) {
  return prisma.user.findMany({
    where: { tenantId: scope.tenantId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true, email: true, firstName: true, lastName: true, role: true, active: true, createdAt: true },
  });
}

/** Denetim ekranında aktör adları için toplu e-posta eşlemesi (tek sorgu). */
export async function mapUserEmails(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
  return new Map(users.map((u) => [u.id, u.email]));
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  return (await prisma.user.findUnique({ where: { email }, select: { id: true } }))?.id ?? null;
}

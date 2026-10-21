import "server-only";
import { prisma } from "@/lib/db/prisma";

export function insertSession(data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  return prisma.session.create({ data, select: { id: true } });
}

export function findSessionWithUser(tokenHash: string) {
  return prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      supportTenantId: true,
      supportStartedAt: true,
      user: {
        select: {
          id: true,
          tenantId: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          active: true,
          tenant: { select: { id: true, name: true, slug: true, status: true } },
        },
      },
    },
  });
}

export function touchSession(id: string) {
  return prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() }, select: { id: true } });
}

export function deleteSessionByTokenHash(tokenHash: string) {
  return prisma.session.deleteMany({ where: { tokenHash } });
}

export function deleteSessionById(id: string) {
  return prisma.session.deleteMany({ where: { id } });
}

export function setSessionSupportTenant(id: string, tenantId: string | null) {
  return prisma.session.update({
    where: { id },
    data: { supportTenantId: tenantId, supportStartedAt: tenantId ? new Date() : null },
    select: { id: true },
  });
}

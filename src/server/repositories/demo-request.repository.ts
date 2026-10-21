import "server-only";
import type { DemoRequestStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { PlatformScope } from "@/lib/tenant/scope";

/** Public form tarafından yazılır (kimlik yok); okuma/güncelleme yalnızca Super Admin. */
export function insertDemoRequest(data: Prisma.DemoRequestCreateInput) {
  return prisma.demoRequest.create({ data, select: { id: true } });
}

export async function listDemoRequests(
  scope: PlatformScope,
  query: { q?: string; status?: DemoRequestStatus; page: number; pageSize: number },
) {
  void scope;
  const q = query.q?.trim();
  const where: Prisma.DemoRequestWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(q
      ? {
          OR: [
            { businessName: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q.toLowerCase() } },
            { city: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total, newCount] = await Promise.all([
    prisma.demoRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { id: true, name: true, businessName: true, email: true, phone: true, city: true, tableCount: true, status: true, createdAt: true },
    }),
    prisma.demoRequest.count({ where }),
    prisma.demoRequest.count({ where: { status: "NEW" } }),
  ]);
  return { items, total, newCount };
}

export function findDemoRequest(scope: PlatformScope, id: string) {
  void scope;
  return prisma.demoRequest.findUnique({ where: { id } });
}

export async function updateDemoRequest(scope: PlatformScope, id: string, data: { status: DemoRequestStatus; notes: string | null }) {
  void scope;
  const result = await prisma.demoRequest.updateMany({ where: { id }, data });
  return result.count === 1;
}

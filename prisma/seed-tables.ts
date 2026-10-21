/**
 * Demo restoran masaları (idempotent): ana şubede "İç Salon" (Masa 1–8) ve "Bahçe" (Masa 9–12), her masada
 * etkin bir QR token'ı. Var olan kayıtlara dokunmaz; etkin QR'ı olan masaya yeni token üretmez.
 * Token'lar QR_TOKEN_SECRET ile türetilir (tanımlı değilse QR adımı atlanır).
 */
import type { PrismaClient } from "@prisma/client";
import { issueQrToken } from "../src/lib/tables/qr-token";

const AREAS = [
  { slug: "ic-salon", name: "İç Salon", from: 1, to: 8, capacity: 4 },
  { slug: "bahce", name: "Bahçe", from: 9, to: 12, capacity: 6 },
];

export async function seedDemoTables(prisma: PrismaClient, tenantId: string): Promise<{ tables: number; qr: number }> {
  const branch = await prisma.branch.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!branch) return { tables: 0, qr: 0 };
  const secret = process.env.QR_TOKEN_SECRET;
  let qr = 0;

  for (const [i, a] of AREAS.entries()) {
    const area = await prisma.diningArea.upsert({
      where: { branchId_slug: { branchId: branch.id, slug: a.slug } },
      update: {},
      create: { tenantId, branchId: branch.id, slug: a.slug, name: a.name, sortOrder: (i + 1) * 10 },
      select: { id: true },
    });
    for (let n = a.from; n <= a.to; n++) {
      const table = await prisma.diningTable.upsert({
        where: { branchId_name: { branchId: branch.id, name: `Masa ${n}` } },
        update: {},
        create: { tenantId, branchId: branch.id, diningAreaId: area.id, name: `Masa ${n}`, number: n, capacity: a.capacity, sortOrder: n * 10 },
        select: { id: true },
      });
      if (!secret || secret.length < 32) continue;
      const active = await prisma.tableQrToken.count({ where: { tenantId, tableId: table.id, active: true } });
      if (active > 0) continue;
      const issued = issueQrToken(secret);
      await prisma.tableQrToken.create({ data: { tenantId, branchId: branch.id, tableId: table.id, tokenHash: issued.tokenHash, tokenNonce: issued.nonce } });
      qr++;
    }
  }
  const tables = await prisma.diningTable.count({ where: { tenantId } });
  return { tables, qr };
}

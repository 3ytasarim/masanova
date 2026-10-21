import type { PrismaClient } from "@prisma/client";

/**
 * Demo hazırlama istasyonları (idempotent). Her şube: "Mutfak" (varsayılan) + "Bar".
 * İçecekler (ayran, Türk kahvesi) Bar'a yönlendirilir; diğer ürünler varsayılan Mutfak'a düşer.
 * Mevcut varsayılan / atama değiştirilmez (işletmenin ayarı ezilmez).
 */
const BAR_PRODUCTS = ["ayran", "turk-kahvesi"];

export async function seedDemoStations(prisma: PrismaClient, tenantId: string): Promise<{ stations: number; routes: number }> {
  const branches = await prisma.branch.findMany({ where: { tenantId }, select: { id: true, defaultStationId: true } });
  const barProducts = await prisma.product.findMany({ where: { tenantId, slug: { in: BAR_PRODUCTS } }, select: { id: true } });
  let stations = 0;
  let routes = 0;
  for (const branch of branches) {
    const kitchen = await prisma.preparationStation.upsert({
      where: { branchId_name: { branchId: branch.id, name: "Mutfak" } },
      update: {},
      create: { tenantId, branchId: branch.id, name: "Mutfak", type: "KITCHEN", sortOrder: 10 },
      select: { id: true },
    });
    const bar = await prisma.preparationStation.upsert({
      where: { branchId_name: { branchId: branch.id, name: "Bar" } },
      update: {},
      create: { tenantId, branchId: branch.id, name: "Bar", type: "BAR", sortOrder: 20 },
      select: { id: true },
    });
    stations += 2;
    if (!branch.defaultStationId) await prisma.branch.updateMany({ where: { id: branch.id, tenantId }, data: { defaultStationId: kitchen.id, defaultStationBranchId: branch.id } });
    const created = await prisma.productPreparationStation.createMany({
      data: barProducts.map((p) => ({ tenantId, branchId: branch.id, productId: p.id, stationId: bar.id })),
      skipDuplicates: true,
    });
    routes += created.count;
  }
  return { stations, routes };
}

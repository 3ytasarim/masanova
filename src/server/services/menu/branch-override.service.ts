import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import type { BranchOverrideInput } from "@/lib/validation/menu";
import { menuAudit, type MenuActor } from "@/server/services/menu/menu-common";

/**
 * Şube bazlı ürün ayarı: satış durumu, tükendi ve fiyat (+ varyant fiyatları).
 * Ürün kopyalanmaz; yalnızca fark kaydı tutulur. Tüm alanlar "miras" ise kayıt silinir (ürün varsayılanı).
 * Şube, ürün ve varyant aynı kiracıya ait olmalı (servis doğrular; bileşik FK'ler veritabanında zorlar).
 */
const triToBool = (value: "inherit" | "yes" | "no"): boolean | null => (value === "inherit" ? null : value === "yes");

export async function saveBranchOverride(actor: MenuActor, productId: string, input: BranchOverrideInput): Promise<ActionResult> {
  const tenantId = actor.scope.tenantId;
  const [branch, product] = await Promise.all([
    prisma.branch.findFirst({ where: { id: input.branchId, tenantId }, select: { id: true, name: true } }),
    prisma.product.findFirst({ where: { id: productId, tenantId, archivedAt: null }, select: { id: true, variants: { where: { archivedAt: null }, select: { id: true } } } }),
  ]);
  if (!branch || !product) return { ok: false, error: "Şube veya ürün bulunamadı." };

  const productVariantIds = new Set(product.variants.map((v) => v.id));
  const variantEntries = Object.entries(input.variantPrices);
  if (variantEntries.some(([variantId]) => !productVariantIds.has(variantId))) return { ok: false, error: "Geçersiz varyant." };

  const available = triToBool(input.available);
  const soldOut = triToBool(input.soldOut);
  const allInherit = available === null && soldOut === null && input.price === null;

  await prisma.$transaction(async (tx) => {
    if (allInherit) {
      await tx.branchProduct.deleteMany({ where: { branchId: branch.id, productId, tenantId } });
    } else {
      await tx.branchProduct.upsert({
        where: { branchId_productId: { branchId: branch.id, productId } },
        update: { available, soldOut, priceMinor: input.price },
        create: { tenantId, branchId: branch.id, productId, available, soldOut, priceMinor: input.price },
      });
    }
    for (const [variantId, price] of variantEntries) {
      if (price === null) {
        await tx.branchVariantPrice.deleteMany({ where: { branchId: branch.id, variantId, tenantId } });
      } else {
        await tx.branchVariantPrice.upsert({
          where: { branchId_variantId: { branchId: branch.id, variantId } },
          update: { priceMinor: price },
          create: { tenantId, branchId: branch.id, variantId, priceMinor: price },
        });
      }
    }
    await tx.auditLog.create({
      data: menuAudit(actor, {
        action: "BRANCH_PRODUCT_OVERRIDE_UPDATED",
        entity: "BranchProduct",
        entityId: productId,
        metadata: { branchId: branch.id, branch: branch.name, available, soldOut, priceMinor: input.price, variantPrices: Object.fromEntries(variantEntries) },
      }),
    });
  });
  return { ok: true, data: undefined, message: `${branch.name} ayarları kaydedildi.` };
}

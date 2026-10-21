import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { StableEntryLookup } from "@/lib/tables/resolve-stable-entry";
import type { QrTokenLookup } from "@/lib/tables/resolve-table-token";

/**
 * Public QR çözümlemesi için tek global (kapsamsız) sorgu — token özeti benzersiz anahtardır. Kiracı eşleşmesi
 * resolveTableQrToken içinde istek host'unun kiracısıyla ZORUNLU olarak karşılaştırılır.
 */
export const qrTokenLookup: QrTokenLookup = {
  findByTokenHash(tokenHash) {
    return prisma.tableQrToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        tenantId: true,
        active: true,
        revokedAt: true,
        expiresAt: true,
        table: {
          select: {
            id: true,
            name: true,
            number: true,
            active: true,
            branch: { select: { id: true, name: true, active: true } },
            area: { select: { id: true, name: true, active: true } },
          },
        },
      },
    });
  },
};

/** Toplam okutma sayacı (kişisel veri yok). Yalnızca hâlâ etkin token artırılır. */
export async function recordQrScan(tokenId: string, tenantId: string): Promise<void> {
  await prisma.tableQrToken.updateMany({
    where: { id: tokenId, tenantId, active: true },
    data: { scanCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

/**
 * Kararlı giriş (/q) için tek global sorgu: yalnızca durum bayrakları ve kiracının yayın alan adları okunur.
 * Masa adı, şube adı, kimlikler gibi bağlam alanları bilinçli olarak SEÇİLMEZ.
 */
export const stableEntryLookup: StableEntryLookup = {
  findByTokenHash(tokenHash) {
    return prisma.tableQrToken.findUnique({
      where: { tokenHash },
      select: {
        active: true,
        revokedAt: true,
        expiresAt: true,
        table: {
          select: {
            active: true,
            branch: { select: { active: true } },
            area: { select: { active: true } },
            tenant: { select: { status: true, domains: { select: { hostname: true, type: true, verified: true, isPrimary: true }, orderBy: { createdAt: "asc" } } } },
          },
        },
      },
    });
  },
};

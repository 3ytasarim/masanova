import type { PrismaClient } from "@prisma/client";
import type { ImageStorageProvider } from "@/server/media/storage/types";

/**
 * Yetim görsel temizliği (elle / cron): `npm run media:cleanup -- [--min-age-minutes 60] [--dry-run]`
 *
 * 1. Hiçbir kayda bağlı olmayan MediaAsset satırları (ör. commit sonrası silme yarıda kaldıysa) → satır + dosyalar.
 * 2. Diskte olup veritabanında karşılığı olmayan varlık klasörleri (ör. yükleme yazıldı ama süreç transaction'dan önce
 *    çöktü; kiracı silindi) → klasör.
 * Güvenlik: yalnızca yaşı eşikten büyük olanlar (sürmekte olan yüklemeye dokunulmaz); referanslı varlık ASLA silinmez
 * (sorgu "hiç referans yok" koşuluyla siler + FK ikinci savunma hattı); yalnızca geçerli varlık önekleri silinir.
 */
export type CleanupReport = { orphanRows: number; orphanDirs: number; dryRun: boolean };

const UNREFERENCED = { productImages: { none: {} }, categories: { none: {} }, heroSettings: { none: {} }, logoSettings: { none: {} } } as const;

export async function cleanupOrphanMedia(
  db: PrismaClient,
  storage: ImageStorageProvider,
  options: { minAgeMinutes?: number; dryRun?: boolean; now?: Date } = {},
): Promise<CleanupReport> {
  const dryRun = options.dryRun ?? false;
  const cutoff = new Date((options.now ?? new Date()).getTime() - Math.max(10, options.minAgeMinutes ?? 60) * 60_000);

  const rows = await db.mediaAsset.findMany({
    where: { createdAt: { lt: cutoff }, storageProvider: storage.id, ...UNREFERENCED },
    select: { id: true, tenantId: true, storageKey: true },
  });
  let orphanRows = 0;
  for (const row of rows) {
    if (dryRun) {
      orphanRows++;
      continue;
    }
    // Yarış güvenliği: silme anında hâlâ referanssızsa sil (aksi hâlde 0 satır).
    const deleted = await db.mediaAsset.deleteMany({ where: { id: row.id, tenantId: row.tenantId, ...UNREFERENCED } });
    if (deleted.count === 1) {
      await storage.deletePrefix(row.storageKey);
      orphanRows++;
    }
  }

  let orphanDirs = 0;
  for await (const dir of storage.listAssetPrefixes()) {
    if (dir.modifiedAt >= cutoff) continue;
    const known = await db.mediaAsset.findFirst({ where: { storageProvider: storage.id, storageKey: dir.prefix }, select: { id: true } });
    if (known) continue;
    orphanDirs++;
    if (!dryRun) await storage.deletePrefix(dir.prefix);
  }
  return { orphanRows, orphanDirs, dryRun };
}

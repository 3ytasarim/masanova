import type { PrismaClient } from "@prisma/client";

/**
 * AI konuşma saklama (isteğe bağlı temizlik işi). Konuşma en geç 6 saatte sona erer ve bir daha müşteriye gösterilmez;
 * bu iş, süresi `olderThanDays` günden ÖNCE dolmuş konuşmaları (mesajlar ve turlar zincirleme) KALICI siler.
 *
 *  - AiUsage SİLİNMEZ: konuşmaya FK ile bağlı değildir; faturalama / kullanım metrikleri için kalır (içerik taşımaz).
 *  - Toplu ve sınırlı: her turda en fazla `batchSize` konuşma, en fazla `maxBatches` tur (uzun kilit / dev işlem yok).
 *  - `dryRun`: yalnızca sayar.
 * Sipariş / servis talebi gibi iş kayıtlarına DOKUNMAZ (otomatik silme yok; bkz. docs/production-checklist.md).
 */
export type RetentionResult = { matched: number; deleted: number; batches: number; dryRun: boolean };

export async function purgeExpiredConversations(
  db: PrismaClient,
  options: { olderThanDays: number; batchSize?: number; maxBatches?: number; dryRun?: boolean; now?: Date },
): Promise<RetentionResult> {
  if (!Number.isFinite(options.olderThanDays) || options.olderThanDays < 1) throw new Error("olderThanDays must be >= 1");
  const cutoff = new Date((options.now ?? new Date()).getTime() - options.olderThanDays * 24 * 60 * 60 * 1000);
  const where = { expiresAt: { lt: cutoff } };
  const matched = await db.aiConversation.count({ where });
  if (options.dryRun) return { matched, deleted: 0, batches: 0, dryRun: true };
  const batchSize = Math.min(Math.max(options.batchSize ?? 500, 1), 5000);
  const maxBatches = options.maxBatches ?? 100;
  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const ids = await db.aiConversation.findMany({ where, select: { id: true }, take: batchSize, orderBy: { expiresAt: "asc" } });
    if (!ids.length) break;
    const r = await db.aiConversation.deleteMany({ where: { id: { in: ids.map((c) => c.id) } } });
    deleted += r.count;
    batches += 1;
  }
  return { matched, deleted, batches, dryRun: false };
}

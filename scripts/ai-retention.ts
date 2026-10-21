/**
 * Süresi dolmuş AI konuşmalarını temizle (isteğe bağlı, elle / cron ile).
 *   npm run ai:retention -- --days 30 [--dry-run]
 * Doğrudan bağlantı (DIRECT_URL) kullanır; çıktıda sır yok.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { purgeExpiredConversations } from "../src/server/services/ai/retention";

const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1] ?? "30");
const dryRun = args.includes("--dry-run");
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
purgeExpiredConversations(db, { olderThanDays: Number.isFinite(days) ? days : 30, dryRun })
  .then((r) => console.log(JSON.stringify({ event: "ai.retention", ...r })))
  .catch((e: unknown) => {
    console.error(JSON.stringify({ event: "ai.retention.failed", errorName: e instanceof Error ? e.name : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

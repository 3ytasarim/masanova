/**
 * Yetim görsel temizliği (elle / cron ile).
 *   npm run media:cleanup -- [--min-age-minutes 60] [--dry-run]
 * UPLOAD_ROOT (boşsa ./storage/uploads) ve DIRECT_URL kullanır; çıktıda yol / sır yok, yalnızca sayılar.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { cleanupOrphanMedia } from "../src/server/media/cleanup";
import { LocalImageStorageProvider } from "../src/server/media/storage/local";
import { resolveUploadRoot } from "../src/server/media/storage/root";

const args = process.argv.slice(2);
const minAge = Number(args[args.indexOf("--min-age-minutes") + 1] ?? "60");
const dryRun = args.includes("--dry-run");
const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const storage = new LocalImageStorageProvider(resolveUploadRoot(process.env.UPLOAD_ROOT));

cleanupOrphanMedia(db, storage, { minAgeMinutes: Number.isFinite(minAge) ? minAge : 60, dryRun })
  .then((r) => console.log(JSON.stringify({ event: "media.cleanup", ...r })))
  .catch((e: unknown) => {
    console.error(JSON.stringify({ event: "media.cleanup.failed", errorName: e instanceof Error ? e.name : "unknown" }));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

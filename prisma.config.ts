import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";
import { enforcePrismaGuard } from "./prisma/guard";

// Prisma CLI her komutta bu dosyayı yükler → güvenlik kilidi npx prisma … dahil HER komutta çalışır
// (shadow DB = ana DB yasak; veri silebilen komutlar varsayılan olarak engelli). Bkz. prisma/guard.ts.
enforcePrismaGuard();

// Prisma config dosyası kullanıldığında .env otomatik yüklenmez; dotenv bunu üstlenir.
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});

import "server-only";
import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/lib/env";

/**
 * Tekil Prisma istemcisi.
 *
 * - Tembel (lazy) oluşturulur: `next build` veritabanı sırları olmadan çalışabilir; ortam değişkenleri
 *   sunucu açılışında (instrumentation.ts) ve ilk veritabanı erişiminde doğrulanır.
 * - Geliştirmede hot reload her modül yeniden yüklemesinde yeni istemci (= yeni bağlantı havuzu) açmasın diye
 *   örnek globalThis üzerinde saklanır.
 * - Neon: çalışma zamanında DATABASE_URL pooled (PgBouncer) bağlantıdır; URL'de `pgbouncer=true` ve düşük
 *   `connection_limit` kullanın (bkz. .env.example). Migration'lar DIRECT_URL üzerinden çalışır.
 */
const globalForPrisma = globalThis as typeof globalThis & { __masanovaPrisma?: PrismaClient };

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.__masanovaPrisma) return globalForPrisma.__masanovaPrisma;
  const env = getServerEnv();
  const client = new PrismaClient({
    datasourceUrl: env.DATABASE_URL,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    errorFormat: env.NODE_ENV === "production" ? "minimal" : "pretty",
  });
  // Üretimde de tek örnek tutulur (modül yeniden değerlendirilse bile ikinci havuz açılmaz).
  globalForPrisma.__masanovaPrisma = client;
  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value: unknown = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

import type { PrismaClient } from "@prisma/client";

/** Test yardımcısı: müşteriye onay satırları ekler (önce verilenler, sonra geri alınanlar — ekleme-yalnız). */
export async function setConsents(db: PrismaClient, tenantId: string, customerId: string, grant: string[], revoke: string[]): Promise<void> {
  const now = Date.now();
  let i = 0;
  for (const type of grant) {
    await db.customerConsent.create({ data: { tenantId, customerId, type: type as never, status: "GRANTED", source: "QR_OPT_IN", version: "test", grantedAt: new Date(now + i), createdAt: new Date(now + i++) } });
  }
  for (const type of revoke) {
    await db.customerConsent.create({ data: { tenantId, customerId, type: type as never, status: "REVOKED", source: "CUSTOMER_PROFILE", version: "test", revokedAt: new Date(now + i), createdAt: new Date(now + i++) } });
  }
}

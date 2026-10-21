import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { isProduction } from "@/lib/env";
import { CUSTOMER_COOKIE, hashCustomerToken, isSessionActive, isWellFormedToken, newCustomerToken, sessionExpiry } from "@/lib/crm/session";

/**
 * Müşteri kimlik oturumu (isteğe bağlı). Tarayıcıda yalnızca opak belirteç (httpOnly çerez, kiracı alan adına özel);
 * sunucuda SHA-256 özeti. Oturum masa QR bağlamından BAĞIMSIZDIR: kimlik hiçbir masa işlemini tek başına yetkilendirmez,
 * her sipariş / servis talebi yine geçerli masa belirteci ister. Oturumun kiracısı, isteğin kiracısıyla eşleşmezse yok
 * sayılır (başka restoranın çerezi işe yaramaz). Parmak izi / IP / cihaz eşleştirmesi YAPILMAZ.
 */
export type CustomerIdentity = { sessionId: string; customerId: string; tenantId: string };

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

async function readToken(): Promise<string | null> {
  const value = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  return isWellFormedToken(value) ? value : null;
}

/** Geçerli isteğin müşteri kimliği (yoksa null). Sunucu bileşenlerinden de çağrılabilir (çerez yazmaz). */
export async function readCustomerIdentity(tenantId: string): Promise<CustomerIdentity | null> {
  const token = await readToken();
  if (!token) return null;
  const session = await prisma.customerSession.findUnique({
    where: { tokenHash: hashCustomerToken(token) },
    select: { id: true, tenantId: true, customerId: true, expiresAt: true, revokedAt: true, lastUsedAt: true },
  });
  if (!session || session.tenantId !== tenantId || !isSessionActive(session)) return null;
  if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.customerSession.updateMany({ where: { id: session.id, tenantId }, data: { lastUsedAt: new Date() } });
  }
  return { sessionId: session.id, customerId: session.customerId, tenantId };
}

/** Yalnızca Server Action içinden (çerez yazar). Önceki oturum çerezi varsa geri alınır. */
export async function startCustomerSession(tenantId: string, customerId: string): Promise<void> {
  await endCustomerSession(tenantId);
  const token = newCustomerToken();
  const expiresAt = sessionExpiry();
  await prisma.customerSession.create({ data: { tenantId, customerId, tokenHash: hashCustomerToken(token), expiresAt } });
  (await cookies()).set(CUSTOMER_COOKIE, token, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/", expires: expiresAt });
}

/** Çıkış: sunucu kaydı geri alınır + çerez silinir (yalnızca bu tarayıcı). */
export async function endCustomerSession(tenantId: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_COOKIE)?.value;
  if (isWellFormedToken(token)) {
    await prisma.customerSession.updateMany({ where: { tokenHash: hashCustomerToken(token), tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  if (token !== undefined) jar.delete(CUSTOMER_COOKIE);
}

/** Müşterinin TÜM oturumları (veri silme talebi vb.). */
export async function revokeAllCustomerSessions(tenantId: string, customerId: string): Promise<void> {
  await prisma.customerSession.updateMany({ where: { tenantId, customerId, revokedAt: null }, data: { revokedAt: new Date() } });
}

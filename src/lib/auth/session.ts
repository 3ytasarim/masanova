import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { isProduction } from "@/lib/env";
import type { RequestMeta } from "@/lib/security/request-meta";
import {
  deleteSessionById,
  deleteSessionByTokenHash,
  extendSession,
  findSessionWithUser,
  insertSession,
  touchSession,
} from "@/server/repositories/session.repository";

/**
 * Veritabanı destekli oturum.
 * Çerez: 256 bit rastgele token (httpOnly, SameSite=Lax, prod'da Secure + __Host- öneki).
 * Veritabanı: token'ın SHA-256 özeti — çerez olmadan veritabanı kaydı tek başına işe yaramaz.
 */
export const SESSION_COOKIE = isProduction ? "__Host-mn_session" : "mn_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 gün (mutlak)
const TOUCH_INTERVAL_MS = 1000 * 60 * 15;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Yalnızca Server Action / Route Handler içinden çağrılabilir (çerez yazar). */
export async function createSession(userId: string, meta: RequestMeta): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await insertSession({ userId, tokenHash: hashToken(token), expiresAt, ...meta });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Yalnızca Server Action / Route Handler içinden çağrılabilir. */
export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSessionByTokenHash(hashToken(token));
  jar.delete(SESSION_COOKIE);
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof findSessionWithUser>>>["user"];

/** Destek modu en fazla bu süre açık kalır; süresi dolunca kendiliğinden kapanmış sayılır. */
export const SUPPORT_MODE_TTL_MS = 1000 * 60 * 60;

export type CurrentSession = {
  id: string;
  user: SessionUser;
  /** Yalnızca SUPER_ADMIN oturumlarında ve süresi dolmamışsa dolu. */
  support: { tenantId: string; startedAt: Date } | null;
};

/**
 * Geçerli oturum (istek başına bir kez sorgulanır — React cache).
 * Süresi dolmuş oturum veya pasif kullanıcı → null. Süresi dolan kayıt temizlenir.
 */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 128) return null;

  const session = await findSessionWithUser(hashToken(token));
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await deleteSessionById(session.id);
    return null;
  }
  if (!session.user.active) return null;

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // Son görülme bilgisi kritik değil; hata yanıtı bozmasın.
    await touchSession(session.id).catch(() => undefined);
  }

  const supportActive =
    session.user.role === "SUPER_ADMIN" &&
    session.supportTenantId !== null &&
    session.supportStartedAt !== null &&
    Date.now() - session.supportStartedAt.getTime() < SUPPORT_MODE_TTL_MS;

  return {
    id: session.id,
    user: session.user,
    support: supportActive ? { tenantId: session.supportTenantId!, startedAt: session.supportStartedAt! } : null,
  };
});

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => (await getCurrentSession())?.user ?? null);

/**
 * Kasa terminali gibi sürekli açık ekranlar için kayan oturum: geçerli (süresi dolmamış, kullanıcısı aktif) oturumun
 * bitişi şimdiden itibaren 7 güne uzatılır, çerez de yenilenir. Ekran kullanıldıkça oturum kapanmaz; 7 gün hiç
 * açılmazsa normal şekilde düşer. Destek modundaki Super Admin oturumu uzatılmaz.
 * Yalnızca Route Handler / Server Action içinden çağrılabilir (çerez yazar).
 */
export async function extendCurrentSession(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 128) return false;
  const session = await findSessionWithUser(hashToken(token));
  if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.active || session.user.role === "SUPER_ADMIN") return false;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await extendSession(session.id, expiresAt);
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/", expires: expiresAt });
  return true;
}

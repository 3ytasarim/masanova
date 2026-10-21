import "server-only";
import { verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession, destroyCurrentSession, getCurrentSession } from "@/lib/auth/session";
import { isTenantRole } from "@/lib/permissions/roles";
import { rateLimit, resetRateLimit } from "@/server/rate-limit";
import { getRequestMeta } from "@/lib/security/request-meta";
import { isTenantAccessible } from "@/lib/tenant/resolve-tenant";
import type { LoginInput } from "@/lib/validation/schemas";
import { findUserForLogin } from "@/server/repositories/user.repository";
import { recordAudit } from "@/server/services/audit.service";
import { stopSupportMode } from "@/server/services/support.service";

/** E-posta + IP başına 15 dakikada 5 başarısız deneme (politika "auth.login"). */

export type LoginResult =
  | { ok: true; redirectTo: "/admin" | "/panel" }
  | { ok: false; error: "invalid_credentials" | "rate_limited" | "tenant_inactive"; retryAfterSeconds?: number };

export async function login(input: LoginInput): Promise<LoginResult> {
  const meta = await getRequestMeta();
  const limitKey = `${input.email}|${meta.ipAddress ?? "unknown"}`;
  const limit = await rateLimit("auth.login", limitKey);
  if (!limit.allowed) {
    await recordAudit({ action: "AUTH_LOGIN_THROTTLED", entity: "User", metadata: { email: input.email } });
    return { ok: false, error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const user = await findUserForLogin(input.email);
  const passwordOk = user?.passwordHash
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyAgainstDummy(input.password);

  if (!user || !passwordOk || !user.active) {
    await recordAudit({
      action: "AUTH_LOGIN_FAILURE",
      entity: "User",
      entityId: user?.id ?? null,
      tenantId: user?.tenantId ?? null,
      metadata: { email: input.email, reason: !user ? "unknown_email" : !passwordOk ? "bad_password" : "inactive_user" },
    });
    return { ok: false, error: "invalid_credentials" };
  }

  // Veri bütünlüğü: kiracı rolündeki kullanıcı kiracısız olamaz.
  if (isTenantRole(user.role) && (!user.tenantId || !user.tenant)) {
    await recordAudit({ action: "AUTH_LOGIN_FAILURE", entity: "User", entityId: user.id, metadata: { reason: "missing_tenant" } });
    return { ok: false, error: "invalid_credentials" };
  }
  if (user.tenant && !isTenantAccessible(user.tenant.status)) {
    await recordAudit({ action: "AUTH_LOGIN_FAILURE", entity: "User", entityId: user.id, tenantId: user.tenantId, metadata: { reason: "tenant_inactive" } });
    return { ok: false, error: "tenant_inactive" };
  }

  await resetRateLimit("auth.login", limitKey);
  await createSession(user.id, meta);
  await recordAudit({ action: "AUTH_LOGIN_SUCCESS", entity: "User", entityId: user.id, userId: user.id, tenantId: user.tenantId });

  return { ok: true, redirectTo: user.role === "SUPER_ADMIN" ? "/admin" : "/panel" };
}

export async function logout(): Promise<void> {
  const session = await getCurrentSession();
  const user = session?.user;
  if (session?.support) await stopSupportMode(session, "logout");
  await destroyCurrentSession();
  if (user) {
    await recordAudit({ action: "AUTH_LOGOUT", entity: "User", entityId: user.id, userId: user.id, tenantId: user.tenantId });
  }
}

import "server-only";
import type { ActionResult } from "@/lib/action-result";
import type { CurrentSession } from "@/lib/auth/session";
import type { TenantScope } from "@/lib/tenant/scope";
import { setSessionSupportTenant } from "@/server/repositories/session.repository";
import { recordAudit } from "@/server/services/audit.service";

/**
 * Super Admin destek modu ("impersonation" yerine bilinçli olarak dar kapsam):
 * - Hedef bir KULLANICI değil bir KİRACIDIR; başka bir kullanıcının kimliğine bürünülmez, dolayısıyla
 *   başka bir Super Admin'e de bürünülemez.
 * - Admin'in kendi oturumu ve kimliği korunur (aynı oturuma destek hedefi eklenir); denetim kayıtlarında
 *   aktör her zaman gerçek admin'dir.
 * - Salt okunur: requireTenantUser({ write: true }) destek modunda reddeder.
 * - Süre sınırlı (SUPPORT_MODE_TTL_MS), başlangıç ve bitiş denetlenir, panelde kalıcı uyarı bandı görünür.
 */
export async function startSupportMode(session: CurrentSession, scope: TenantScope, tenantName: string): Promise<ActionResult> {
  if (session.user.role !== "SUPER_ADMIN") return { ok: false, error: "Yetkisiz." };
  if (session.support) {
    await recordAudit({ action: "SUPPORT_MODE_STOPPED", entity: "Session", tenantId: session.support.tenantId, userId: session.user.id, metadata: { reason: "switched" } });
  }
  await setSessionSupportTenant(session.id, scope.tenantId);
  await recordAudit({ action: "SUPPORT_MODE_STARTED", entity: "Session", tenantId: scope.tenantId, userId: session.user.id, metadata: { tenantName, readOnly: true } });
  return { ok: true, data: undefined };
}

export async function stopSupportMode(session: CurrentSession, reason: "manual" | "logout" = "manual"): Promise<void> {
  if (!session.support) return;
  await setSessionSupportTenant(session.id, null);
  await recordAudit({
    action: "SUPPORT_MODE_STOPPED",
    entity: "Session",
    tenantId: session.support.tenantId,
    userId: session.user.id,
    metadata: { reason, durationSeconds: Math.round((Date.now() - session.support.startedAt.getTime()) / 1000) },
  });
}

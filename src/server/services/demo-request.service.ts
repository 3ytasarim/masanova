import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { rateLimit } from "@/server/rate-limit";
import { getRequestMeta } from "@/lib/security/request-meta";
import type { PlatformScope } from "@/lib/tenant/scope";
import type { DemoRequestInput } from "@/lib/validation/tenant";
import { insertDemoRequest, updateDemoRequest } from "@/server/repositories/demo-request.repository";
import { recordAudit } from "@/server/services/audit.service";

/** IP başına 10 dakikada 3 talep; e-posta başına günde 3 talep (politikalar "demo.ip", "demo.email"). */

export async function submitDemoRequest(input: DemoRequestInput, options: { honeypot: boolean }): Promise<ActionResult> {
  const meta = await getRequestMeta();
  // Bot tuzağı: görünmez alan doluysa başarılı gibi davran ama kaydetme (botu eğitmemek için).
  if (options.honeypot) return { ok: true, data: undefined };

  const [ipLimit, emailLimit] = await Promise.all([rateLimit("demo.ip", meta.ipAddress ?? "unknown"), rateLimit("demo.email", input.email)]);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return { ok: false, error: "Kısa sürede çok fazla talep gönderildi. Lütfen daha sonra tekrar deneyin." };
  }

  const created = await insertDemoRequest({
    name: input.name,
    businessName: input.businessName,
    phone: input.phone,
    email: input.email,
    city: input.city ?? null,
    tableCount: input.tableCount ?? null,
    message: input.message ?? null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  await recordAudit({ action: "DEMO_REQUEST_CREATED", entity: "DemoRequest", entityId: created.id, metadata: { businessName: input.businessName, city: input.city ?? null } });
  return { ok: true, data: undefined };
}

export async function updateDemoRequestStatus(
  actor: { userId: string; platform: PlatformScope },
  id: string,
  input: { status: "NEW" | "CONTACTED" | "QUALIFIED" | "WON" | "LOST"; notes?: string },
): Promise<ActionResult> {
  const ok = await updateDemoRequest(actor.platform, id, { status: input.status, notes: input.notes ?? null });
  if (!ok) return { ok: false, error: "Talep bulunamadı." };
  await recordAudit({ action: "DEMO_REQUEST_UPDATED", entity: "DemoRequest", entityId: id, userId: actor.userId, metadata: { status: input.status, notesUpdated: !!input.notes } });
  return { ok: true, data: undefined, message: "Talep güncellendi." };
}

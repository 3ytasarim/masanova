import "server-only";
import type { Prisma } from "@prisma/client";
import { sanitizeAuditMetadata, type AuditAction, type AuditEntity } from "@/lib/audit/actions";
import { getRequestMeta, type RequestMeta } from "@/lib/security/request-meta";
import { insertAuditLog, type AuditLogInsert } from "@/server/repositories/audit-log.repository";

export type AuditEvent = {
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  tenantId?: string | null;
  /** Eylemi yapan kullanıcı (aktör). */
  userId?: string | null;
  /** Asla parola, token, oturum, bağlantı dizesi içermemeli — yine de sanitizeAuditMetadata emniyet ağıdır. */
  metadata?: Record<string, unknown>;
};

/** Transaction içinde `tx.auditLog.createMany` ile yazmak için satır üretir (temizlenmiş metadata). */
export function buildAuditRow(event: AuditEvent, meta: RequestMeta): AuditLogInsert {
  const metadata = sanitizeAuditMetadata(event.metadata);
  return {
    action: event.action,
    entity: event.entity,
    entityId: event.entityId ?? null,
    tenantId: event.tenantId ?? null,
    userId: event.userId ?? null,
    metadata: metadata === undefined || metadata === null ? undefined : (metadata as Prisma.InputJsonValue),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  };
}

/**
 * Tekil denetim kaydı (transaction dışı). IP / user-agent istekten otomatik eklenir.
 * Yazım başarısız olursa iş akışı durmaz ama hata loglanır (izlenebilirlik kaybı görünür olsun).
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    await insertAuditLog(buildAuditRow(event, await getRequestMeta()));
  } catch (error) {
    console.error("[audit] kayıt yazılamadı", { action: event.action, error });
  }
}

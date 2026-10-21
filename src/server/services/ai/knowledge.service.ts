import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db/prisma";
import type { KnowledgeDocument } from "@/lib/ai/knowledge";
import type { PlatformScope } from "@/lib/tenant/scope";
import type { KnowledgeInput } from "@/lib/validation/knowledge";
import { recordAudit } from "@/server/services/audit.service";

/**
 * Yapay Zeka Eğitimi — platform geneli eğitim metinleri. Okuma (garson oturumları) kısa süreli süreç içi önbellekten;
 * yazma yalnızca Super Admin (PlatformScope) ile ve denetim kaydıyla.
 */
const TTL_MS = 30_000;
let cache: { at: number; docs: KnowledgeDocument[] } | null = null;

export function invalidateKnowledgeCache() {
  cache = null;
}

const SELECT = { id: true, title: true, content: true, active: true, sortOrder: true } as const;

/** Garsonların kullandığı etkin metinler (önbellekli). Okunamazsa boş (yerleşik sağlık kuralları yine çalışır). */
export async function getActiveKnowledge(): Promise<KnowledgeDocument[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.docs;
  try {
    const docs = await prisma.aiKnowledgeDocument.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: SELECT });
    cache = { at: Date.now(), docs };
    return docs;
  } catch {
    return [];
  }
}

export function listKnowledge(_platform: PlatformScope) {
  return prisma.aiKnowledgeDocument.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { ...SELECT, updatedAt: true } });
}

export function findKnowledge(_platform: PlatformScope, id: string) {
  return prisma.aiKnowledgeDocument.findUnique({ where: { id }, select: { ...SELECT, updatedAt: true } });
}

export async function saveKnowledge(platform: PlatformScope, id: string | null, input: KnowledgeInput): Promise<ActionResult<{ id: string }>> {
  const data = { ...input, updatedById: platform.actorUserId };
  let saved: { id: string };
  if (id) {
    if (!(await prisma.aiKnowledgeDocument.findUnique({ where: { id }, select: { id: true } }))) return { ok: false, error: "Metin bulunamadı." };
    saved = await prisma.aiKnowledgeDocument.update({ where: { id }, data, select: { id: true } });
  } else {
    saved = await prisma.aiKnowledgeDocument.create({ data, select: { id: true } });
  }
  invalidateKnowledgeCache();
  await recordAudit({ action: "AI_KNOWLEDGE_SAVED", entity: "AiKnowledgeDocument", entityId: saved.id, tenantId: null, userId: platform.actorUserId, metadata: { title: input.title, active: input.active, length: input.content.length, created: !id } });
  return { ok: true, data: saved, message: id ? "Eğitim metni güncellendi." : "Eğitim metni eklendi." };
}

export async function deleteKnowledge(platform: PlatformScope, id: string): Promise<ActionResult> {
  const row = await prisma.aiKnowledgeDocument.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!row) return { ok: false, error: "Metin bulunamadı." };
  await prisma.aiKnowledgeDocument.delete({ where: { id } });
  invalidateKnowledgeCache();
  await recordAudit({ action: "AI_KNOWLEDGE_DELETED", entity: "AiKnowledgeDocument", entityId: id, tenantId: null, userId: platform.actorUserId, metadata: { title: row.title } });
  return { ok: true, data: undefined, message: "Eğitim metni silindi." };
}

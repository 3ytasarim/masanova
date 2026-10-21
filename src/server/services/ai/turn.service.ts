import "server-only";
import type { AiTurnMode } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ActionCard, ProductCard, RecommendationBundle } from "@/lib/ai/types";
import { isAiLanguage, type AiLanguage } from "@/lib/ai/language";
import type { ConversationRow } from "@/server/services/ai/conversation.service";

/**
 * Tur idempotency'si. İstemci her mantıksal tur için opak bir anahtar üretir; yeniden bağlanma / yeniden deneme AYNI
 * anahtarla gelir. (conversation_id, turn_key) benzersizliği sayesinde:
 *   - tamamlanmış tur ikinci kez işlenmez → kayıtlı yanıt yeniden gönderilir (ses YENİDEN ÜRETİLMEZ, mesaj çoğalmaz)
 *   - aynı anda iki istek gelirse biri "işleniyor" yanıtı alır
 *   - yarıda kalan (yanıtı kaydedilmemiş) tur güvenle yeniden işlenir
 */
/** İşlenen tur bu aralıkla "canlı" işaretlenir; bu kadar süre işaret yoksa (süreç öldü) tur yeniden sahiplenilebilir. */
export const TURN_HEARTBEAT_MS = 5_000;
export const TURN_STALE_MS = 15_000;

export type TurnRow = Awaited<ReturnType<typeof prisma.aiTurn.create>>;

export type StoredReply = {
  messageId: string;
  text: string;
  language: AiLanguage;
  transcript: string | null;
  actions: ActionCard[];
  products: ProductCard[];
  recommendation: RecommendationBundle | null;
};

export type BeginTurn = { kind: "new"; turn: TurnRow } | { kind: "replay"; turn: TurnRow; reply: StoredReply } | { kind: "in_progress" };

async function loadReply(turn: TurnRow, conversation: ConversationRow): Promise<StoredReply | null> {
  if (!turn.assistantMessageId) return null;
  const message = await prisma.aiMessage.findFirst({ where: { id: turn.assistantMessageId, tenantId: conversation.tenantId, conversationId: conversation.id } });
  if (!message) return null;
  const user = await prisma.aiMessage.findFirst({ where: { conversationId: conversation.id, tenantId: conversation.tenantId, role: "USER", createdAt: { lte: message.createdAt } }, orderBy: { createdAt: "desc" }, select: { content: true } });
  const meta = (message.metadata ?? {}) as { actions?: ActionCard[]; products?: ProductCard[]; recommendation?: RecommendationBundle | null; interrupted?: boolean };
  return {
    messageId: message.publicId,
    text: message.content,
    language: isAiLanguage(message.language) ? message.language : "tr",
    transcript: user?.content ?? null,
    // Kesilen turun eylem kartı yeniden gösterilmez.
    actions: meta.interrupted ? [] : (meta.actions ?? []),
    products: meta.products ?? [],
    recommendation: meta.interrupted ? null : (meta.recommendation ?? null),
  };
}

export async function beginTurn(conversation: ConversationRow, turnKey: string, mode: AiTurnMode, now = new Date()): Promise<BeginTurn> {
  // Benzersizlik çakışması beklenen bir durumdur (yeniden deneme) → hata fırlatmadan "atla" (log gürültüsü yok).
  const created = await prisma.aiTurn.createMany({ data: [{ tenantId: conversation.tenantId, conversationId: conversation.id, turnKey, mode, createdAt: now }], skipDuplicates: true });
  const existing = await prisma.aiTurn.findUniqueOrThrow({ where: { conversationId_turnKey: { conversationId: conversation.id, turnKey } } });
  if (created.count === 1) return { kind: "new", turn: existing };
  if (existing.assistantMessageId) {
    const reply = await loadReply(existing, conversation);
    await prisma.aiTurn.update({ where: { id: existing.id }, data: { attempts: { increment: 1 } } });
    if (reply) return { kind: "replay", turn: existing, reply };
  }
  if (existing.status === "PROCESSING" && now.getTime() - existing.updatedAt.getTime() < TURN_STALE_MS) return { kind: "in_progress" };
  // Yanıtı kaydedilmemiş (hata / bayat) tur: koşullu olarak yeniden sahiplen — aynı anda iki yeniden deneme olursa biri kazanır.
  const claimed = await prisma.aiTurn.updateMany({ where: { id: existing.id, updatedAt: existing.updatedAt, assistantMessageId: null }, data: { status: "PROCESSING", attempts: { increment: 1 }, mode, errorCode: null } });
  if (claimed.count !== 1) return { kind: "in_progress" };
  return { kind: "new", turn: await prisma.aiTurn.findUniqueOrThrow({ where: { id: existing.id } }) };
}

/** İşlenen tur için kalp atışı başlat; dönen fonksiyon durdurur. */
export function startTurnHeartbeat(turnId: string): () => void {
  const timer = setInterval(() => {
    void prisma.aiTurn.updateMany({ where: { id: turnId, status: "PROCESSING" }, data: { attempts: { increment: 0 } } }).catch(() => undefined);
  }, TURN_HEARTBEAT_MS);
  return () => clearInterval(timer);
}

export async function failTurn(turn: TurnRow, code: string): Promise<void> {
  await prisma.aiTurn.update({ where: { id: turn.id }, data: { status: "FAILED", errorCode: code.slice(0, 40) } });
}

/**
 * İstemci raporu (oynatma bitti / kesildi): çalınan ses süresi ve kesinti. Yalnızca BU konuşmanın turu güncellenir;
 * süreler yalnızca artar (tekrarlanan rapor zarar vermez). Kesilen yanıtın kartları sonraki tekrarda gösterilmez.
 */
export async function reportTurn(conversation: ConversationRow, turnKey: string, input: { playedMs: number; interrupted: boolean }): Promise<boolean> {
  const turn = await prisma.aiTurn.findUnique({ where: { conversationId_turnKey: { conversationId: conversation.id, turnKey } } });
  if (!turn || turn.tenantId !== conversation.tenantId) return false;
  await prisma.aiTurn.update({
    where: { id: turn.id },
    data: {
      audioOutMs: Math.max(turn.audioOutMs, Math.min(Math.round(input.playedMs), 10 * 60_000)),
      ...(input.interrupted && !turn.interruptedAt ? { interruptedAt: new Date(), ...(turn.status === "COMPLETED" ? { status: "INTERRUPTED" as const } : {}) } : {}),
    },
  });
  if (input.interrupted && turn.assistantMessageId) {
    const message = await prisma.aiMessage.findFirst({ where: { id: turn.assistantMessageId, tenantId: conversation.tenantId }, select: { id: true, metadata: true } });
    if (message) await prisma.aiMessage.update({ where: { id: message.id }, data: { metadata: { ...((message.metadata ?? {}) as Record<string, unknown>), interrupted: true } } });
  }
  return true;
}

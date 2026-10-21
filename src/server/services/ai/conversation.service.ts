import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { AI_LIMITS } from "@/lib/ai/limits";
import { aiDirection, isAiLanguage, type AiLanguage } from "@/lib/ai/language";
import type { ConversationSummary } from "@/lib/ai/types";

/**
 * AI konuşması — gizlilik modeli:
 *  - Masa QR'ı paylaşılır; AI geçmişi PAYLAŞILMAZ. Konuşma yalnızca tarayıcıya verilen yüksek entropili kanıtla (proof,
 *    32 bayt) sürdürülür; sunucuda yalnızca SHA-256 özeti tutulur, kanıt loglanmaz / URL'ye konmaz (başlıkta gelir).
 *  - Kanıt tek başına yetmez: aynı kiracı + AYNI masa + geçerli QR bağlamı + süre birlikte gerekir.
 *  - Süre: 3 saat hareketsizlik, en fazla 6 saat. Süresi dolan konuşma devam ettirilmez (yeni konuşma açılır);
 *    geçmiş kayıtlar kullanım ölçümü için kalır ama müşteriye bir daha gösterilmez.
 */
export const CONVERSATION_IDLE_MS = 3 * 60 * 60 * 1000;
export const CONVERSATION_MAX_MS = 6 * 60 * 60 * 1000;
export const MAX_USER_TURNS = AI_LIMITS.maxUserTurns;
export const HISTORY_FOR_MODEL = 8;
export const HISTORY_FOR_CLIENT = 30;
export const PROOF_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashProof(proof: string): string {
  return createHash("sha256").update(`masanova.ai-proof.v1:${proof}`).digest("hex");
}

export function newProof(): string {
  return randomBytes(32).toString("base64url");
}

export function conversationExpiry(createdAt: Date, lastActivityAt: Date): Date {
  return new Date(Math.min(lastActivityAt.getTime() + CONVERSATION_IDLE_MS, createdAt.getTime() + CONVERSATION_MAX_MS));
}

export type TableScope = { tenantId: string; branchId: string; tableId: string };

/** Kanıt + masa + süre doğrulaması. Herhangi biri tutmazsa null (nedeni ayırt edilmez). */
export async function findConversation(scope: TableScope, proof: string | null | undefined, now = new Date()) {
  if (!proof || !PROOF_PATTERN.test(proof)) return null;
  const row = await prisma.aiConversation.findUnique({ where: { proofHash: hashProof(proof) } });
  if (!row || row.tenantId !== scope.tenantId || row.tableId !== scope.tableId || row.endedAt) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}
export type ConversationRow = NonNullable<Awaited<ReturnType<typeof findConversation>>>;

export async function createConversation(scope: TableScope, input: { uiLocale: string; language: AiLanguage; greeting: string }, now = new Date()) {
  const proof = newProof();
  const conversation = await prisma.$transaction(async (tx) => {
    const row = await tx.aiConversation.create({
      data: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        tableId: scope.tableId,
        publicId: randomBytes(16).toString("base64url"),
        proofHash: hashProof(proof),
        uiLocale: input.uiLocale,
        conversationLanguage: input.language,
        createdAt: now,
        lastActivityAt: now,
        expiresAt: conversationExpiry(now, now),
        messageCount: 1,
      },
    });
    await tx.aiMessage.create({ data: { tenantId: scope.tenantId, conversationId: row.id, publicId: randomBytes(12).toString("base64url"), role: "ASSISTANT", content: input.greeting, language: input.language, createdAt: now } });
    return row;
  });
  return { conversation, proof };
}

export async function conversationSummary(row: ConversationRow, settings: { assistantName: string; voiceEnabled: boolean }): Promise<ConversationSummary> {
  const messages = await prisma.aiMessage.findMany({ where: { conversationId: row.id, tenantId: row.tenantId }, orderBy: { createdAt: "desc" }, take: HISTORY_FOR_CLIENT, select: { publicId: true, role: true, content: true, language: true } });
  const language = isAiLanguage(row.conversationLanguage) ? row.conversationLanguage : "tr";
  return {
    language,
    direction: aiDirection(language),
    assistantName: settings.assistantName,
    voiceEnabled: settings.voiceEnabled,
    messages: messages.reverse().map((m) => ({ id: m.publicId, role: m.role === "USER" ? "user" : "assistant", text: m.content, language: isAiLanguage(m.language) ? m.language : language })),
  };
}

/** Modele giden sınırlı geçmiş (son N mesaj). */
export async function recentHistory(row: ConversationRow) {
  const messages = await prisma.aiMessage.findMany({ where: { conversationId: row.id, tenantId: row.tenantId }, orderBy: { createdAt: "desc" }, take: HISTORY_FOR_MODEL, select: { role: true, content: true } });
  return messages.reverse().map((m) => ({ role: m.role === "USER" ? ("user" as const) : ("assistant" as const), content: m.content }));
}

export async function countUserTurns(row: ConversationRow): Promise<number> {
  return prisma.aiMessage.count({ where: { conversationId: row.id, tenantId: row.tenantId, role: "USER" } });
}

/**
 * Tur sonunda: iki mesaj + dil / bağlam + etkinlik / süre güncellemesi ve (varsa) tur kaydının tamamlanması TEK işlemde —
 * yarıda kesilen yazım yeniden denemede mesajı çoğaltamaz. Asistan mesajının public kimliğini döner.
 */
export async function appendTurn(
  row: ConversationRow,
  input: {
    userText: string;
    inputMode: "VOICE" | "TEXT";
    userLanguage: AiLanguage;
    reply: string;
    replyLanguage: AiLanguage;
    metadata: Prisma.InputJsonValue;
    inputTokens: number;
    outputTokens: number;
    turn?: { id: string; status: "COMPLETED" | "INTERRUPTED"; stats: { sttMs?: number | null; firstTextMs?: number | null; firstAudioMs?: number | null; totalMs?: number | null; audioInMs?: number; audioOutMs?: number } };
  },
  now = new Date(),
): Promise<string> {
  const messageId = randomBytes(12).toString("base64url");
  await prisma.$transaction(async (tx) => {
    // Tur kayıttan ÖNCE kesildiyse (istemci raporu önce geldi): yanıt "kesildi" olarak kaydedilir, kartları tekrar gösterilmez.
    const interruptedEarly = input.turn ? !!(await tx.aiTurn.findUnique({ where: { id: input.turn.id }, select: { interruptedAt: true } }))?.interruptedAt : false;
    const metadata = interruptedEarly ? ({ ...(input.metadata as Record<string, unknown>), interrupted: true } as Prisma.InputJsonValue) : input.metadata;
    await tx.aiMessage.create({ data: { tenantId: row.tenantId, conversationId: row.id, publicId: randomBytes(12).toString("base64url"), role: "USER", inputMode: input.inputMode, content: input.userText, language: input.userLanguage, createdAt: now } });
    const assistant = await tx.aiMessage.create({
      data: {
        tenantId: row.tenantId,
        conversationId: row.id,
        publicId: messageId,
        role: "ASSISTANT",
        content: input.reply,
        language: input.replyLanguage,
        metadata,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        createdAt: new Date(now.getTime() + 1),
      },
      select: { id: true },
    });
    await tx.aiConversation.update({
      where: { id: row.id },
      data: { conversationLanguage: input.replyLanguage, lastActivityAt: now, expiresAt: conversationExpiry(row.createdAt, now), messageCount: { increment: 2 } },
    });
    if (input.turn) {
      const st = input.turn.stats;
      await tx.aiTurn.update({
        where: { id: input.turn.id },
        data: {
          status: interruptedEarly ? "INTERRUPTED" : input.turn.status,
          assistantMessageId: assistant.id,
          ...(input.turn.status === "INTERRUPTED" && !interruptedEarly ? { interruptedAt: now } : {}),
          sttMs: st.sttMs ?? null,
          firstTextMs: st.firstTextMs ?? null,
          firstAudioMs: st.firstAudioMs ?? null,
          totalMs: st.totalMs ?? null,
          audioInMs: Math.round(st.audioInMs ?? 0),
          audioOutMs: Math.round(st.audioOutMs ?? 0),
        },
      });
    }
  });
  return messageId;
}

/** Konuşmanın yapılandırılmış bağlamını kaydet (kesintide de korunur). */
export async function saveContext(row: ConversationRow, context: Prisma.InputJsonValue): Promise<void> {
  await prisma.aiConversation.update({ where: { id: row.id }, data: { context } });
}

/** Ses için: bu konuşmanın asistan mesajı (kanıt + masa doğrulandıktan sonra). */
export async function findAssistantMessage(row: ConversationRow, publicId: string) {
  return prisma.aiMessage.findFirst({ where: { publicId, conversationId: row.id, tenantId: row.tenantId, role: "ASSISTANT" }, select: { content: true, language: true } });
}

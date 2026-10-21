import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { branchClause, num, type AnalyticsFilter } from "@/server/analytics/filter";

/**
 * Sesli AI kullanımı — YALNIZCA meta veri. Konuşma / mesaj METNİ (content) hiçbir sorguda seçilmez.
 *
 *  konuşmalar      : dönemde açılan AiConversation (dil = konuşmanın son dili)
 *  turlar          : AiTurn (canlı / bas-konuş, kesinti, yeniden bağlanma, ses süreleri)
 *  mesaj dilleri   : kullanıcı mesajlarının kayıtlı dili (dağılım)
 *  AI eylemleri    : asistan mesajı metadata'sında KALICI saklanan yapılandırılmış kartlar (ürün kartı, sepet / servis
 *                    hazırlığı, öneri) — log'dan türetilmez
 *
 * AI → sipariş ilişkisi HESAPLANMAZ: sipariş kaydı konuşma / tarayıcı kimliği taşımaz; aynı masadaki sipariş AI'dan
 * kaynaklandı denemez (güvenilir bağ yok — ileride oturum ilişkilendirmesiyle).
 */
export type AiAnalytics = {
  conversations: number;
  turns: number;
  liveTurns: number;
  fallbackTurns: number;
  interruptions: number;
  reconnects: number;
  failedTurns: number;
  voiceSeconds: number;
  conversationLanguages: { language: string; count: number }[];
  messageLanguages: { language: string; count: number }[];
  actions: { kind: string; count: number }[];
  productCardsShown: number;
  recommendations: number;
};

export async function aiAnalytics(f: AnalyticsFilter): Promise<AiAnalytics> {
  const convWhere = Prisma.sql`c.tenant_id = ${f.tenantId} AND c.created_at >= ${f.start} AND c.created_at < ${f.end}${branchClause("c", f.branchId)}`;
  const [conv, langs, turns, msgLangs, actions, cards] = await Promise.all([
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM ai_conversations c WHERE ${convWhere}`),
    prisma.$queryRaw<{ language: string; count: number }[]>(Prisma.sql`
      SELECT c.conversation_language AS language, COUNT(*)::int AS count FROM ai_conversations c WHERE ${convWhere} GROUP BY 1 ORDER BY 2 DESC`),
    prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT COUNT(*)::int AS turns,
             COUNT(*) FILTER (WHERE t.mode = 'REALTIME')::int AS live,
             COUNT(*) FILTER (WHERE t.mode = 'FALLBACK')::int AS fallback,
             COUNT(*) FILTER (WHERE t.interrupted_at IS NOT NULL)::int AS interruptions,
             COALESCE(SUM(GREATEST(t.attempts - 1, 0)), 0)::int AS reconnects,
             COUNT(*) FILTER (WHERE t.status = 'FAILED')::int AS failed,
             COALESCE(SUM(t.audio_in_ms + t.audio_out_ms), 0)::bigint AS audio_ms
      FROM ai_turns t JOIN ai_conversations c ON c.id = t.conversation_id AND c.tenant_id = t.tenant_id
      WHERE t.tenant_id = ${f.tenantId} AND t.created_at >= ${f.start} AND t.created_at < ${f.end}${branchClause("c", f.branchId)}`),
    prisma.$queryRaw<{ language: string; count: number }[]>(Prisma.sql`
      SELECT m.language, COUNT(*)::int AS count
      FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${f.tenantId} AND m.role = 'USER' AND m.created_at >= ${f.start} AND m.created_at < ${f.end}${branchClause("c", f.branchId)}
      GROUP BY 1 ORDER BY 2 DESC`),
    prisma.$queryRaw<{ kind: string; count: number }[]>(Prisma.sql`
      SELECT a.value ->> 'kind' AS kind, COUNT(*)::int AS count
      FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id,
           LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.metadata -> 'actions') = 'array' THEN m.metadata -> 'actions' ELSE '[]'::jsonb END) a
      WHERE m.tenant_id = ${f.tenantId} AND m.role = 'ASSISTANT' AND m.created_at >= ${f.start} AND m.created_at < ${f.end}${branchClause("c", f.branchId)}
      GROUP BY 1 ORDER BY 2 DESC`),
    prisma.$queryRaw<{ products: bigint; recs: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN jsonb_typeof(m.metadata -> 'products') = 'array' THEN jsonb_array_length(m.metadata -> 'products') ELSE 0 END), 0)::bigint AS products,
             COUNT(*) FILTER (WHERE jsonb_typeof(m.metadata -> 'recommendation') = 'object')::int AS recs
      FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${f.tenantId} AND m.role = 'ASSISTANT' AND m.created_at >= ${f.start} AND m.created_at < ${f.end}${branchClause("c", f.branchId)}`),
  ]);
  const t = turns[0] ?? {};
  return {
    conversations: num(conv[0]?.n),
    turns: num(t.turns),
    liveTurns: num(t.live),
    fallbackTurns: num(t.fallback),
    interruptions: num(t.interruptions),
    reconnects: num(t.reconnects),
    failedTurns: num(t.failed),
    voiceSeconds: Math.round(num(t.audio_ms) / 1000),
    conversationLanguages: langs.map((l) => ({ language: l.language, count: num(l.count) })),
    messageLanguages: msgLangs.map((l) => ({ language: l.language, count: num(l.count) })),
    actions: actions.filter((a) => a.kind).map((a) => ({ kind: a.kind, count: num(a.count) })),
    productCardsShown: num(cards[0]?.products),
    recommendations: num(cards[0]?.recs),
  };
}

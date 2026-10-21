import "server-only";
import type { AiUsageKind } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { summarizeUsage, summarizeVoice, type UsageSummary, type VoiceSummary, type VoiceTurnRow } from "@/lib/ai/usage";
import { zonedDayBounds } from "@/lib/service-requests/timing";

/**
 * Kullanım ölçümü (fiyatlandırma yok). Kayıt başarısız olsa da müşteri akışı bozulmaz (hata yutulur, loglanır).
 * Log satırlarında içerik / anahtar / kanıt yok — yalnızca tür ve hata kodu.
 */
export async function recordUsage(entry: {
  tenantId: string;
  conversationId?: string | null;
  kind: AiUsageKind;
  provider: string;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  sttMs?: number;
  ttsCharacters?: number;
  latencyMs?: number;
  success?: boolean;
  errorCode?: string | null;
}): Promise<void> {
  try {
    await prisma.aiUsage.create({
      data: {
        tenantId: entry.tenantId,
        conversationId: entry.conversationId ?? null,
        kind: entry.kind,
        provider: entry.provider,
        model: entry.model ?? null,
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        sttMs: Math.max(0, Math.round(entry.sttMs ?? 0)),
        ttsCharacters: entry.ttsCharacters ?? 0,
        latencyMs: Math.max(0, Math.round(entry.latencyMs ?? 0)),
        success: entry.success ?? true,
        errorCode: entry.errorCode ?? null,
      },
    });
  } catch (error) {
    console.error("[ai-usage] kayıt yazılamadı", { kind: entry.kind, code: error instanceof Error ? error.name : "unknown" });
  }
}

async function summarizeRange(where: { tenantId?: string; createdAt: { gte: Date; lt?: Date } }): Promise<UsageSummary> {
  // Müşteri sesli AI kullanımı: İşletme Danışmanı (ADVISOR) ayrı sayılır, buraya karışmaz.
  const rows = await prisma.aiUsage.findMany({ where: { ...where, kind: { not: "ADVISOR" } }, select: { kind: true, inputTokens: true, outputTokens: true, sttMs: true, ttsCharacters: true, success: true } });
  return summarizeUsage(rows);
}

/** İşletme: bugün (restoran saat dilimi) ve bu ay. */
export async function tenantUsage(tenantId: string, timezone: string, now = new Date()) {
  const today = zonedDayBounds(timezone, now);
  // Ayın ilk günü (yerel): bugünden (gün − 1) gün geri, öğlene göre → yaz saati kaymasından etkilenmez.
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const day = Number(local.slice(8, 10));
  const monthStart = zonedDayBounds(timezone, new Date(today.start.getTime() - (day - 1) * 24 * 3600 * 1000 + 12 * 3600 * 1000)).start;
  const [todaySummary, month, voiceToday, voiceMonth] = await Promise.all([
    summarizeRange({ tenantId, createdAt: { gte: today.start, lt: today.end } }),
    summarizeRange({ tenantId, createdAt: { gte: monthStart } }),
    voiceRange({ tenantId, createdAt: { gte: today.start, lt: today.end } }),
    voiceRange({ tenantId, createdAt: { gte: monthStart } }),
  ]);
  return { today: todaySummary, month, monthStart, voiceToday, voiceMonth };
}

const VOICE_SELECT = { conversationId: true, mode: true, status: true, attempts: true, audioInMs: true, audioOutMs: true, interruptedAt: true, errorCode: true, firstAudioMs: true, totalMs: true } as const;

/** Sesli tur özeti (yalnızca meta veri — içerik yok). */
export async function voiceRange(where: { tenantId?: string; createdAt: { gte: Date; lt?: Date } }): Promise<VoiceSummary> {
  const rows = await prisma.aiTurn.findMany({ where, select: VOICE_SELECT });
  return summarizeVoice(rows.map((r) => ({ ...r, interrupted: !!r.interruptedAt })));
}

/** Super Admin: kiracı bazında sesli tur özeti (dönem). */
export async function platformVoiceByTenant(monthStart: Date): Promise<Map<string, VoiceSummary>> {
  const rows = await prisma.aiTurn.findMany({ where: { createdAt: { gte: monthStart } }, select: { ...VOICE_SELECT, tenantId: true } });
  const groups = new Map<string, VoiceTurnRow[]>();
  for (const r of rows) {
    const list = groups.get(r.tenantId) ?? [];
    list.push({ ...r, interrupted: !!r.interruptedAt });
    groups.set(r.tenantId, list);
  }
  return new Map([...groups].map(([tenantId, list]) => [tenantId, summarizeVoice(list)]));
}

/** Super Admin: dönem (UTC ay) içinde kiracı bazında toplamlar — yalnızca meta veri, konuşma içeriği yok. */
export async function platformUsageByTenant(monthStart: Date) {
  const grouped = await prisma.aiUsage.groupBy({
    by: ["tenantId", "kind"],
    where: { createdAt: { gte: monthStart } },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, sttMs: true, ttsCharacters: true },
  });
  const tenants = await prisma.tenant.findMany({ where: { id: { in: [...new Set(grouped.map((g) => g.tenantId))] } }, select: { id: true, name: true, slug: true, plan: true } });
  const byTenant = new Map<string, { tenant: (typeof tenants)[number]; conversations: number; messages: number; inputTokens: number; outputTokens: number; sttSeconds: number; ttsCharacters: number }>();
  for (const g of grouped) {
    const tenant = tenants.find((t) => t.id === g.tenantId);
    if (!tenant) continue;
    const row = byTenant.get(g.tenantId) ?? { tenant, conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0, sttSeconds: 0, ttsCharacters: 0 };
    if (g.kind === "CONVERSATION") row.conversations += g._count._all;
    if (g.kind === "CHAT") row.messages += g._count._all;
    row.inputTokens += g._sum.inputTokens ?? 0;
    row.outputTokens += g._sum.outputTokens ?? 0;
    row.sttSeconds += Math.round((g._sum.sttMs ?? 0) / 100) / 10;
    row.ttsCharacters += g._sum.ttsCharacters ?? 0;
    byTenant.set(g.tenantId, row);
  }
  return [...byTenant.values()].sort((a, b) => b.messages - a.messages);
}

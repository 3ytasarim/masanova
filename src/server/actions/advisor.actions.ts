"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { rateLimit } from "@/server/rate-limit";
import { dismissInsight, refreshAdvisor, setInsightFeedback, type AdvisorActor } from "@/server/services/advisor/advisor.service";

/**
 * İşletme Danışmanı eylemleri — requireTenantUser({ permission: "advisor.manage", write: true }): sahip / müdür;
 * Super Admin destek modu REDDEDİLİR (404). Kiracı oturumdan; istemciden gelen kiracı kimliği yok.
 * Bu eylemler YALNIZCA danışman kayıtlarını (durum / geri bildirim / açıklama) etkiler — fiyat, menü, istasyon,
 * personel ya da ayar DEĞİŞMEZ.
 */
const PATH = "/panel/ai/danisman";
const id = z.string().trim().min(1).max(40).regex(/^[a-z0-9]+$/i);
const query = z.object({ range: z.string().max(10).optional(), branch: z.string().max(40).regex(/^[a-z0-9]*$/i).optional() });

async function actor(): Promise<AdvisorActor> {
  const ctx = await requireTenantUser({ permission: "advisor.manage", write: true });
  return { scope: ctx.scope, userId: ctx.user.id, canMutate: true };
}

export async function refreshAdvisorAction(range: string, branch: string): Promise<ActionResult> {
  const a = await actor();
  const parsed = query.safeParse({ range, branch: branch || undefined });
  if (!parsed.success) return { ok: false, error: "Geçersiz istek." };
  const limited = await rateLimit("advisor.refresh", a.scope.tenantId);
  if (!limited.allowed) return { ok: false, error: `Analiz kısa süre önce yenilendi. ${Math.ceil(limited.retryAfterSeconds / 60)} dk sonra tekrar deneyin.` };
  const result = await refreshAdvisor(a, { range: parsed.data.range, branch: parsed.data.branch || null });
  revalidatePath(PATH);
  if (!result.ok) return { ok: false, error: result.error === "branch_invalid" ? "Şube bulunamadı." : "Analiz yenilenemedi." };
  const message = result.fallback
    ? "Analiz yenilendi. AI açıklaması şu an kullanılamıyor; içgörüler hesaplanan verilerle gösteriliyor."
    : result.explained + result.reused > 0
      ? "Analiz yenilendi ve içgörüler açıklandı."
      : "Analiz yenilendi.";
  return { ok: true, data: undefined, message };
}

export async function dismissInsightAction(insightId: string): Promise<ActionResult> {
  const a = await actor();
  const parsed = id.safeParse(insightId);
  if (!parsed.success || !(await dismissInsight(a, parsed.data))) return { ok: false, error: "İçgörü bulunamadı." };
  revalidatePath(PATH);
  return { ok: true, data: undefined, message: "İçgörü kapatıldı." };
}

export async function insightFeedbackAction(insightId: string, value: "USEFUL" | "NOT_USEFUL"): Promise<ActionResult> {
  const a = await actor();
  const parsed = id.safeParse(insightId);
  if (!parsed.success || (value !== "USEFUL" && value !== "NOT_USEFUL") || !(await setInsightFeedback(a, parsed.data, value))) return { ok: false, error: "İçgörü bulunamadı." };
  revalidatePath(PATH);
  return { ok: true, data: undefined, message: "Geri bildiriminiz için teşekkürler." };
}

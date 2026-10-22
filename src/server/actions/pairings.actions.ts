"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { pairingViews, parsePairingText, resolvePairings, type PairingView } from "@/lib/ai/pairings";
import { featureDenied } from "@/server/billing/action-gate";
import { loadIndexProducts, runtimeLexicon } from "@/server/services/ai/voice-index.service";
import { recordAudit } from "@/server/services/audit.service";
import { generatePairingsWithAi } from "@/server/services/ai/pairings.service";

/**
 * Yemek eşleştirmeleri — ai.manage (sahip / müdür), voice_ai paketi. Metin satırları menü ürünlerine çözülür; yalnızca
 * çözülenler saklanır (ürün anahtarı). Çözülemeyen adlar kullanıcıya gösterilir (düzeltmesi için), saklanmaz.
 */
export type PairingsState = ActionResult<{ views: PairingView[]; unmatched: { line: number; text: string }[] }> | null;

const schema = z.object({ text: z.string().max(20_000, "Metin çok uzun (en fazla 20.000 karakter).") });

export async function savePairingsAction(_prev: PairingsState, fd: FormData): Promise<PairingsState> {
  const ctx = await requireTenantUser({ permission: "ai.manage", write: true });
  const gate = await featureDenied(ctx.scope.tenantId, "voice_ai");
  if (gate) return gate;
  const parsed = schema.safeParse({ text: fd.get("text") ?? "" });
  if (!parsed.success) return invalid(parsed.error);

  const products = await loadIndexProducts(ctx.scope);
  const lexicon = await runtimeLexicon(ctx.scope.tenantId, products);
  const { pairings, unmatched } = resolvePairings(parsePairingText(parsed.data.text), products, lexicon);
  const value = pairings.length ? (pairings as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  await prisma.aiSettings.upsert({ where: { tenantId: ctx.scope.tenantId }, update: { pairings: value }, create: { tenantId: ctx.scope.tenantId, pairings: value } });
  await recordAudit({ action: "AI_SETTINGS_UPDATED", entity: "AiSettings", entityId: ctx.scope.tenantId, tenantId: ctx.scope.tenantId, userId: ctx.user.id, metadata: { pairings: pairings.length, unmatched: unmatched.length } });
  revalidatePath("/panel/ai/eslestirmeler");
  return {
    ok: true,
    data: { views: pairingViews(pairings, products), unmatched },
    message: unmatched.length ? `${pairings.length} eşleştirme kaydedildi; ${unmatched.length} ad menüde bulunamadı.` : `${pairings.length} eşleştirme kaydedildi.`,
  };
}

export type GeneratePairingsResult = ActionResult<{ text: string; views: PairingView[]; unmatched: { line: number; text: string }[]; mains: number }>;

/** "Yapay zekayla oluştur": menüye göre öneri üretir, KAYDETMEZ (işletme gözden geçirip "Kaydet"e basar). */
export async function generatePairingsAction(): Promise<GeneratePairingsResult> {
  const ctx = await requireTenantUser({ permission: "ai.manage", write: true });
  const gate = await featureDenied(ctx.scope.tenantId, "voice_ai");
  if (gate) return gate;
  const r = await generatePairingsWithAi(ctx.scope);
  if ("error" in r) return { ok: false, error: r.error === "no_mains" ? "Menüde ana yemek bulunamadı." : "Yapay zekâ şu anda kullanılamıyor (sağlayıcı yapılandırılmamış)." };
  if (!r.views.length) return { ok: false, error: "Öneri üretilemedi. Lütfen tekrar deneyin." };
  return { ok: true, data: { text: r.text, views: r.views, unmatched: r.unmatched, mains: r.mains }, message: `${r.views.length} ana yemek için öneri hazırlandı. Kontrol edip “Kaydet”e basın.` };
}

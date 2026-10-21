"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { detectOptions, matchProduct, type MatchResult } from "@/lib/ai/voice-lexicon";
import { featureDenied } from "@/server/billing/action-gate";
import { buildVoiceIndex, loadIndexProducts, runtimeLexicon } from "@/server/services/ai/voice-index.service";
import { buildAuditRow } from "@/server/services/audit.service";
import { prisma } from "@/lib/db/prisma";
import { getRequestMeta } from "@/lib/security/request-meta";

/**
 * Sesli menü eğitimi — ai.manage (sahip / müdür), voice_ai paketi. Kiracı yalnızca oturumdan.
 *   buildVoiceIndexAction: menüyü tara + sözlüğü kur (deterministik + doğrulanmış yapay zekâ söyleyişleri).
 *   testVoiceMatchAction: yazılan ifadeyi (konuşma tanıma çıktısı gibi) çalışma anındaki eşleştiriciyle dener.
 */
export async function buildVoiceIndexAction(): Promise<ActionResult> {
  const ctx = await requireTenantUser({ permission: "ai.manage", write: true });
  const gate = await featureDenied(ctx.scope.tenantId, "voice_ai");
  if (gate) return gate;
  const view = await buildVoiceIndex(ctx.scope);
  await prisma.auditLog.create({
    data: buildAuditRow({ action: "VOICE_MENU_INDEX_BUILT", entity: "VoiceMenuIndex", entityId: ctx.scope.tenantId, tenantId: ctx.scope.tenantId, userId: ctx.user.id, metadata: { status: view.status, ...view.counts } }, await getRequestMeta()),
  });
  revalidatePath("/panel/ai/menu-egitimi");
  if (view.status !== "READY") return { ok: false, error: "Menü taranamadı. Lütfen tekrar deneyin." };
  return { ok: true, data: undefined, message: `Tarama tamamlandı: ${view.counts.products} ürün, ${view.counts.terms} söyleyiş.` };
}

export type VoiceMatchPreview = {
  status: MatchResult["status"];
  reply: string;
  product: string | null;
  variant: string | null;
  modifiers: string[];
  candidates: { name: string; score: number; soldOut: boolean }[];
};

const phraseSchema = z.string().trim().min(1, "Bir ifade yazın.").max(120, "En fazla 120 karakter.");

export async function testVoiceMatchAction(phrase: unknown): Promise<{ ok: true; data: VoiceMatchPreview } | { ok: false; error: string }> {
  const ctx = await requireTenantUser({ permission: "ai.manage" });
  const gate = await featureDenied(ctx.scope.tenantId, "voice_ai");
  if (gate) return gate;
  const parsed = phraseSchema.safeParse(phrase);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz ifade." };
  const products = await loadIndexProducts(ctx.scope);
  const lexicon = await runtimeLexicon(ctx.scope.tenantId, products);
  const r = matchProduct(lexicon, parsed.data);
  const product = "product" in r ? r.product.name : null;
  const entry = "product" in r && r.status === "high" ? lexicon.entries.find((e) => e.productKey === r.product.productKey) : undefined;
  const options = entry ? detectOptions(entry, parsed.data) : null;
  const reply =
    r.status === "high"
      ? `Eşleşti: ${product}.`
      : r.status === "medium"
        ? `Onay sorulur: «${product}» mı demek istediniz?`
        : r.status === "ambiguous"
          ? `Seçenek sorulur: ${r.candidates.map((c) => c.name).join(" / ")} — hangisi?`
          : r.status === "sold_out"
            ? `${product} şu an tükendi; otomatik seçilmez.`
            : r.status === "low"
              ? "Tekrar etmesi istenir: “Tam anlayamadım; ürünün adını tekrar eder misiniz?”"
              : "“Menümüzde bu isimde bir ürün bulamadım.” — ürün uydurulmaz.";
  return {
    ok: true,
    data: {
      status: r.status,
      reply,
      product,
      variant: options?.variant?.name ?? null,
      modifiers: options?.modifiers.map((m) => m.name) ?? [],
      candidates: r.candidates.map((c) => ({ name: c.name, score: c.score, soldOut: c.soldOut })),
    },
  };
}

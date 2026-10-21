"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireSuperAdmin, requireSuperAdminTenant } from "@/lib/auth/guards";
import { setFlash } from "@/lib/flash";
import { buildGuidance, detectCondition, planMealByCalories, type CaloriePlanResult, type Guidance } from "@/lib/ai/knowledge";
import { flattenMenu } from "@/lib/ai/menu-match";
import { knowledgeSchema } from "@/lib/validation/knowledge";
import { listBranches } from "@/server/repositories/branch.repository";
import { getPublishedMenu } from "@/server/services/menu/public-menu.service";
import { createMenuRefs } from "@/server/services/orders/menu-refs";
import { loadPublicPresentation } from "@/server/services/public-menu/public-menu-cache";
import { toPublicMenuView } from "@/server/services/public-menu/serialize";
import { deleteKnowledge, getActiveKnowledge, saveKnowledge } from "@/server/services/ai/knowledge.service";

/**
 * Yapay Zeka Eğitimi eylemleri — YALNIZCA Super Admin (requireSuperAdmin). Metinler platform genelidir; "Dene"
 * eylemi seçilen işletmenin yayınlanmış menüsüyle garsonun ne önereceğini gösterir (hiçbir şeyi değiştirmez).
 */
type FormState = ActionResult | null;
const BASE = "/admin/yapay-zeka-egitimi";
const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/);
const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
};

export async function saveKnowledgeAction(id: string | null, _prev: FormState, fd: FormData): Promise<FormState> {
  const { platform } = await requireSuperAdmin();
  if (id !== null && !idSchema.safeParse(id).success) return { ok: false, error: "Metin bulunamadı." };
  const parsed = knowledgeSchema.safeParse({ title: str(fd, "title"), content: str(fd, "content"), active: fd.get("active") === "on", sortOrder: str(fd, "sortOrder") ?? "0" });
  if (!parsed.success) return invalid(parsed.error);
  const result = await saveKnowledge(platform, id, parsed.data);
  if (!result.ok) return result;
  revalidatePath(BASE);
  await setFlash(result.message ?? "Kaydedildi.");
  redirect(BASE);
}

export async function deleteKnowledgeAction(id: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  const { platform } = await requireSuperAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Metin bulunamadı." };
  const result = await deleteKnowledge(platform, id);
  if (!result.ok) return result;
  revalidatePath(BASE);
  await setFlash(result.message ?? "Silindi.");
  redirect(BASE);
}

export type KnowledgeTestResult = ActionResult<{ tenantName: string; guidance: Guidance; calories: CaloriePlanResult | null }> | null;

/** "Dene": müşteri cümlesi + işletme → garsonun alacağı eğitim bölümleri, menü önerileri ve (kalori söylendiyse) öğün planı. */
export async function testKnowledgeAction(_prev: KnowledgeTestResult, fd: FormData): Promise<KnowledgeTestResult> {
  await requireSuperAdmin();
  const parsed = z.object({ tenantId: idSchema, sentence: z.string().trim().min(3, "Bir müşteri cümlesi yazın.").max(300) }).safeParse({ tenantId: str(fd, "tenantId"), sentence: str(fd, "sentence") });
  if (!parsed.success) return invalid(parsed.error);
  const { tenant, scope } = await requireSuperAdminTenant(parsed.data.tenantId);
  const presentation = await loadPublicPresentation(scope);
  const branch = (await listBranches(scope, { activeOnly: true }))[0] ?? null;
  const menu = await getPublishedMenu(scope, { branchId: branch?.id ?? null, locale: presentation.defaultLocale });
  const view = toPublicMenuView(menu, { ...presentation, showNutrition: true, showAllergens: true, showIngredients: true, showPreparationTime: true, showPoweredBy: true }, { table: null, refOf: createMenuRefs(scope.tenantId), ordering: null });
  const products = flattenMenu(view);
  const sentence = parsed.data.sentence;
  const guidance = buildGuidance(products, await getActiveKnowledge(), sentence);
  // "600 kalori", "500 kcal" → kalori planı
  const kcal = /(\d{3,4})\s*(kalori|kcal|cal)/i.exec(sentence);
  const calories = kcal ? planMealByCalories(products, { maxCalories: Math.min(4000, Math.max(100, Number(kcal[1]))), condition: detectCondition(sentence) }) : null;
  return { ok: true, data: { tenantName: tenant.name, guidance, calories } };
}

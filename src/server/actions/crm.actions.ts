"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { cleanName, normalizeEmail, normalizePhone } from "@/lib/crm/contact";
import { MAX_ADJUSTMENT } from "@/lib/crm/loyalty";
import { getRequestMeta } from "@/lib/security/request-meta";
import { createManualCustomer, revokeConsentByStaff, updateCustomerByStaff } from "@/server/crm/crm-panel.service";
import { adjustPoints, updateLoyaltySettings } from "@/server/crm/loyalty.service";
import { featureDenied } from "@/server/billing/action-gate";

/**
 * CRM / sadakat panel eylemleri — requireTenantUser({ permission, write: true }): sahip / şube müdürü; Super Admin
 * destek modu REDDEDİLİR (404, salt okunur). Kiracı oturumdan; formdaki kiracı / müşteri kimliği yalnızca KİRACI İÇİNDE
 * aranır (başka kiracının kaydı "bulunamadı"). Personel müşteri adına pazarlama onayı VEREMEZ; yalnızca geri alabilir.
 */
const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const customerId = z.string().trim().min(1).max(40).regex(/^[a-z0-9]+$/i);

const profileSchema = z
  .object({
    firstName: z.string().max(80),
    lastName: z.string().max(80),
    phone: z.string().max(32),
    email: z.string().max(254),
    staffNote: z.string().max(500, "Not en fazla 500 karakter olabilir."),
  })
  .superRefine((v, ctx) => {
    if (v.firstName.trim() && !cleanName(v.firstName)) ctx.addIssue({ code: "custom", path: ["firstName"], message: "Geçerli bir ad girin." });
    if (v.lastName.trim() && !cleanName(v.lastName)) ctx.addIssue({ code: "custom", path: ["lastName"], message: "Geçerli bir soyad girin." });
    if (v.phone.trim() && !normalizePhone(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Geçerli bir telefon girin (ör. 0532 123 45 67)." });
    if (v.email.trim() && !normalizeEmail(v.email)) ctx.addIssue({ code: "custom", path: ["email"], message: "Geçerli bir e-posta girin." });
    if (!v.firstName.trim() && !v.phone.trim() && !v.email.trim()) ctx.addIssue({ code: "custom", path: ["firstName"], message: "En az ad, telefon ya da e-posta girin." });
  });

function profileFrom(fd: FormData) {
  return profileSchema.safeParse({ firstName: str(fd, "firstName"), lastName: str(fd, "lastName"), phone: str(fd, "phone"), email: str(fd, "email"), staffNote: str(fd, "staffNote") });
}

function normalized(v: z.infer<typeof profileSchema>) {
  const phoneNormalized = normalizePhone(v.phone);
  const emailNormalized = normalizeEmail(v.email);
  return {
    firstName: cleanName(v.firstName),
    lastName: cleanName(v.lastName),
    contact: { phone: phoneNormalized, phoneNormalized, email: emailNormalized, emailNormalized },
    staffNote: v.staffNote.trim() || null,
  };
}

export async function createCustomerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const ctx = await requireTenantUser({ permission: "crm.manage", write: true });
  const gate = await featureDenied(ctx.scope.tenantId, "crm");
  if (gate) return gate;
  const parsed = profileFrom(fd);
  if (!parsed.success) return invalid(parsed.error);
  const id = await createManualCustomer({ scope: ctx.scope, userId: ctx.user.id, meta: await getRequestMeta() }, normalized(parsed.data));
  revalidatePath("/panel/musteriler");
  redirect(`/panel/musteriler/${id}`);
}

export async function updateCustomerAction(id: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const ctx = await requireTenantUser({ permission: "crm.manage", write: true });
  const gate = await featureDenied(ctx.scope.tenantId, "crm");
  if (gate) return gate;
  if (!customerId.safeParse(id).success) return { ok: false, error: "Müşteri bulunamadı." };
  const parsed = profileFrom(fd);
  if (!parsed.success) return invalid(parsed.error);
  const ok = await updateCustomerByStaff({ scope: ctx.scope, userId: ctx.user.id, meta: await getRequestMeta() }, id, normalized(parsed.data));
  if (!ok) return { ok: false, error: "Müşteri bulunamadı." };
  revalidatePath(`/panel/musteriler/${id}`);
  return { ok: true, data: undefined, message: "Müşteri bilgileri kaydedildi." };
}

const marketingType = z.enum(["MARKETING_EMAIL", "MARKETING_SMS", "MARKETING_WHATSAPP"]);

export async function revokeConsentAction(id: string, type: string): Promise<ActionResult> {
  const ctx = await requireTenantUser({ permission: "crm.manage", write: true });
  const t = marketingType.safeParse(type);
  if (!customerId.safeParse(id).success || !t.success) return { ok: false, error: "Geçersiz istek." };
  const ok = await revokeConsentByStaff({ scope: ctx.scope, userId: ctx.user.id, meta: await getRequestMeta() }, id, t.data);
  if (!ok) return { ok: false, error: "Müşteri bulunamadı." };
  revalidatePath(`/panel/musteriler/${id}`);
  return { ok: true, data: undefined, message: "Pazarlama izni geri alındı." };
}

const adjustSchema = z.object({
  points: z.coerce.number().int("Tam sayı girin.").refine((n) => n !== 0, "0 olamaz.").refine((n) => Math.abs(n) <= MAX_ADJUSTMENT, `En fazla ±${MAX_ADJUSTMENT}.`),
  reason: z.string().trim().min(3, "Gerekçe girin.").max(200),
});

export async function adjustPointsAction(id: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const ctx = await requireTenantUser({ permission: "loyalty.manage", write: true });
  const gate = await featureDenied(ctx.scope.tenantId, "loyalty");
  if (gate) return gate;
  if (!customerId.safeParse(id).success) return { ok: false, error: "Müşteri bulunamadı." };
  const parsed = adjustSchema.safeParse({ points: str(fd, "points"), reason: str(fd, "reason") });
  if (!parsed.success) return invalid(parsed.error);
  const r = await adjustPoints({ scope: ctx.scope, userId: ctx.user.id, meta: await getRequestMeta() }, id, parsed.data.points, parsed.data.reason);
  if (!r.ok) {
    const error = r.reason === "no_account" ? "Müşteri sadakat programına katılmamış." : r.reason === "negative_balance" ? "Bakiye eksiye düşemez." : "Geçersiz düzeltme.";
    return { ok: false, error };
  }
  revalidatePath(`/panel/musteriler/${id}`);
  return { ok: true, data: undefined, message: `Puan düzeltildi. Yeni bakiye: ${r.balance}.` };
}

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    // Panelde "1 puan için gereken tutar" (ana para birimi, ör. 10 ₺) → kuruş.
    amountPerPoint: z.string().trim().max(12),
    earnOn: z.enum(["SERVED", "ACCEPTED"]),
  })
  .superRefine((v, ctx) => {
    const n = Number(v.amountPerPoint.replace(",", "."));
    if (v.amountPerPoint && (!Number.isFinite(n) || n <= 0 || n > 100_000)) ctx.addIssue({ code: "custom", path: ["amountPerPoint"], message: "0'dan büyük bir tutar girin." });
    if (v.enabled && !v.amountPerPoint) ctx.addIssue({ code: "custom", path: ["amountPerPoint"], message: "Sadakati açmak için puan kuralını belirleyin." });
  });

export async function saveLoyaltySettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const ctx = await requireTenantUser({ permission: "loyalty.manage", write: true });
  const gate = await featureDenied(ctx.scope.tenantId, "loyalty");
  if (gate) return gate;
  const parsed = settingsSchema.safeParse({ enabled: fd.get("enabled") === "on", amountPerPoint: str(fd, "amountPerPoint"), earnOn: str(fd, "earnOn") || "SERVED" });
  if (!parsed.success) return invalid(parsed.error);
  const amount = parsed.data.amountPerPoint ? Math.round(Number(parsed.data.amountPerPoint.replace(",", ".")) * 100) : null;
  await updateLoyaltySettings({ scope: ctx.scope, userId: ctx.user.id, meta: await getRequestMeta() }, { enabled: parsed.data.enabled, minorPerPoint: amount && amount > 0 ? amount : null, earnOn: parsed.data.earnOn });
  revalidatePath("/panel/sadakat");
  return { ok: true, data: undefined, message: "Sadakat ayarları kaydedildi." };
}

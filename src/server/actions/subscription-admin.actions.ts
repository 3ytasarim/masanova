"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { isFeature, isLimitKey } from "@/config/plans";
import { getRequestMeta } from "@/lib/security/request-meta";
import { planSchema } from "@/lib/validation/tenant";
import { activate, extendTrial, removeOverride, scheduleCancel, setOverride, setPeriodEnd, setStatus, startTrial, SubscriptionError, type BillingActor } from "@/server/billing/subscription.service";

/**
 * Super Admin abonelik yönetimi (manuel faturalama). Yalnızca platform yöneticisi; kiracı paneli / destek oturumu
 * abonelik DEĞİŞTİREMEZ (bu eylemler requireSuperAdminTenant ister). Her değişiklik olay + denetim kaydı yazar.
 * Tarihler "YYYY-MM-DD" (İstanbul) alınır, MUTLAK zamana çevrilir: bitiş = o günün sonu (ertesi gün 00:00 +03:00).
 */
type FormState = ActionResult | null;
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const DAY = 86_400_000;

function endOfDay(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + DAY);
}

async function ctx(tenantId: string): Promise<{ actor: BillingActor; tenantId: string }> {
  const { user, tenant } = await requireSuperAdminTenant(tenantId);
  return { actor: { userId: user.id, meta: await getRequestMeta() }, tenantId: tenant.id };
}

async function run(tenantId: string, fn: () => Promise<void>, message: string): Promise<FormState> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof SubscriptionError) return { ok: false, error: error.code === "not_found" ? "İşletme bulunamadı." : "Geçersiz değer. Tarih gelecekte olmalı, gün 1–90 arası." };
    throw error;
  }
  revalidatePath(`/admin/isletmeler/${tenantId}`, "layout");
  revalidatePath("/admin/abonelikler");
  return { ok: true, data: undefined, message };
}

export async function activateSubscriptionAction(tenantId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const c = await ctx(tenantId);
  const plan = planSchema.safeParse(str(fd, "plan"));
  const rawEnd = str(fd, "periodEnd");
  const periodEnd = rawEnd ? endOfDay(rawEnd) : null;
  if (!plan.success || (rawEnd && !periodEnd)) return { ok: false, error: "Paket ve geçerli bir dönem sonu seçin.", fieldErrors: { periodEnd: "Geçerli bir tarih girin (boş = süresiz)." } };
  return run(c.tenantId, () => activate(c.actor, c.tenantId, { plan: plan.data, periodEnd, internal: fd.get("internal") === "on" }), "Abonelik etkinleştirildi.");
}

export async function startTrialAction(tenantId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const c = await ctx(tenantId);
  const plan = planSchema.safeParse(str(fd, "plan"));
  const days = Number(str(fd, "days"));
  if (!plan.success || !Number.isInteger(days)) return { ok: false, error: "Paket ve gün sayısı girin." };
  return run(c.tenantId, () => startTrial(c.actor, c.tenantId, { plan: plan.data, days }), "Deneme başlatıldı.");
}

export async function extendTrialAction(tenantId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const c = await ctx(tenantId);
  const days = Number(str(fd, "days"));
  if (!Number.isInteger(days)) return { ok: false, error: "Gün sayısı girin." };
  return run(c.tenantId, () => extendTrial(c.actor, c.tenantId, days), "Deneme uzatıldı.");
}

export async function setPeriodEndAction(tenantId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const c = await ctx(tenantId);
  const end = endOfDay(str(fd, "periodEnd"));
  if (!end) return { ok: false, error: "Geçerli bir tarih girin.", fieldErrors: { periodEnd: "Geçerli bir tarih girin." } };
  return run(c.tenantId, () => setPeriodEnd(c.actor, c.tenantId, end), "Dönem sonu güncellendi.");
}

export async function scheduleCancelAction(tenantId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const c = await ctx(tenantId);
  const cancel = str(fd, "cancel") === "true";
  return run(c.tenantId, () => scheduleCancel(c.actor, c.tenantId, cancel), cancel ? "Dönem sonunda iptal planlandı." : "Planlı iptal kaldırıldı.");
}

const statusSchema = z.enum(["PAST_DUE", "SUSPENDED", "EXPIRED", "CANCELLED"]);
export async function setSubscriptionStatusAction(tenantId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const c = await ctx(tenantId);
  const status = statusSchema.safeParse(str(fd, "status"));
  if (!status.success) return { ok: false, error: "Geçersiz durum." };
  return run(c.tenantId, () => setStatus(c.actor, c.tenantId, status.data), "Abonelik durumu güncellendi.");
}

export async function setOverrideAction(tenantId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const c = await ctx(tenantId);
  const key = str(fd, "key");
  const reason = str(fd, "reason");
  const rawExp = str(fd, "expiresAt");
  const expiresAt = rawExp ? endOfDay(rawExp) : null;
  if (rawExp && !expiresAt) return { ok: false, error: "Geçerli bir bitiş tarihi girin." };
  if (!reason) return { ok: false, error: "Gerekçe zorunlu.", fieldErrors: { reason: "Gerekçe yazın." } };
  if (isFeature(key)) {
    const mode = str(fd, "mode");
    if (mode !== "enable" && mode !== "disable") return { ok: false, error: "Aç / kapa seçin." };
    return run(c.tenantId, () => setOverride(c.actor, c.tenantId, { key, enabled: mode === "enable", limitValue: null, expiresAt, reason }), "İstisna kaydedildi.");
  }
  if (isLimitKey(key)) {
    const raw = str(fd, "limitValue");
    const value = raw === "" || raw.toLowerCase() === "sınırsız" ? -1 : Number(raw);
    if (!Number.isInteger(value) || value < -1) return { ok: false, error: "Limit tam sayı olmalı (boş = sınırsız).", fieldErrors: { limitValue: "Tam sayı girin." } };
    return run(c.tenantId, () => setOverride(c.actor, c.tenantId, { key, enabled: null, limitValue: value, expiresAt, reason }), "Limit istisnası kaydedildi.");
  }
  return { ok: false, error: "Geçersiz anahtar." };
}

export async function removeOverrideAction(tenantId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const c = await ctx(tenantId);
  const key = str(fd, "key");
  if (!isFeature(key) && !isLimitKey(key)) return { ok: false, error: "Geçersiz anahtar." };
  return run(c.tenantId, () => removeOverride(c.actor, c.tenantId, key), "İstisna kaldırıldı.");
}

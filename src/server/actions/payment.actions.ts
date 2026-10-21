"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { parsePriceToMinor } from "@/lib/menu/money";
import type { Permission } from "@/lib/permissions/roles";
import { getRequestMeta } from "@/lib/security/request-meta";
import { featureDenied } from "@/server/billing/action-gate";
import { recordManualPayment, reconcilePayment, refundPayment, updatePaymentSettings, type PayFailure, type StaffActor } from "@/server/payments/payment.service";

/**
 * Personel ödeme eylemleri. Yetki: payments.manage (manuel ödeme), payments.refund (iade) — sahip / müdür / kasiyer;
 * garson / mutfak / bar ERİŞEMEZ. Ayarlar ve mutabakat: yalnızca sahip / müdür. Destek modu yazamaz (404).
 * Idempotency anahtarı form oluşturulurken sunucuda üretilir (gizli alan): çift gönderim tek kayıt.
 */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const cuid = z.string().regex(/^[a-z0-9]{20,40}$/);
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{16,80}$/);

async function actor(permission: Permission, adminOnly = false): Promise<StaffActor | null> {
  const ctx = await requireTenantUser({ permission, write: true });
  if (adminOnly && ctx.user.role !== "TENANT_OWNER" && ctx.user.role !== "BRANCH_MANAGER") return null;
  return { scope: ctx.scope, userId: ctx.user.id, meta: await getRequestMeta() };
}

const FAILURES: Record<PayFailure, string> = {
  feature_disabled: "Ödemeler mevcut paketinizde yok (PRO paketinde). Mevcut ödemelerin iadesi yapılabilir.",
  unavailable: "Ödeme altyapısı yapılandırılmamış.",
  disabled: "Bu ödeme yöntemi ayarlarda kapalı.",
  not_payable: "Sipariş bu durumda ödeme alamaz (kabul edilmiş, hazırlanıyor, hazır ya da servis edilmiş olmalı).",
  nothing_due: "Kalan bakiye yok (ya da süren bir online ödeme bakiyeyi ayırmış durumda).",
  amount_invalid: "Tutar geçersiz ya da kalan bakiyeyi aşıyor.",
  items_invalid: "Kalem seçimi geçersiz.",
  zero_amount: "Tutar sıfır olamaz.",
  idempotency_conflict: "Bu form zaten farklı bir tutarla gönderildi. Sayfayı yenileyin.",
  provider_unavailable: "Ödeme sağlayıcısına ulaşılamadı.",
  not_found: "Sipariş bulunamadı.",
};

const manualSchema = z.object({ method: z.enum(["CASH", "CARD_TERMINAL", "OTHER"]), key: keySchema });

export async function recordManualPaymentAction(orderId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const a = await actor("payments.manage");
  if (!a || !cuid.safeParse(orderId).success) return { ok: false, error: "Geçersiz istek." };
  const parsed = manualSchema.safeParse({ method: str(fd, "method"), key: str(fd, "key") });
  if (!parsed.success) return { ok: false, error: "Geçersiz istek." };
  const rawAmount = str(fd, "amount");
  const amount = rawAmount ? parsePriceToMinor(rawAmount) : null;
  if (rawAmount && (amount === null || amount < 1)) return { ok: false, error: "Tutar geçersiz (ör. 250 ya da 12,50).", fieldErrors: { amount: "Tutar geçersiz." } };
  const r = await recordManualPayment(a, { orderId, method: parsed.data.method, amountMinor: amount, idempotencyKey: parsed.data.key });
  if (!r.ok) return { ok: false, error: FAILURES[r.reason] };
  revalidatePath(`/panel/siparisler/${orderId}`);
  return { ok: true, data: undefined, message: r.replay ? "Bu ödeme zaten kaydedilmişti." : "Ödeme kaydedildi." };
}

export async function refundPaymentAction(paymentId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const a = await actor("payments.refund");
  if (!a || !cuid.safeParse(paymentId).success) return { ok: false, error: "Geçersiz istek." };
  const key = keySchema.safeParse(str(fd, "key"));
  const amount = parsePriceToMinor(str(fd, "amount"));
  if (!key.success) return { ok: false, error: "Geçersiz istek." };
  if (amount === null || amount < 1) return { ok: false, error: "İade tutarı geçersiz.", fieldErrors: { amount: "Tutar geçersiz." } };
  const reason = str(fd, "reason").slice(0, 200) || null;
  const r = await refundPayment(a, { paymentId, amountMinor: amount, reason, idempotencyKey: key.data });
  if (!r.ok) return { ok: false, error: r.reason === "over_limit" ? "İade tutarı iade edilebilir tutarı aşıyor." : r.reason === "not_found" ? "Ödeme bulunamadı." : "İade yapılamadı." };
  revalidatePath(`/panel/odemeler/${paymentId}`);
  if (r.status === "FAILED") return { ok: false, error: "Sağlayıcı iadeyi reddetti ya da ulaşılamadı. Kayıt 'Başarısız' olarak tutuldu; tekrar deneyebilirsiniz." };
  return { ok: true, data: undefined, message: r.replay ? "Bu iade zaten işlenmişti." : "İade tamamlandı." };
}

export async function reconcilePaymentAction(paymentId: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult | null> {
  void _fd;
  const a = await actor("payments.manage", true);
  if (!a || !cuid.safeParse(paymentId).success) return { ok: false, error: "Bu işlem için yetkiniz yok." };
  const r = await reconcilePayment(a, paymentId);
  if (!r) return { ok: false, error: "Ödeme bulunamadı." };
  revalidatePath(`/panel/odemeler/${paymentId}`);
  return { ok: true, data: undefined, message: `Mutabakat: yerel ${r.local} · sağlayıcı ${r.provider} → ${r.after ?? r.local}` };
}

const settingsSchema = z.object({ enabled: z.boolean(), allowOnline: z.boolean(), allowCash: z.boolean(), allowCardTerminal: z.boolean(), reservationMinutes: z.number().int().min(1, "1–120 dakika").max(120, "1–120 dakika") });

export async function savePaymentSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const a = await actor("payments.manage", true);
  if (!a) return { ok: false, error: "Ödeme ayarlarını yalnızca işletme sahibi ya da şube müdürü değiştirebilir." };
  const gate = await featureDenied(a.scope.tenantId, "restaurant_payments");
  if (gate) return gate;
  const parsed = settingsSchema.safeParse({
    enabled: fd.get("enabled") === "on",
    allowOnline: fd.get("allowOnline") === "on",
    allowCash: fd.get("allowCash") === "on",
    allowCardTerminal: fd.get("allowCardTerminal") === "on",
    reservationMinutes: Number(str(fd, "reservationMinutes") || "15"),
  });
  if (!parsed.success) return { ok: false, error: "Lütfen işaretli alanları düzeltin.", fieldErrors: { reservationMinutes: "1–120 dakika arasında olmalı." } };
  await updatePaymentSettings(a, parsed.data);
  revalidatePath("/panel/odemeler/ayarlar");
  return { ok: true, data: undefined, message: "Ödeme ayarları kaydedildi." };
}

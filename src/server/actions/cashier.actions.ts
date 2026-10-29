"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { getRequestMeta } from "@/lib/security/request-meta";
import { staffDisplayName } from "@/lib/service-requests/types";
import { featureDenied } from "@/server/billing/action-gate";
import { closeTableBill, markBillPrinted, type CashierActor } from "@/server/services/cashier/cashier.service";

/**
 * Kasa / adisyon ekranı eylemleri — payments.manage + yazma (kasiyer / sahip / müdür; destek modunda salt okunur),
 * Full paket (cashier_screen). Masa kimliği yalnızca kiracı kapsamında aranır.
 */
const id = z.string().regex(/^[a-z0-9]{20,40}$/);
const closeSchema = z.object({ tableId: id, method: z.enum(["CASH", "CARD_TERMINAL"]), key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

async function actor(): Promise<CashierActor> {
  const ctx = await requireTenantUser({ permission: "payments.manage", write: true });
  return { scope: ctx.scope, userId: ctx.user.id, displayName: staffDisplayName(ctx.user.firstName, ctx.user.lastName), meta: await getRequestMeta() };
}

export async function markBillPrintedAction(tableId: string): Promise<ActionResult> {
  const a = await actor();
  const gate = await featureDenied(a.scope.tenantId, "cashier_screen");
  if (gate) return gate;
  if (!id.safeParse(tableId).success) return { ok: false, error: "Geçersiz masa." };
  await markBillPrinted(a, tableId);
  revalidatePath("/panel/kasa");
  revalidatePath("/kasa");
  return { ok: true, data: undefined };
}

const FAILURES: Record<string, string> = {
  nothing_open: "Bu masada açık hesap yok.",
  partial: "Hesabın bir kısmı kaydedildi; kalan için tekrar deneyin.",
  disabled: "Bu ödeme yöntemi Ödemeler › Ayarlar'da kapalı.",
  feature_disabled: "Kasa kaydı paketinizde yok.",
  not_payable: "Siparişlerden biri ödeme alamıyor (iptal / onay bekliyor).",
  idempotency_conflict: "Bu işlem zaten yapıldı. Ekranı yenileyin.",
};

export async function closeTableBillAction(input: { tableId: string; method: "CASH" | "CARD_TERMINAL"; key: string }): Promise<ActionResult<{ paidMinor: number }>> {
  const a = await actor();
  const gate = await featureDenied(a.scope.tenantId, "cashier_screen");
  if (gate) return gate;
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Geçersiz istek." };
  const r = await closeTableBill(a, parsed.data);
  revalidatePath("/panel/kasa");
  revalidatePath("/kasa");
  if (!r.ok) return { ok: false, error: FAILURES[r.reason] ?? "Ödeme kaydedilemedi." };
  return { ok: true, data: { paidMinor: r.paidMinor } };
}

"use server";

import { prisma } from "@/lib/db/prisma";
import { calculateOrder } from "@/lib/orders/calculate";
import { previewPromotionSchema } from "@/lib/validation/orders";
import { getRequestMeta } from "@/lib/security/request-meta";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import { rateLimitAll } from "@/server/rate-limit";
import { readCustomerIdentity } from "@/server/crm/customer-session";
import { activeCustomerId } from "@/server/crm/customer.service";
import { loadOrderCatalog } from "@/server/services/orders/catalog.service";
import { resolvePromotion, rewardOptions, type PromotionFailure } from "@/server/promotions/resolve";
import { resolveEntitlements } from "@/server/billing/entitlements";

/**
 * QR sepet promosyon ÖNİZLEMESİ — bilgilendiricidir; kupon "yazınca" uygulanmaz, kullanım / puan TÜKETİLMEZ. Son karar
 * sipariş gönderiminde kilit altında verilir. Kiracı / şube / masa QR bağlamından; müşteri yalnızca bu tarayıcının
 * oturumundan. Hız sınırı masa + IP (kod tahmin denemesi sınırsız olamaz). Geçersiz kod yanıtı NÖTR: başka şube /
 * kiracı / arşiv ayrımı yapılmaz ("Kupon geçerli değil").
 */
export type PromotionPreview =
  | { kind: "ok"; label: string; subtotalMinor: number; discountMinor: number; totalMinor: number; freeItemName: string | null; pointsCost: number | null }
  | { kind: "invalid"; reason: PromotionFailure }
  | { kind: "rejected"; reason: "context_invalid" | "invalid" | "rate_limited" };

async function context(token: unknown) {
  if (typeof token !== "string") return null;
  const r = await getTableQrContext(token);
  if (!r.ok) return null;
  const c = r.context;
  const [settings, branch] = await Promise.all([
    prisma.tenantSettings.findUnique({ where: { tenantId: c.tenant.id }, select: { defaultLocale: true } }),
    prisma.branch.findFirst({ where: { id: c.branch.id, tenantId: c.tenant.id }, select: { id: true, active: true, timezone: true } }),
  ]);
  if (!branch) return null;
  const identity = await readCustomerIdentity(c.tenant.id);
  const customerId = identity ? await activeCustomerId(c.tenant.id, identity.customerId) : null;
  return { tenantId: c.tenant.id, tableId: c.table.id, branch, defaultLocale: settings?.defaultLocale ?? "tr", customerId };
}

export async function previewPromotionAction(token: string, payload: unknown): Promise<PromotionPreview> {
  const ctx = await context(token);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  const parsed = previewPromotionSchema.safeParse(payload);
  if (!parsed.success) return { kind: "rejected", reason: "invalid" };
  const ip = (await getRequestMeta()).ipAddress ?? "unknown";
  const limited = await rateLimitAll([
    ["promo.check.table", ctx.tableId],
    ["promo.check.ip", ip],
  ]);
  if (!limited.allowed) return { kind: "rejected", reason: "rate_limited" };
  const ent = await resolveEntitlements(ctx.tenantId);
  if (!ent.has("promotions") || (parsed.data.promotion.kind === "reward" && !ent.has("loyalty"))) return { kind: "invalid", reason: "feature_disabled" };
  const items = parsed.data.items.map((i) => ({ ...i, expectedUnitPriceMinor: null }));
  const catalog = await loadOrderCatalog(prisma, { tenantId: ctx.tenantId, branch: ctx.branch, productKeys: items.map((i) => i.product), locale: parsed.data.locale, defaultLocale: ctx.defaultLocale });
  const calc = calculateOrder(catalog, items);
  if (!calc.ok) return { kind: "rejected", reason: "invalid" };
  const r = await resolvePromotion(prisma, { tenantId: ctx.tenantId, branchId: ctx.branch.id, timeZone: ctx.branch.timezone, customerId: ctx.customerId, request: parsed.data.promotion, lines: calc.lines, subtotalMinor: calc.subtotalMinor });
  if (!r.ok) return { kind: "invalid", reason: r.reason };
  const p = r.promotion;
  return { kind: "ok", label: p.label, subtotalMinor: calc.subtotalMinor, discountMinor: p.discountMinor, totalMinor: calc.subtotalMinor - p.discountMinor, freeItemName: p.freeItemName, pointsCost: p.pointsCost };
}

/** Sepette "Puanlarını kullan": yalnızca tanınan + etkin sadakat üyesine; aksi halde null (anonim ödül yok). */
export async function promotionOptionsAction(token: string): Promise<{ balance: number; rewards: { id: string; name: string; description: string | null; pointsCost: number; affordable: boolean }[] } | null> {
  const ctx = await context(token);
  if (!ctx) return null;
  const ent = await resolveEntitlements(ctx.tenantId);
  if (!ent.has("promotions") || !ent.has("loyalty")) return null;
  return rewardOptions(ctx.tenantId, ctx.customerId);
}

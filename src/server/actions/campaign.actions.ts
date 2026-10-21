"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { normalizeCouponCode } from "@/lib/promotions/code";
import { daysMaskOf } from "@/lib/promotions/engine";
import { templateProblems } from "@/lib/promotions/template";
import { addDays, isValidDate, parseMinuteLabel, zonedLocalToUtc } from "@/lib/reservations/time";
import { getRequestMeta } from "@/lib/security/request-meta";
import { saveCampaign, saveCoupon, saveReward, setCampaignStatus, setCouponStatus, setRewardState, type AdminActor } from "@/server/promotions/admin.service";
import { featureDenied } from "@/server/billing/action-gate";

/**
 * Kampanya / kupon / ödül eylemleri — requireTenantUser({ permission: "campaigns.manage", write: true }): sahip / şube
 * müdürü; destek modu REDDEDİLİR (404). Garson / kasiyer / mutfak / bar erişemez. Kampanya ONAY VERMEZ ve GÖNDERMEZ.
 * Para "100" / "12,50" → kuruş; yüzde "10" / "12,5" → baz puan (tamsayı; kayan nokta yok).
 */
const BASE = "/panel/kampanyalar";
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const cuid = z.string().regex(/^[a-z0-9]{1,40}$/i);

async function actor(): Promise<AdminActor & { timeZone: string }> {
  const ctx = await requireTenantUser({ permission: "campaigns.manage", write: true });
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: ctx.scope.tenantId }, select: { timezone: true } });
  return { scope: ctx.scope, userId: ctx.user.id, meta: await getRequestMeta(), timeZone: settings?.timezone ?? "Europe/Istanbul" };
}

/** "123" / "123,45" / "123.45" → kuruş (tamsayı). Boş → null. Geçersiz → NaN. */
function parseMoneyMinor(raw: string): number | null {
  if (!raw) return null;
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(raw.replace(/\s/g, ""));
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
/** "10" / "12,5" / "12,25" → baz puan. */
function parseBps(raw: string): number | null {
  if (!raw) return null;
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(raw.replace(/\s/g, "").replace(/^%/, ""));
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
const optInt = (raw: string) => (raw ? (/^\d{1,7}$/.test(raw) ? Number(raw) : Number.NaN) : null);

function dateRange(fd: FormData, timeZone: string, errors: Record<string, string>) {
  const start = str(fd, "startDate");
  const end = str(fd, "endDate");
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (start) {
    const z0 = isValidDate(start) ? zonedLocalToUtc(start, 0, timeZone) : null;
    if (!z0 || z0.kind === "missing") errors.startDate = "Geçerli bir tarih girin.";
    else startsAt = z0.at;
  }
  if (end) {
    // Bitiş günü DAHİL: ertesi gün yerel 00:00'a kadar.
    const z1 = isValidDate(end) ? zonedLocalToUtc(addDays(end, 1), 0, timeZone) : null;
    if (!z1 || z1.kind === "missing") errors.endDate = "Geçerli bir tarih girin.";
    else endsAt = z1.at;
  }
  if (startsAt && endsAt && endsAt <= startsAt) errors.endDate = "Bitiş, başlangıçtan önce olamaz.";
  return { startsAt, endsAt };
}

function money(fd: FormData, key: string, errors: Record<string, string>, label: string, positive = false) {
  const v = parseMoneyMinor(str(fd, key));
  if (Number.isNaN(v) || (v !== null && (v < 0 || (positive && v === 0)))) {
    errors[key] = `${label} geçersiz (ör. 100 ya da 12,50).`;
    return null;
  }
  return v;
}

const typeSchema = z.enum(["FIXED_AMOUNT", "PERCENTAGE", "FREE_ITEM"]);

function promotionValue(fd: FormData, type: z.infer<typeof typeSchema>, errors: Record<string, string>) {
  const valueMinor = type === "FIXED_AMOUNT" ? money(fd, "value", errors, "İndirim tutarı", true) : null;
  if (type === "FIXED_AMOUNT" && valueMinor === null && !errors.value) errors.value = "İndirim tutarını girin.";
  let percentageBps: number | null = null;
  if (type === "PERCENTAGE") {
    percentageBps = parseBps(str(fd, "percent"));
    if (percentageBps === null || Number.isNaN(percentageBps) || percentageBps < 1 || percentageBps > 10_000) errors.percent = "Yüzde 0,01 ile 100 arasında olmalı.";
  }
  const freeProductId = type === "FREE_ITEM" ? str(fd, "freeProductId") || null : null;
  if (type === "FREE_ITEM" && (!freeProductId || !cuid.safeParse(freeProductId).success)) errors.freeProductId = "Ücretsiz ürünü seçin.";
  const maxDiscountMinor = type === "PERCENTAGE" ? money(fd, "maxDiscount", errors, "En fazla indirim", true) : null;
  const minimumOrderMinor = money(fd, "minimumOrder", errors, "En az sepet");
  return { valueMinor, percentageBps, freeProductId, maxDiscountMinor, minimumOrderMinor };
}

export async function saveCouponAction(id: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const a = await actor();
  const gate = await featureDenied(a.scope.tenantId, "promotions");
  if (gate) return gate;
  if (id !== null && !cuid.safeParse(id).success) return { ok: false, error: "Kupon bulunamadı." };
  const errors: Record<string, string> = {};
  const code = normalizeCouponCode(str(fd, "code"));
  if (!code) errors.code = "Kod 3–24 karakter: harf, rakam, - ya da _.";
  const name = str(fd, "name");
  if (name.length < 2 || name.length > 80) errors.name = "Ad 2–80 karakter olmalı.";
  const type = typeSchema.safeParse(str(fd, "type"));
  if (!type.success) return { ok: false, error: "Kupon türünü seçin.", fieldErrors: { type: "Seçin." } };
  const value = promotionValue(fd, type.data, errors);
  const scope = z.enum(["ALL", "PRODUCTS", "CATEGORIES"]).catch("ALL").parse(str(fd, "scope"));
  const productIds = fd.getAll("productIds").filter((v): v is string => typeof v === "string" && cuid.safeParse(v).success);
  const categoryIds = fd.getAll("categoryIds").filter((v): v is string => typeof v === "string" && cuid.safeParse(v).success);
  if (type.data !== "FREE_ITEM" && scope === "PRODUCTS" && !productIds.length) errors.productIds = "En az bir ürün seçin.";
  if (type.data !== "FREE_ITEM" && scope === "CATEGORIES" && !categoryIds.length) errors.categoryIds = "En az bir kategori seçin.";
  const branchId = str(fd, "branchId") || null;
  if (branchId && !cuid.safeParse(branchId).success) errors.branchId = "Geçersiz şube.";
  const { startsAt, endsAt } = dateRange(fd, a.timeZone, errors);
  const weekdays = fd.getAll("days").map(Number).filter((d) => d >= 1 && d <= 7);
  const startRaw = str(fd, "startTime");
  const endRaw = str(fd, "endTime");
  let startMinute: number | null = null;
  let endMinute: number | null = null;
  if (startRaw || endRaw) {
    startMinute = parseMinuteLabel(startRaw);
    endMinute = endRaw === "24:00" ? 1440 : parseMinuteLabel(endRaw);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) errors.endTime = "Saat penceresi SS:DD–SS:DD ve bitiş sonra olmalı.";
  }
  const usageLimit = optInt(str(fd, "usageLimit"));
  const perCustomerLimit = optInt(str(fd, "perCustomerLimit"));
  if (Number.isNaN(usageLimit) || usageLimit === 0) errors.usageLimit = "Pozitif tam sayı girin.";
  if (Number.isNaN(perCustomerLimit) || perCustomerLimit === 0) errors.perCustomerLimit = "Pozitif tam sayı girin.";
  const audience = z.enum(["ANYONE", "IDENTIFIED", "LOYALTY_MEMBER", "REPEAT_CUSTOMER"]).catch("ANYONE").parse(str(fd, "audience"));
  const description = str(fd, "description").slice(0, 300) || null;
  if (Object.keys(errors).length) return { ok: false, error: "Lütfen işaretli alanları düzeltin.", fieldErrors: errors };

  const r = await saveCoupon(a, id, {
    code: code!,
    codeNormalized: code!,
    name,
    description,
    type: type.data,
    ...value,
    scope: type.data === "FREE_ITEM" ? "ALL" : scope,
    productIds: scope === "PRODUCTS" ? productIds : [],
    categoryIds: scope === "CATEGORIES" ? categoryIds : [],
    branchId,
    startsAt,
    endsAt,
    daysMask: daysMaskOf(weekdays),
    startMinute,
    endMinute,
    usageLimit,
    perCustomerLimit,
    audience,
    status: fd.get("active") === "on" ? "ACTIVE" : "INACTIVE",
  });
  if (!r.ok) return { ok: false, error: r.reason === "duplicate" ? "Bu kod zaten kullanılıyor." : r.reason === "invalid_refs" ? "Seçilen şube / ürün / kategori bulunamadı." : "Kupon bulunamadı.", ...(r.reason === "duplicate" ? { fieldErrors: { code: "Bu kod zaten kullanılıyor." } } : {}) };
  revalidatePath(BASE, "layout");
  if (!id) redirect(`${BASE}/kuponlar`);
  return { ok: true, data: undefined, message: "Kupon kaydedildi." };
}

export async function couponStatusAction(id: string, status: string): Promise<ActionResult> {
  const a = await actor();
  const gate = await featureDenied(a.scope.tenantId, "promotions");
  if (gate) return gate;
  const s = z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).safeParse(status);
  if (!cuid.safeParse(id).success || !s.success || !(await setCouponStatus(a, id, s.data))) return { ok: false, error: "Kupon bulunamadı." };
  revalidatePath(BASE, "layout");
  return { ok: true, data: undefined, message: s.data === "ACTIVE" ? "Kupon etkinleştirildi." : s.data === "ARCHIVED" ? "Kupon arşivlendi." : "Kupon durduruldu." };
}

export async function saveRewardAction(id: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const a = await actor();
  const gate = await featureDenied(a.scope.tenantId, "promotions");
  if (gate) return gate;
  if (id !== null && !cuid.safeParse(id).success) return { ok: false, error: "Ödül bulunamadı." };
  const errors: Record<string, string> = {};
  const name = str(fd, "name");
  if (name.length < 2 || name.length > 80) errors.name = "Ad 2–80 karakter olmalı.";
  const pointsCost = optInt(str(fd, "pointsCost"));
  if (pointsCost === null || Number.isNaN(pointsCost) || pointsCost < 1) errors.pointsCost = "Puan bedeli pozitif tam sayı olmalı.";
  const type = typeSchema.safeParse(str(fd, "type"));
  if (!type.success) return { ok: false, error: "Ödül türünü seçin.", fieldErrors: { type: "Seçin." } };
  const value = promotionValue(fd, type.data, errors);
  const { startsAt, endsAt } = dateRange(fd, a.timeZone, errors);
  if (Object.keys(errors).length) return { ok: false, error: "Lütfen işaretli alanları düzeltin.", fieldErrors: errors };
  const r = await saveReward(a, id, {
    name,
    description: str(fd, "description").slice(0, 300) || null,
    pointsCost: pointsCost!,
    rewardType: type.data,
    fixedDiscountMinor: value.valueMinor,
    percentageBps: value.percentageBps,
    maxDiscountMinor: value.maxDiscountMinor,
    minimumOrderMinor: value.minimumOrderMinor,
    freeProductId: value.freeProductId,
    isActive: fd.get("active") === "on",
    startsAt,
    endsAt,
  });
  if (!r.ok) return { ok: false, error: r.reason === "invalid_refs" ? "Seçilen ürün bulunamadı." : "Ödül bulunamadı." };
  revalidatePath(BASE, "layout");
  if (!id) redirect(`${BASE}/oduller`);
  return { ok: true, data: undefined, message: "Ödül kaydedildi." };
}

export async function rewardStateAction(id: string, state: string): Promise<ActionResult> {
  const a = await actor();
  const gate = await featureDenied(a.scope.tenantId, "promotions");
  if (gate) return gate;
  const s = z.enum(["active", "inactive", "archived"]).safeParse(state);
  if (!cuid.safeParse(id).success || !s.success || !(await setRewardState(a, id, s.data))) return { ok: false, error: "Ödül bulunamadı." };
  revalidatePath(BASE, "layout");
  return { ok: true, data: undefined, message: s.data === "active" ? "Ödül etkinleştirildi." : s.data === "archived" ? "Ödül arşivlendi." : "Ödül durduruldu." };
}

const campaignSchema = z.object({
  name: z.string().trim().min(2, "Ad 2–80 karakter.").max(80, "Ad 2–80 karakter."),
  channel: z.enum(["EMAIL", "SMS", "WHATSAPP"], { message: "Kanal seçin." }),
  segment: z.enum(["ALL_OPTED_IN", "LOYALTY_MEMBERS", "REPEAT_CUSTOMERS", "NO_VISIT_30_DAYS", "HIGH_ORDER_COUNT", "LANGUAGE_TR", "LANGUAGE_EN"], { message: "Segment seçin." }),
  couponId: z.union([z.literal(""), cuid]),
  messageTemplate: z.string().max(1000, "En fazla 1000 karakter.").superRefine((v, ctx) => {
    for (const p of templateProblems(v)) ctx.addIssue({ code: "custom", message: p });
  }),
});

export async function saveCampaignAction(id: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const a = await actor();
  const gate = await featureDenied(a.scope.tenantId, "promotions");
  if (gate) return gate;
  if (id !== null && !cuid.safeParse(id).success) return { ok: false, error: "Kampanya bulunamadı." };
  const parsed = campaignSchema.safeParse({ name: str(fd, "name"), channel: str(fd, "channel"), segment: str(fd, "segment"), couponId: str(fd, "couponId"), messageTemplate: str(fd, "messageTemplate") });
  if (!parsed.success) return invalid(parsed.error);
  const r = await saveCampaign(a, id, { ...parsed.data, couponId: parsed.data.couponId || null });
  if (!r.ok) return { ok: false, error: r.reason === "invalid_refs" ? "Seçilen kupon bulunamadı." : "Kampanya bulunamadı." };
  revalidatePath(BASE, "layout");
  if (!id) redirect(`${BASE}/${r.id}`);
  return { ok: true, data: undefined, message: "Kampanya taslağı kaydedildi." };
}

export async function campaignStatusAction(id: string, status: string): Promise<ActionResult> {
  const a = await actor();
  const gate = await featureDenied(a.scope.tenantId, "promotions");
  if (gate) return gate;
  const s = z.enum(["READY", "DRAFT", "ARCHIVED"]).safeParse(status);
  if (!cuid.safeParse(id).success || !s.success || !(await setCampaignStatus(a, id, s.data))) return { ok: false, error: "Kampanya bulunamadı." };
  revalidatePath(BASE, "layout");
  return { ok: true, data: undefined, message: s.data === "READY" ? "Kampanya hazır olarak işaretlendi (gönderim yok)." : s.data === "ARCHIVED" ? "Kampanya arşivlendi." : "Kampanya taslağa alındı." };
}

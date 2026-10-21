"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invalid, type ActionResult } from "@/lib/action-result";
import { requireTenantUser } from "@/lib/auth/guards";
import { normalizeEmail, normalizePhone } from "@/lib/crm/contact";
import { hasPermission } from "@/lib/permissions/roles";
import { SLOT_INTERVALS } from "@/lib/reservations/rules";
import { RESERVATION_STATUS_LABELS, type ReservationStatusName } from "@/lib/reservations/status";
import { isValidDate, parseMinuteLabel, zonedLocalToUtc } from "@/lib/reservations/time";
import { getRequestMeta } from "@/lib/security/request-meta";
import { prisma } from "@/lib/db/prisma";
import { BOOKING_ERRORS } from "@/lib/reservations/messages";
import { createReservation, reassignTables, transitionReservation, updateInternalNote, type StaffActor } from "@/server/reservations/booking.service";
import { addBlackout, createCombination, deleteBlackout, deleteCombination, savePolicy, setOpeningHours } from "@/server/reservations/settings.service";
import { featureDenied } from "@/server/billing/action-gate";

/**
 * Rezervasyon panel eylemleri — requireTenantUser({ permission, write: true }): destek modu REDDEDİLİR (404).
 *   reservations.manage   → oluşturma, walk-in, durum geçişleri, not (sahip, müdür, garson)
 *   reservations.override → masa değiştirme + kural aşma (sahip, müdür)
 *   reservations.settings → kurallar, saatler, kapalı dönemler, birleşimler (sahip, müdür)
 * Kiracı oturumdan; formdaki şube / masa / rezervasyon kimlikleri yalnızca KİRACI İÇİNDE aranır.
 */
const PATH = "/panel/rezervasyonlar";
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const cuid = z.string().trim().min(1).max(40).regex(/^[a-z0-9]+$/i);

async function staff(permission: "reservations.manage" | "reservations.override" | "reservations.settings"): Promise<StaffActor> {
  const ctx = await requireTenantUser({ permission, write: true });
  return { scope: ctx.scope, userId: ctx.user.id, meta: await getRequestMeta(), canOverride: hasPermission(ctx.user.role, "reservations.override") };
}


const createSchema = z
  .object({
    branchId: cuid,
    date: z.string().refine(isValidDate, "Geçerli bir tarih seçin."),
    time: z.string().refine((v) => parseMinuteLabel(v) !== null, "Saat SS:DD biçiminde olmalı."),
    party: z.coerce.number({ message: "Kişi sayısı girin." }).int().min(1, "En az 1 kişi.").max(100, "En fazla 100 kişi."),
    duration: z.union([z.literal(""), z.coerce.number().int().min(15).max(720)]),
    name: z.string().trim().min(2, "Ad girin.").max(80),
    phone: z.string().trim().max(32),
    email: z.string().trim().max(254),
    area: z.string().max(40),
    request: z.string().trim().max(300, "En fazla 300 karakter."),
    note: z.string().trim().max(500, "En fazla 500 karakter."),
    source: z.enum(["STAFF", "PHONE", "OTHER"]),
    override: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.phone && !normalizePhone(v.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "Geçerli bir telefon girin." });
    if (v.email && !normalizeEmail(v.email)) ctx.addIssue({ code: "custom", path: ["email"], message: "Geçerli bir e-posta girin." });
  });

export async function createStaffReservationAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const actor = await staff("reservations.manage");
  const gate = await featureDenied(actor.scope.tenantId, "reservations");
  if (gate) return gate;
  const parsed = createSchema.safeParse({
    branchId: str(fd, "branchId"),
    date: str(fd, "date"),
    time: str(fd, "time"),
    party: str(fd, "party"),
    duration: str(fd, "duration"),
    name: str(fd, "name"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    area: str(fd, "area"),
    request: str(fd, "request"),
    note: str(fd, "note"),
    source: str(fd, "source") || "STAFF",
    override: fd.get("override") === "on",
  });
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;
  const branch = await prisma.branch.findFirst({ where: { id: d.branchId, tenantId: actor.scope.tenantId }, select: { timezone: true } });
  if (!branch) return { ok: false, error: "Şube bulunamadı." };
  const zoned = zonedLocalToUtc(d.date, parseMinuteLabel(d.time)!, branch.timezone);
  if (zoned.kind === "missing") return { ok: false, error: "Bu yerel saat yaz saati geçişi nedeniyle yok. Başka bir saat seçin.", fieldErrors: { time: "Bu saat yok (yaz saati geçişi)." } };
  if (d.override && !actor.canOverride) return { ok: false, error: "Kural aşma yalnızca sahip / müdür içindir." };
  const r = await createReservation(
    actor.scope.tenantId,
    {
      branchId: d.branchId,
      startsAt: zoned.at,
      partySize: d.party,
      durationMinutes: d.duration === "" ? null : d.duration,
      guestName: d.name,
      guestPhone: normalizePhone(d.phone),
      guestEmail: normalizeEmail(d.email),
      preferredAreaId: d.area || null,
      specialRequest: d.request || null,
      internalNote: d.note || null,
      source: d.source,
      customerId: null,
      locale: "tr",
    },
    actor,
    { override: d.override },
  );
  if (!r.ok) return { ok: false, error: BOOKING_ERRORS[r.reason] };
  revalidatePath(PATH, "layout");
  redirect(`${PATH}/${r.reservation.id}`);
}

const walkInSchema = z.object({
  branchId: cuid,
  party: z.coerce.number({ message: "Kişi sayısı girin." }).int().min(1, "En az 1 kişi.").max(100),
  name: z.string().trim().max(80),
  area: z.string().max(40),
});

export async function walkInAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const actor = await staff("reservations.manage");
  const gate = await featureDenied(actor.scope.tenantId, "reservations");
  if (gate) return gate;
  const parsed = walkInSchema.safeParse({ branchId: str(fd, "branchId"), party: str(fd, "party"), name: str(fd, "name"), area: str(fd, "area") });
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;
  const now = new Date();
  const r = await createReservation(
    actor.scope.tenantId,
    { branchId: d.branchId, startsAt: new Date(Math.floor(now.getTime() / 60_000) * 60_000), partySize: d.party, guestName: d.name || "Walk-in", guestPhone: null, guestEmail: null, preferredAreaId: d.area || null, specialRequest: null, source: "WALK_IN", customerId: null, locale: "tr", walkIn: true },
    actor,
    { now },
  );
  if (!r.ok) return { ok: false, error: r.reason === "no_table" ? "Şu an bu kişi sayısına uygun boş masa yok." : BOOKING_ERRORS[r.reason] };
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: `Walk-in masaya alındı: ${r.reservation.tableNames.join(" + ")}.` };
}

const statusSchema = z.enum(["CONFIRMED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"]);
const TRANSITION_ERRORS = { not_found: "Rezervasyon bulunamadı.", invalid_transition: "Bu durumdan bu işlem yapılamaz.", too_early: "“Gelmedi” yalnızca rezervasyon saati ve bekleme payı geçtikten sonra işaretlenebilir.", conflict: "Rezervasyon bu sırada güncellendi. Sayfayı yenileyin.", cutoff: "İptal süresi geçti." } as const;

export async function reservationStatusAction(id: string, to: string): Promise<ActionResult> {
  const actor = await staff("reservations.manage");
  const target = statusSchema.safeParse(to);
  if (!cuid.safeParse(id).success || !target.success) return { ok: false, error: "Geçersiz istek." };
  const r = await transitionReservation(actor, id, target.data);
  if (!r.ok) return { ok: false, error: TRANSITION_ERRORS[r.reason] };
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: `Durum: ${RESERVATION_STATUS_LABELS[target.data as ReservationStatusName]}.` };
}

export async function reassignTablesAction(id: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const actor = await staff("reservations.override");
  if (!cuid.safeParse(id).success) return { ok: false, error: "Rezervasyon bulunamadı." };
  const raw = str(fd, "tables");
  const tableIds = raw ? raw.split(",").filter(Boolean) : [];
  if (tableIds.some((t) => !cuid.safeParse(t).success) || tableIds.length > 6) return { ok: false, error: "Geçersiz masa seçimi." };
  const r = await reassignTables(actor, id, tableIds.length ? tableIds : null, { override: fd.get("override") === "on" });
  if (!r.ok) return { ok: false, error: { not_found: "Rezervasyon bulunamadı.", not_active: "Yalnızca etkin rezervasyonun masası değiştirilebilir.", no_table: "Seçilen masa bu saatte dolu.", tables_invalid: "Seçilen masa(lar) kapasite / kullanım açısından uygun değil." }[r.reason] };
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: `Masa atandı: ${r.tableNames.join(" + ")}.` };
}

export async function reservationNoteAction(id: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const actor = await staff("reservations.manage");
  const note = str(fd, "note").trim();
  if (!cuid.safeParse(id).success) return { ok: false, error: "Rezervasyon bulunamadı." };
  if (note.length > 500) return { ok: false, error: "Not en fazla 500 karakter.", fieldErrors: { note: "En fazla 500 karakter." } };
  if (!(await updateInternalNote(actor, id, note || null))) return { ok: false, error: "Rezervasyon bulunamadı." };
  revalidatePath(`${PATH}/${id}`);
  return { ok: true, data: undefined, message: "Not kaydedildi." };
}

// ─── Ayarlar ────────────────────────────────────────────────────────────────

const int = (min: number, max: number, label: string) => z.coerce.number({ message: `${label} girin.` }).int(`${label} tam sayı olmalı.`).min(min, `${label} en az ${min}.`).max(max, `${label} en fazla ${max}.`);
const policySchema = z
  .object({
    enabled: z.boolean(),
    publicBookingEnabled: z.boolean(),
    autoConfirm: z.boolean(),
    defaultDurationMinutes: int(15, 720, "Süre"),
    slotIntervalMinutes: z.coerce.number().refine((v) => (SLOT_INTERVALS as readonly number[]).includes(v), "Geçerli bir aralık seçin."),
    minAdvanceMinutes: int(0, 10080, "En erken süre"),
    maxAdvanceDays: int(1, 365, "En ileri gün"),
    minPartySize: int(1, 100, "En az kişi"),
    maxPartySize: int(1, 100, "En çok kişi"),
    bufferMinutes: int(0, 240, "Temizlik payı"),
    cancellationCutoffMinutes: int(0, 10080, "İptal sınırı"),
    noShowGraceMinutes: int(0, 240, "Bekleme payı"),
  })
  .refine((v) => v.maxPartySize >= v.minPartySize, { path: ["maxPartySize"], message: "En çok kişi, en azdan küçük olamaz." });

export async function saveReservationSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const actor = await staff("reservations.settings");
  const gate = await featureDenied(actor.scope.tenantId, "reservations");
  if (gate) return gate;
  const parsed = policySchema.safeParse({
    enabled: fd.get("enabled") === "on",
    publicBookingEnabled: fd.get("publicBookingEnabled") === "on",
    autoConfirm: fd.get("autoConfirm") === "on",
    defaultDurationMinutes: str(fd, "defaultDurationMinutes"),
    slotIntervalMinutes: str(fd, "slotIntervalMinutes"),
    minAdvanceMinutes: str(fd, "minAdvanceMinutes"),
    maxAdvanceDays: str(fd, "maxAdvanceDays"),
    minPartySize: str(fd, "minPartySize"),
    maxPartySize: str(fd, "maxPartySize"),
    bufferMinutes: str(fd, "bufferMinutes"),
    cancellationCutoffMinutes: str(fd, "cancellationCutoffMinutes"),
    noShowGraceMinutes: str(fd, "noShowGraceMinutes"),
  });
  if (!parsed.success) return invalid(parsed.error);
  await savePolicy(actor, { ...parsed.data, slotIntervalMinutes: Number(parsed.data.slotIntervalMinutes) });
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: "Rezervasyon ayarları kaydedildi." };
}

/** Haftalık saatler: her gün için "SS:DD-SS:DD" aralıkları (virgülle en fazla 3) ya da boş (kapalı). */
export async function saveOpeningHoursAction(branchId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const actor = await staff("reservations.settings");
  const gate = await featureDenied(actor.scope.tenantId, "reservations");
  if (gate) return gate;
  if (!cuid.safeParse(branchId).success) return { ok: false, error: "Şube bulunamadı." };
  const fieldErrors: Record<string, string> = {};
  const days: { weekday: number; intervals: { opensMinute: number; closesMinute: number }[] }[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const raw = str(fd, `day${weekday}`).replace(/\s+/g, "");
    const intervals: { opensMinute: number; closesMinute: number }[] = [];
    for (const part of raw ? raw.split(",") : []) {
      const [a, b] = part.split("-");
      const opens = parseMinuteLabel(a ?? "");
      const closes = b === "24:00" ? 1440 : parseMinuteLabel(b ?? "");
      if (opens === null || closes === null || closes <= opens) fieldErrors[`day${weekday}`] = "Biçim: 12:00-23:00 (gece yarısını geçen saat desteklenmez).";
      else intervals.push({ opensMinute: opens, closesMinute: closes });
    }
    intervals.sort((x, y) => x.opensMinute - y.opensMinute);
    if (intervals.length > 3 || intervals.some((x, i) => i > 0 && x.opensMinute < intervals[i - 1]!.closesMinute)) fieldErrors[`day${weekday}`] = "En fazla 3 çakışmasız aralık.";
    days.push({ weekday, intervals });
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Lütfen işaretli günleri düzeltin.", fieldErrors };
  if (!(await setOpeningHours(actor, branchId, days))) return { ok: false, error: "Şube bulunamadı." };
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: "Açılış saatleri kaydedildi." };
}

export async function addBlackoutAction(branchId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const actor = await staff("reservations.settings");
  const gate = await featureDenied(actor.scope.tenantId, "reservations");
  if (gate) return gate;
  const branch = cuid.safeParse(branchId).success ? await prisma.branch.findFirst({ where: { id: branchId, tenantId: actor.scope.tenantId }, select: { timezone: true } }) : null;
  if (!branch) return { ok: false, error: "Şube bulunamadı." };
  const date = str(fd, "date");
  const endDate = str(fd, "endDate") || date;
  const from = parseMinuteLabel(str(fd, "from") || "00:00");
  const toRaw = str(fd, "to") || "24:00";
  const to = toRaw === "24:00" ? 1440 : parseMinuteLabel(toRaw);
  if (!isValidDate(date) || !isValidDate(endDate) || from === null || to === null) return { ok: false, error: "Tarih / saat geçersiz.", fieldErrors: { date: "Tarih ve saatleri kontrol edin." } };
  const start = zonedLocalToUtc(date, from, branch.timezone);
  const end = to === 1440 ? zonedLocalToUtc(endDate, 0, branch.timezone) : zonedLocalToUtc(endDate, to, branch.timezone);
  if (start.kind === "missing" || end.kind === "missing") return { ok: false, error: "Bu yerel saat yaz saati geçişi nedeniyle yok." };
  const endsAt = to === 1440 ? new Date(end.at.getTime() + 86_400_000) : end.at;
  if (endsAt <= start.at) return { ok: false, error: "Bitiş başlangıçtan sonra olmalı.", fieldErrors: { endDate: "Bitiş başlangıçtan sonra olmalı." } };
  const reason = str(fd, "reason").trim().slice(0, 120) || null;
  if (!(await addBlackout(actor, branchId, { startsAt: start.at, endsAt, reason }))) return { ok: false, error: "Şube bulunamadı." };
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: "Kapalı dönem eklendi." };
}

export async function deleteBlackoutAction(id: string): Promise<ActionResult> {
  const actor = await staff("reservations.settings");
  if (!cuid.safeParse(id).success || !(await deleteBlackout(actor, id))) return { ok: false, error: "Kayıt bulunamadı." };
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: "Kapalı dönem kaldırıldı." };
}

export async function createCombinationAction(branchId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult | null> {
  const actor = await staff("reservations.settings");
  const gate = await featureDenied(actor.scope.tenantId, "reservations");
  if (gate) return gate;
  const name = str(fd, "name").trim();
  const tables = fd.getAll("tables").filter((v): v is string => typeof v === "string");
  if (!cuid.safeParse(branchId).success || name.length < 2 || name.length > 60) return { ok: false, error: "Birleşim adı 2–60 karakter olmalı.", fieldErrors: { name: "2–60 karakter." } };
  if (tables.some((t) => !cuid.safeParse(t).success)) return { ok: false, error: "Geçersiz masa seçimi." };
  const r = await createCombination(actor, branchId, name, tables);
  if (r !== "ok") return { ok: false, error: r === "duplicate" ? "Bu adla bir birleşim zaten var." : "Aynı şubeden 2–6 masa seçin." };
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: "Masa birleşimi eklendi." };
}

export async function deleteCombinationAction(id: string): Promise<ActionResult> {
  const actor = await staff("reservations.settings");
  if (!cuid.safeParse(id).success || !(await deleteCombination(actor, id))) return { ok: false, error: "Kayıt bulunamadı." };
  revalidatePath(PATH, "layout");
  return { ok: true, data: undefined, message: "Birleşim kaldırıldı." };
}

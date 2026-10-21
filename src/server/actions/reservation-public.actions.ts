"use server";

import { z } from "zod";
import { normalizeEmail, normalizePhone } from "@/lib/crm/contact";
import { reservationRequestHash } from "@/lib/reservations/rules";
import { parseMinuteLabel, isValidDate, zonedLocalToUtc } from "@/lib/reservations/time";
import { getRequestMeta } from "@/lib/security/request-meta";
import { getTenantContext } from "@/lib/tenant/tenant-context";
import { rateLimit, rateLimitAll } from "@/server/rate-limit";
import { readCustomerIdentity } from "@/server/crm/customer-session";
import { activeCustomerId } from "@/server/crm/customer.service";
import { dayAvailability, type AvailabilityResult, type SlotView } from "@/server/reservations/availability.service";
import { cancelByManageToken, createReservation } from "@/server/reservations/booking.service";
import { listReservableBranches } from "@/server/reservations/context";

/**
 * Public rezervasyon eylemleri — kiracı alan adı; hesap gerekmez.
 *
 * Güven modeli: kiracı YALNIZCA istek host'undan (TenantDomain), şube SLUG ile kiracı içinde çözülür. Tarayıcının
 * gönderdiği kiracı / şube kimliği / masa kimliği / bitiş saati kullanılmaz: başlangıç anı, yerel tarih + saatten şube
 * saat diliminde SUNUCUDA yeniden hesaplanır, masa motor tarafından atanır. Rezervasyon iletişimi operasyoneldir —
 * pazarlama onayı DEĞİLDİR ve CRM profili OLUŞTURMAZ (yalnızca bu tarayıcıda zaten tanınan müşteri bağlanır).
 */
async function tenantId(): Promise<string | null> {
  const ctx = await getTenantContext();
  return ctx.kind === "tenant" ? ctx.tenant.id : null;
}
async function ip(): Promise<string> {
  return (await getRequestMeta()).ipAddress ?? "unknown";
}
async function branchBySlug(tenant: string, slug: unknown) {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  return (await listReservableBranches(tenant)).find((b) => b.slug === slug) ?? null;
}

const availabilitySchema = z.object({ branch: z.string().max(60), date: z.string().max(10), party: z.coerce.number().int().min(1).max(100) });

export async function reservationAvailabilityAction(payload: unknown): Promise<AvailabilityResult | { kind: "rate_limited" }> {
  const tenant = await tenantId();
  if (!tenant) return { kind: "invalid" };
  const parsed = availabilitySchema.safeParse(payload);
  if (!parsed.success) return { kind: "invalid" };
  if (!(await rateLimit("res.availability.ip", await ip())).allowed) return { kind: "rate_limited" };
  const branch = await branchBySlug(tenant, parsed.data.branch);
  if (!branch) return { kind: "invalid" };
  return dayAvailability(tenant, { branchId: branch.id, date: parsed.data.date, partySize: parsed.data.party, channel: "public" });
}

const bookSchema = z.object({
  branch: z.string().max(60),
  date: z.string().max(10),
  time: z.string().max(5),
  party: z.coerce.number().int().min(1).max(100),
  area: z.string().max(40).nullish(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(32),
  email: z.string().trim().max(254).nullish(),
  request: z.string().trim().max(300).nullish(),
  /** Bal tuzağı: insanlar görmez; doluysa bot kabul edilir. */
  website: z.string().max(200).nullish(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  locale: z.enum(["tr", "en", "de", "ar"]).default("tr"),
});

export type BookResult =
  | { kind: "created"; status: "PENDING" | "CONFIRMED"; manageUrl: string; startsAt: string; partySize: number; branchName: string }
  | { kind: "taken"; alternatives: SlotView[] }
  | { kind: "party_too_large"; maxOnline: number }
  | { kind: "rejected"; reason: "invalid" | "rate_limited" | "disabled" | "closed" | "too_soon" | "too_far" | "conflict" };

/** HTML olarak işlenmez; yine de denetim karakterleri temizlenir. */
const clean = (v: string | null | undefined) => (v ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim() || null : null);

export async function createPublicReservationAction(payload: unknown): Promise<BookResult> {
  const tenant = await tenantId();
  if (!tenant) return { kind: "rejected", reason: "invalid" };
  const parsed = bookSchema.safeParse(payload);
  if (!parsed.success) return { kind: "rejected", reason: "invalid" };
  const d = parsed.data;
  if (d.website) return { kind: "rejected", reason: "invalid" };
  const phone = normalizePhone(d.phone);
  const email = d.email ? normalizeEmail(d.email) : null;
  if (!phone || (d.email && !email) || !isValidDate(d.date)) return { kind: "rejected", reason: "invalid" };
  const minute = parseMinuteLabel(d.time);
  const branch = await branchBySlug(tenant, d.branch);
  if (minute === null || !branch) return { kind: "rejected", reason: "invalid" };

  const address = await ip();
  const limited = await rateLimitAll([
    ["res.book.ip", address],
    ["res.book.contact", `${tenant}|${phone}`],
    ["res.book.branch", branch.id],
  ]);
  if (!limited.allowed) return { kind: "rejected", reason: "rate_limited" };

  const zoned = zonedLocalToUtc(d.date, minute, branch.timezone);
  if (zoned.kind === "missing") return { kind: "rejected", reason: "invalid" };
  const identity = await readCustomerIdentity(tenant);
  const customerId = identity ? await activeCustomerId(tenant, identity.customerId) : null;
  const guestName = clean(d.name)!;
  const request = clean(d.request);
  const areaId = d.area || null;
  const requestHash = reservationRequestHash({ branchId: branch.id, startsAt: zoned.at.toISOString(), partySize: d.party, guestName, phone, email, areaId, request });

  const result = await createReservation(tenant, {
    branchId: branch.id,
    startsAt: zoned.at,
    partySize: d.party,
    guestName,
    guestPhone: phone,
    guestEmail: email,
    preferredAreaId: areaId,
    specialRequest: request,
    source: "PUBLIC_WEB",
    customerId,
    locale: d.locale,
    idempotencyKey: d.idempotencyKey,
    requestHash,
  }, null);

  if (result.ok) {
    return { kind: "created", status: result.reservation.status === "PENDING" ? "PENDING" : "CONFIRMED", manageUrl: `/rezervasyon/y/${result.manageToken}`, startsAt: result.reservation.startsAt.toISOString(), partySize: d.party, branchName: branch.name };
  }
  switch (result.reason) {
    case "no_table": {
      // Yakın saatler: aynı gün GERÇEKTEN müsait olanlar, istenen saate en yakın 4 tanesi.
      const day = await dayAvailability(tenant, { branchId: branch.id, date: d.date, partySize: d.party, channel: "public" });
      const target = zoned.at.getTime();
      const alternatives = day.kind === "ok" ? [...day.slots].sort((a, b) => Math.abs(Date.parse(a.startsAt) - target) - Math.abs(Date.parse(b.startsAt) - target)).slice(0, 4).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : [];
      return { kind: "taken", alternatives };
    }
    case "party_too_large":
      return { kind: "party_too_large", maxOnline: result.maxSeatable ?? 0 };
    case "disabled":
    case "closed":
    case "too_soon":
    case "too_far":
      return { kind: "rejected", reason: result.reason };
    case "blackout":
      return { kind: "rejected", reason: "closed" };
    case "idempotency_conflict":
      return { kind: "rejected", reason: "conflict" };
    default:
      return { kind: "rejected", reason: "invalid" };
  }
}

export async function cancelReservationByTokenAction(token: unknown): Promise<{ ok: true } | { ok: false; reason: "not_found" | "cutoff" | "rate_limited" | "invalid" }> {
  const tenant = await tenantId();
  if (!tenant) return { ok: false, reason: "not_found" };
  if (!(await rateLimit("res.manage.ip", await ip())).allowed) return { ok: false, reason: "rate_limited" };
  const r = await cancelByManageToken(tenant, token);
  if (r.ok) return { ok: true };
  return { ok: false, reason: r.reason === "cutoff" ? "cutoff" : r.reason === "not_found" ? "not_found" : "invalid" };
}

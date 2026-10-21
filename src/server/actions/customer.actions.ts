"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cleanName, normalizeEmail, normalizePhone } from "@/lib/crm/contact";
import type { ConsentKind } from "@/lib/crm/consent";
import { getRequestMeta } from "@/lib/security/request-meta";
import { getTableQrContext } from "@/lib/tenant/table-qr-context";
import { rateLimit, rateLimitAll } from "@/server/rate-limit";
import { endCustomerSession, readCustomerIdentity, startCustomerSession } from "@/server/crm/customer-session";
import { allowedConsents, joinCustomer, requestOwnDeletion, updateOwnConsents, updateOwnName, type ContactInput } from "@/server/crm/customer.service";
import { consumeVerification, startVerification, verificationAvailable, type PendingJoin } from "@/server/crm/verification";
import { checkFeature } from "@/server/billing/entitlements";

/**
 * Müşteri (QR) kimlik eylemleri — TAMAMEN İSTEĞE BAĞLI. Sipariş / menü / servis / AI bunlar olmadan çalışır.
 *
 * Güven modeli: kiracı yalnızca QR bağlamından (token + istek host'u) gelir; profil işlemleri yalnızca bu tarayıcının
 * müşteri oturum çereziyle (opak belirteç, sunucuda özet) yetkilendirilir. İstemciden gelen müşteri / kiracı kimliği
 * YOKTUR. Server Action olduğu için Next.js köken (Origin) denetimi CSRF'e karşı uygulanır.
 */
export type JoinResult =
  | { kind: "joined"; linked: boolean }
  | { kind: "verify"; verificationId: string; channel: "PHONE" | "EMAIL" }
  | { kind: "rejected"; reason: "context_invalid" | "invalid" | "contact_required" | "privacy_required" | "rate_limited" | "unavailable" };
export type VerifyResult = { kind: "joined"; linked: boolean } | { kind: "rejected"; reason: "context_invalid" | "invalid_code" | "expired" | "locked" | "rate_limited" };
export type ProfileResult = { ok: true } | { ok: false; reason: "context_invalid" | "no_identity" | "invalid" | "rate_limited" };

async function tenantFor(token: unknown): Promise<{ tenantId: string; tableId: string } | null> {
  if (typeof token !== "string") return null;
  const r = await getTableQrContext(token);
  return r.ok ? { tenantId: r.context.tenant.id, tableId: r.context.table.id } : null;
}

async function ip(): Promise<string> {
  return (await getRequestMeta()).ipAddress ?? "unknown";
}

const consentEnum = z.enum(["PRIVACY", "LOYALTY", "MARKETING_EMAIL", "MARKETING_SMS", "MARKETING_WHATSAPP"]);
const joinSchema = z.object({
  firstName: z.string().max(80).nullish(),
  lastName: z.string().max(80).nullish(),
  phone: z.string().max(32).nullish(),
  email: z.string().max(254).nullish(),
  consents: z.array(consentEnum).max(5),
  from: z.enum(["menu", "order", "loyalty"]).default("menu"),
  language: z.string().regex(/^[a-z]{2}$/).default("tr"),
});

const SOURCE_BY_FROM = { menu: "QR_OPT_IN", order: "ORDER_CHECKOUT", loyalty: "LOYALTY_JOIN" } as const;

function contactOf(phone: string | null, email: string | null): ContactInput {
  const phoneNormalized = normalizePhone(phone);
  const emailNormalized = normalizeEmail(email);
  return { phone: phoneNormalized, phoneNormalized, email: emailNormalized, emailNormalized };
}

export async function joinCustomerAction(token: string, payload: unknown): Promise<JoinResult> {
  const ctx = await tenantFor(token);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  if (!(await checkFeature(ctx.tenantId, "crm")).allowed) return { kind: "rejected", reason: "unavailable" };
  const parsed = joinSchema.safeParse(payload);
  if (!parsed.success) return { kind: "rejected", reason: "invalid" };
  const d = parsed.data;
  const firstName = cleanName(d.firstName);
  const lastName = cleanName(d.lastName);
  if ((d.firstName?.trim() && !firstName) || (d.lastName?.trim() && !lastName)) return { kind: "rejected", reason: "invalid" };
  if ((d.phone?.trim() && !normalizePhone(d.phone)) || (d.email?.trim() && !normalizeEmail(d.email))) return { kind: "rejected", reason: "invalid" };
  const contact = contactOf(d.phone ?? null, d.email ?? null);
  if (!contact.phoneNormalized && !contact.emailNormalized) return { kind: "rejected", reason: "contact_required" };
  if (!d.consents.includes("PRIVACY")) return { kind: "rejected", reason: "privacy_required" };

  const address = await ip();
  const limited = await rateLimitAll([
    ["crm.join.ip", address],
    ["crm.join.table", ctx.tableId],
  ]);
  if (!limited.allowed) return { kind: "rejected", reason: "rate_limited" };

  const consents = allowedConsents(d.consents, { hasPhone: !!contact.phoneNormalized, hasEmail: !!contact.emailNormalized });
  const source = SOURCE_BY_FROM[d.from];

  if (verificationAvailable()) {
    const channel = contact.phoneNormalized ? "PHONE" : "EMAIL";
    const value = (channel === "PHONE" ? contact.phoneNormalized : contact.emailNormalized)!;
    const sendLimit = await rateLimitAll([
      ["crm.verify.send.contact", `${ctx.tenantId}|${channel}|${value}`],
      ["crm.verify.send.ip", address],
    ]);
    if (!sendLimit.allowed) return { kind: "rejected", reason: "rate_limited" };
    const pending: PendingJoin = { firstName, lastName, phone: contact.phone, email: contact.email, consents, source, language: d.language };
    const started = await startVerification(ctx.tenantId, channel, value, pending);
    if (!started.ok) return { kind: "rejected", reason: "unavailable" };
    return { kind: "verify", verificationId: started.publicId, channel };
  }

  // Doğrulama sağlayıcısı yok: DOĞRULANMAMIŞ katılım — her zaman yeni profil, hiçbir mevcut profile bağlanmaz.
  const joined = await joinCustomer(ctx.tenantId, { firstName, lastName, contact, verified: null, consents, source, language: d.language });
  await startCustomerSession(ctx.tenantId, joined.customerId);
  return { kind: "joined", linked: false };
}

export async function verifyCustomerAction(token: string, verificationId: unknown, code: unknown): Promise<VerifyResult> {
  const ctx = await tenantFor(token);
  if (!ctx) return { kind: "rejected", reason: "context_invalid" };
  if (!(await checkFeature(ctx.tenantId, "crm")).allowed) return { kind: "rejected", reason: "context_invalid" };
  if (typeof verificationId !== "string" || !/^[A-Za-z0-9_-]{10,40}$/.test(verificationId) || typeof code !== "string") return { kind: "rejected", reason: "invalid_code" };
  const limited = await rateLimit("crm.verify.check.ip", await ip());
  if (!limited.allowed) return { kind: "rejected", reason: "rate_limited" };
  const result = await consumeVerification(ctx.tenantId, verificationId, code.trim());
  if (!result.ok) return { kind: "rejected", reason: result.reason === "invalid" ? "invalid_code" : result.reason };
  const p = result.payload;
  const contact = contactOf(p.phone, p.email);
  const joined = await joinCustomer(ctx.tenantId, {
    firstName: p.firstName,
    lastName: p.lastName,
    contact,
    verified: { channel: result.channel, valueNormalized: result.valueNormalized },
    consents: p.consents as ConsentKind[],
    source: p.source,
    language: p.language,
  });
  await startCustomerSession(ctx.tenantId, joined.customerId);
  return { kind: "joined", linked: joined.linked };
}

async function identityFor(token: unknown): Promise<{ tenantId: string; customerId: string } | ProfileResult> {
  const ctx = await tenantFor(token);
  if (!ctx) return { ok: false, reason: "context_invalid" };
  const limited = await rateLimit("crm.profile.ip", await ip());
  if (!limited.allowed) return { ok: false, reason: "rate_limited" };
  const identity = await readCustomerIdentity(ctx.tenantId);
  if (!identity) return { ok: false, reason: "no_identity" };
  return { tenantId: ctx.tenantId, customerId: identity.customerId };
}

const nameSchema = z.object({ firstName: z.string().max(80).nullish(), lastName: z.string().max(80).nullish() });

export async function updateCustomerNameAction(token: string, payload: unknown): Promise<ProfileResult> {
  const who = await identityFor(token);
  if ("ok" in who) return who;
  const parsed = nameSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const firstName = cleanName(parsed.data.firstName);
  const lastName = cleanName(parsed.data.lastName);
  if ((parsed.data.firstName?.trim() && !firstName) || (parsed.data.lastName?.trim() && !lastName)) return { ok: false, reason: "invalid" };
  if (!(await updateOwnName(who.tenantId, who.customerId, firstName, lastName))) return { ok: false, reason: "no_identity" };
  revalidatePath("/site/t/[token]/hesabim", "page");
  return { ok: true };
}

const consentChangeSchema = z.strictObject({
  LOYALTY: z.boolean().optional(),
  MARKETING_EMAIL: z.boolean().optional(),
  MARKETING_SMS: z.boolean().optional(),
  MARKETING_WHATSAPP: z.boolean().optional(),
});

export async function updateCustomerConsentsAction(token: string, payload: unknown): Promise<ProfileResult> {
  const who = await identityFor(token);
  if ("ok" in who) return who;
  const parsed = consentChangeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const applied = await updateOwnConsents(who.tenantId, who.customerId, parsed.data);
  if (!applied) return { ok: false, reason: "no_identity" };
  revalidatePath("/site/t/[token]/hesabim", "page");
  return { ok: true };
}

export async function logoutCustomerAction(token: string): Promise<ProfileResult> {
  const ctx = await tenantFor(token);
  if (!ctx) return { ok: false, reason: "context_invalid" };
  await endCustomerSession(ctx.tenantId);
  revalidatePath("/site/t/[token]", "layout");
  return { ok: true };
}

export async function requestCustomerDeletionAction(token: string): Promise<ProfileResult> {
  const who = await identityFor(token);
  if ("ok" in who) return who;
  await requestOwnDeletion(who.tenantId, who.customerId);
  await endCustomerSession(who.tenantId);
  revalidatePath("/site/t/[token]", "layout");
  return { ok: true };
}

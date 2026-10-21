import "server-only";
import type { ConsentSource, ConsentType, ContactChannel, CustomerSource, Prisma } from "@prisma/client";
import { CONSENT_VERSION, MARKETING_CHANNEL_NEEDS, MARKETING_TYPES, type MarketingType } from "@/config/consent";
import { prisma } from "@/lib/db/prisma";
import { consentTransition, currentConsents, type ConsentKind } from "@/lib/crm/consent";
import { newCustomerPublicId } from "@/lib/crm/session";
import type { RequestMeta } from "@/lib/security/request-meta";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * Müşteri profili + onay yazımları (müşteri ve personel ortak çekirdeği).
 *
 * Kurallar:
 *   - Kayıtlar kiracıya özeldir; aynı kişi farklı restoranlarda bağımsız müşteridir (küresel müşteri grafiği YOK).
 *   - Yalnızca DOĞRULANMIŞ iletişim (CustomerVerifiedContact, kiracı içinde benzersiz) mevcut müşteriye bağlanır.
 *     Doğrulanmamış iletişim hiçbir zaman sessizce birleştirilmez (her katılım yeni profil) — otomatik birleştirme YOK.
 *   - Onaylar ekleme-yalnızdır (geçmiş korunur, sürümlü); geri alma yeni REVOKED satırıdır ve anında geçerlidir.
 *   - Denetim metadata'sına telefon / e-posta YAZILMAZ (yalnızca iç referans + kanal adları).
 */
type Tx = Prisma.TransactionClient;
type Actor = { userId: string | null; meta: RequestMeta };

const NO_META: RequestMeta = { ipAddress: null, userAgent: null };

export type ContactInput = { phone: string | null; phoneNormalized: string | null; email: string | null; emailNormalized: string | null };

/** İstenen pazarlama kanalları, yalnızca ilgili iletişim bilgisi varsa geçerlidir. */
export function allowedConsents(requested: readonly string[], contact: { hasPhone: boolean; hasEmail: boolean }): ConsentKind[] {
  const out = new Set<ConsentKind>();
  for (const r of requested) {
    if (r === "PRIVACY" || r === "LOYALTY") out.add(r);
    else if ((MARKETING_TYPES as readonly string[]).includes(r)) {
      const need = MARKETING_CHANNEL_NEEDS[r as MarketingType];
      if ((need === "phone" && contact.hasPhone) || (need === "email" && contact.hasEmail)) out.add(r as ConsentKind);
    }
  }
  return [...out];
}

/**
 * Onay değişikliklerini uygular (değişmeyenler kayıt üretmez). LOYALTY onayı sadakat hesabını açar / pasifleştirir.
 * Dönüş: gerçekten değişen türler.
 */
export async function applyConsentChangesInTx(
  tx: Tx,
  input: { tenantId: string; customerId: string; changes: Partial<Record<ConsentKind, boolean>>; source: ConsentSource; actor: Actor },
): Promise<{ type: ConsentKind; status: "GRANTED" | "REVOKED" }[]> {
  const { tenantId, customerId } = input;
  const rows = await tx.customerConsent.findMany({ where: { tenantId, customerId }, select: { type: true, status: true, createdAt: true, version: true } });
  const current = currentConsents(rows);
  const now = new Date();
  const applied: { type: ConsentKind; status: "GRANTED" | "REVOKED" }[] = [];
  for (const [type, wantedBool] of Object.entries(input.changes) as [ConsentKind, boolean | undefined][]) {
    if (wantedBool === undefined) continue;
    const wanted = wantedBool ? "GRANTED" : "REVOKED";
    if (consentTransition(current[type].state, wanted) === "noop") continue;
    await tx.customerConsent.create({
      data: { tenantId, customerId, type: type as ConsentType, status: wanted, source: input.source, version: CONSENT_VERSION, grantedAt: wanted === "GRANTED" ? now : null, revokedAt: wanted === "REVOKED" ? now : null },
    });
    applied.push({ type, status: wanted });
  }
  const loyalty = applied.find((a) => a.type === "LOYALTY");
  if (loyalty) {
    const active = loyalty.status === "GRANTED";
    await tx.loyaltyAccount.upsert({ where: { tenantId_customerId: { tenantId, customerId } }, create: { tenantId, customerId, active }, update: { active } });
  }
  if (applied.length) {
    await tx.auditLog.create({
      data: buildAuditRow(
        { action: "CONSENT_CHANGED", entity: "Customer", entityId: customerId, tenantId, userId: input.actor.userId, metadata: { source: input.source, version: CONSENT_VERSION, changes: applied, actor: input.actor.userId ? "staff" : "customer" } },
        input.actor.meta,
      ),
    });
  }
  return applied;
}

export type JoinInput = {
  firstName: string | null;
  lastName: string | null;
  contact: ContactInput;
  /** Doğrulanmış kanal (yalnızca doğrulama sağlayıcısı kodu onayladıysa). */
  verified: { channel: ContactChannel; valueNormalized: string } | null;
  consents: ConsentKind[];
  source: Exclude<CustomerSource, "MANUAL_STAFF">;
  language: string;
};

/**
 * Müşteri katılımı (QR). Doğrulanmış iletişim kiracıda zaten kayıtlıysa o müşteriye BAĞLANIR (yinelenen profil yok;
 * mevcut ad boşsa doldurulur, onaylar uygulanır). Aksi halde yeni profil oluşturulur.
 */
export async function joinCustomer(tenantId: string, input: JoinInput): Promise<{ customerId: string; linked: boolean }> {
  return prisma.$transaction(async (tx) => {
    const actor: Actor = { userId: null, meta: NO_META };
    if (input.verified) {
      const existing = await tx.customerVerifiedContact.findUnique({
        where: { tenantId_channel_valueNormalized: { tenantId, channel: input.verified.channel, valueNormalized: input.verified.valueNormalized } },
        select: { customerId: true, customer: { select: { firstName: true, lastName: true, deletionRequestedAt: true } } },
      });
      if (existing && !existing.customer.deletionRequestedAt) {
        await tx.customer.updateMany({
          where: { id: existing.customerId, tenantId },
          data: {
            ...(existing.customer.firstName ? {} : { firstName: input.firstName }),
            ...(existing.customer.lastName ? {} : { lastName: input.lastName }),
            preferredLanguage: input.language,
            lastSeenAt: new Date(),
          },
        });
        await applyConsentChangesInTx(tx, { tenantId, customerId: existing.customerId, changes: Object.fromEntries(input.consents.map((c) => [c, true])), source: "QR_OPT_IN", actor });
        return { customerId: existing.customerId, linked: true };
      }
    }
    const now = new Date();
    const verifiedPhone = input.verified?.channel === "PHONE" && input.verified.valueNormalized === input.contact.phoneNormalized;
    const verifiedEmail = input.verified?.channel === "EMAIL" && input.verified.valueNormalized === input.contact.emailNormalized;
    const customer = await tx.customer.create({
      data: {
        tenantId,
        publicId: newCustomerPublicId(),
        firstName: input.firstName,
        lastName: input.lastName,
        ...input.contact,
        phoneVerifiedAt: verifiedPhone ? now : null,
        emailVerifiedAt: verifiedEmail ? now : null,
        preferredLanguage: input.language,
        source: input.source,
        lastSeenAt: now,
      },
      select: { id: true },
    });
    if (input.verified && (verifiedPhone || verifiedEmail)) {
      // Silme talep etmiş eski profil doğrulanmış iletişimi bırakır (yeni profil onu devralır).
      await tx.customerVerifiedContact.deleteMany({ where: { tenantId, channel: input.verified.channel, valueNormalized: input.verified.valueNormalized } });
      await tx.customerVerifiedContact.create({ data: { tenantId, customerId: customer.id, channel: input.verified.channel, valueNormalized: input.verified.valueNormalized } });
    }
    await tx.auditLog.create({
      data: buildAuditRow(
        { action: "CUSTOMER_CREATED", entity: "Customer", entityId: customer.id, tenantId, userId: null, metadata: { source: input.source, actor: "customer", hasPhone: !!input.contact.phoneNormalized, hasEmail: !!input.contact.emailNormalized, verified: input.verified?.channel ?? null } },
        NO_META,
      ),
    });
    await applyConsentChangesInTx(tx, { tenantId, customerId: customer.id, changes: Object.fromEntries(input.consents.map((c) => [c, true])), source: "QR_OPT_IN", actor });
    return { customerId: customer.id, linked: false };
  });
}

/** Müşterinin kendi profili (QR "Hesabım"). İç kimlik / personel notu DÖNMEZ. */
export async function getOwnProfile(tenantId: string, customerId: string) {
  const c = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, deletionRequestedAt: null },
    select: { publicId: true, firstName: true, lastName: true, phone: true, email: true, phoneVerifiedAt: true, emailVerifiedAt: true, consents: { select: { type: true, status: true, createdAt: true, version: true } } },
  });
  if (!c) return null;
  return { ...c, consents: currentConsents(c.consents) };
}

export async function updateOwnName(tenantId: string, customerId: string, firstName: string | null, lastName: string | null): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.customer.updateMany({ where: { id: customerId, tenantId, deletionRequestedAt: null }, data: { firstName, lastName } });
    if (r.count !== 1) return false;
    await tx.auditLog.create({ data: buildAuditRow({ action: "CUSTOMER_UPDATED", entity: "Customer", entityId: customerId, tenantId, userId: null, metadata: { actor: "customer", fields: ["name"] } }, NO_META) });
    return true;
  });
}

export async function updateOwnConsents(tenantId: string, customerId: string, changes: Partial<Record<ConsentKind, boolean>>) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, tenantId, deletionRequestedAt: null }, select: { phoneNormalized: true, emailNormalized: true } });
    if (!c) return null;
    // Kanal için iletişim yoksa izin VERİLEMEZ (geri alma her zaman serbest). Gizlilik onayı buradan geri alınmaz
    // (geri alma = veri silme talebi akışı).
    const filtered: Partial<Record<ConsentKind, boolean>> = {};
    for (const [type, value] of Object.entries(changes) as [ConsentKind, boolean][]) {
      if (type === "PRIVACY") continue;
      if (value && type !== "LOYALTY" && !allowedConsents([type], { hasPhone: !!c.phoneNormalized, hasEmail: !!c.emailNormalized }).length) continue;
      filtered[type] = value;
    }
    return applyConsentChangesInTx(tx, { tenantId, customerId, changes: filtered, source: "CUSTOMER_PROFILE", actor: { userId: null, meta: NO_META } });
  });
}

/**
 * Veri silme TALEBİ (temel): talep işaretlenir, pazarlama + sadakat + gizlilik onayları geri alınır, tüm oturumlar
 * kapanır. Profil / sipariş geçmişi bu sprintte SİLİNMEZ ya da anonimleştirilmez (muhasebe / operasyon kaydı) —
 * işletme talebi panelde görür; anonimleştirme iş akışı sonraki sprint.
 */
export async function requestOwnDeletion(tenantId: string, customerId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.customer.updateMany({ where: { id: customerId, tenantId, deletionRequestedAt: null }, data: { deletionRequestedAt: new Date() } });
    if (r.count !== 1) return false;
    await applyConsentChangesInTx(tx, {
      tenantId,
      customerId,
      changes: { PRIVACY: false, LOYALTY: false, MARKETING_EMAIL: false, MARKETING_SMS: false, MARKETING_WHATSAPP: false },
      source: "CUSTOMER_PROFILE",
      actor: { userId: null, meta: NO_META },
    });
    await tx.customerSession.updateMany({ where: { tenantId, customerId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: buildAuditRow({ action: "CUSTOMER_DELETION_REQUESTED", entity: "Customer", entityId: customerId, tenantId, userId: null, metadata: { actor: "customer" } }, NO_META) });
    return true;
  });
}

export async function touchCustomer(tenantId: string, customerId: string): Promise<void> {
  await prisma.customer.updateMany({ where: { id: customerId, tenantId }, data: { lastSeenAt: new Date() } });
}

/** Kimliğin hâlâ geçerli bir profile ait olduğunu doğrular (silme talebi → kimlik kullanılmaz). */
export async function activeCustomerId(tenantId: string, customerId: string): Promise<string | null> {
  const c = await prisma.customer.findFirst({ where: { id: customerId, tenantId, deletionRequestedAt: null }, select: { id: true } });
  return c?.id ?? null;
}

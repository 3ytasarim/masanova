import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { currentConsents } from "@/lib/crm/consent";
import { displayName, maskEmail, maskPhone } from "@/lib/crm/contact";
import { REPEAT_CUSTOMER_MIN_SERVED } from "@/lib/crm/loyalty";
import { newCustomerPublicId } from "@/lib/crm/session";
import type { RequestMeta } from "@/lib/security/request-meta";
import type { TenantScope } from "@/lib/tenant/scope";
import { accountSummary } from "@/server/crm/loyalty.service";
import { applyConsentChangesInTx, type ContactInput } from "@/server/crm/customer.service";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * CRM paneli (sahip / müdür). Liste görünümünde iletişim HER ZAMAN maskeli; ayrıntıda tam değer yalnızca yetkili
 * kullanıcıya ve destek modu DIŞINDA (`reveal`). "Toplam Sipariş Tutarı" = müşterinin SERVİS EDİLMİŞ siparişlerinin
 * toplamı (ömür boyu değer iddiası değildir). "Tekrar gelen" = en az 2 servis edilmiş siparişi olan müşteri.
 */
export const CUSTOMER_PAGE_SIZE = 25;

function searchWhere(q: string): Prisma.CustomerWhereInput | null {
  const s = q.trim().slice(0, 80);
  if (!s) return null;
  const or: Prisma.CustomerWhereInput[] = [
    { firstName: { contains: s, mode: "insensitive" } },
    { lastName: { contains: s, mode: "insensitive" } },
  ];
  const parts = s.split(/\s+/);
  if (parts.length >= 2) or.push({ AND: [{ firstName: { contains: parts[0], mode: "insensitive" } }, { lastName: { contains: parts.slice(1).join(" "), mode: "insensitive" } }] });
  if (s.includes("@") || /[a-z]/i.test(s)) or.push({ emailNormalized: { contains: s.toLowerCase() } });
  const digits = s.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length >= 3) or.push({ phoneNormalized: { contains: digits } });
  return { OR: or };
}

export async function listCustomers(scope: TenantScope, input: { q: string; page: number }) {
  const tenantId = scope.tenantId;
  const search = searchWhere(input.q);
  const where: Prisma.CustomerWhereInput = { tenantId, ...(search ?? {}) };
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (Math.max(1, input.page) - 1) * CUSTOMER_PAGE_SIZE,
      take: CUSTOMER_PAGE_SIZE,
      select: {
        id: true, publicId: true, firstName: true, lastName: true, phone: true, email: true, phoneVerifiedAt: true, emailVerifiedAt: true,
        source: true, lastSeenAt: true, createdAt: true, deletionRequestedAt: true,
        consents: { select: { type: true, status: true, createdAt: true, version: true } },
        loyaltyAccounts: { select: { active: true } },
      },
    }),
  ]);
  const ids = rows.map((r) => r.id);
  const [all, served] = ids.length
    ? await Promise.all([
        prisma.order.groupBy({ by: ["customerId"], where: { tenantId, customerId: { in: ids } }, _count: { _all: true }, _max: { createdAt: true } }),
        prisma.order.groupBy({ by: ["customerId"], where: { tenantId, customerId: { in: ids }, status: "SERVED" }, _count: { _all: true }, _sum: { totalMinor: true } }),
      ])
    : [[], []];
  const allBy = new Map(all.map((g) => [g.customerId, g]));
  const servedBy = new Map(served.map((g) => [g.customerId, g]));
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)),
    items: rows.map((r) => {
      const consents = currentConsents(r.consents);
      const a = allBy.get(r.id);
      const s = servedBy.get(r.id);
      const lastOrder = a?._max.createdAt ?? null;
      return {
        id: r.id,
        name: displayName(r),
        phone: maskPhone(r.phone),
        email: maskEmail(r.email),
        verified: !!(r.phoneVerifiedAt || r.emailVerifiedAt),
        source: r.source,
        lastVisit: lastOrder && r.lastSeenAt ? (lastOrder > r.lastSeenAt ? lastOrder : r.lastSeenAt) : (lastOrder ?? r.lastSeenAt),
        orderCount: a?._count._all ?? 0,
        servedCount: s?._count._all ?? 0,
        servedTotalMinor: s?._sum.totalMinor ?? 0,
        loyalty: (r.loyaltyAccounts[0] ? (r.loyaltyAccounts[0].active ? "ACTIVE" : "LEFT") : "NONE") as "ACTIVE" | "LEFT" | "NONE",
        marketing: { email: consents.MARKETING_EMAIL.state, sms: consents.MARKETING_SMS.state, whatsapp: consents.MARKETING_WHATSAPP.state },
        deletionRequested: !!r.deletionRequestedAt,
      };
    }),
  };
}

export type CrmMetrics = { identified: number; repeat: number; identifiedOrders30d: number; orders30d: number; loyaltyMembers: number };

/** Hafif CRM metrikleri (toplamlar). Kimlik kapsamı düşükse oran olduğundan iyi görünmesin diye payda da döner. */
export async function crmMetrics(scope: TenantScope): Promise<CrmMetrics> {
  const tenantId = scope.tenantId;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [identified, repeatRows, identifiedOrders30d, orders30d, loyaltyMembers] = await Promise.all([
    prisma.customer.count({ where: { tenantId, deletionRequestedAt: null } }),
    prisma.order.groupBy({ by: ["customerId"], where: { tenantId, status: "SERVED", customerId: { not: null } }, _count: { _all: true }, having: { customerId: { _count: { gte: REPEAT_CUSTOMER_MIN_SERVED } } } }),
    prisma.order.count({ where: { tenantId, customerId: { not: null }, createdAt: { gte: since } } }),
    prisma.order.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.loyaltyAccount.count({ where: { tenantId, active: true } }),
  ]);
  return { identified, repeat: repeatRows.length, identifiedOrders30d, orders30d, loyaltyMembers };
}

export async function getCustomerDetail(scope: TenantScope, customerId: string, opts: { reveal: boolean }) {
  const tenantId = scope.tenantId;
  const c = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: {
      id: true, publicId: true, firstName: true, lastName: true, phone: true, email: true, phoneVerifiedAt: true, emailVerifiedAt: true,
      preferredLanguage: true, source: true, staffNote: true, deletionRequestedAt: true, lastSeenAt: true, createdAt: true,
      consents: { orderBy: { createdAt: "desc" }, select: { id: true, type: true, status: true, source: true, version: true, createdAt: true } },
    },
  });
  if (!c) return null;
  const [orders, servedAgg, loyalty] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, orderNumber: true, status: true, totalMinor: true, currency: true, itemCount: true, tableName: true, branchName: true, createdAt: true, loyaltyEntries: { where: { type: "EARN" }, select: { points: true } } },
    }),
    prisma.order.aggregate({ where: { tenantId, customerId, status: "SERVED" }, _count: { _all: true }, _sum: { totalMinor: true } }),
    accountSummary(tenantId, customerId),
  ]);
  return {
    id: c.id,
    name: displayName(c),
    firstName: c.firstName,
    lastName: c.lastName,
    phone: opts.reveal ? c.phone : maskPhone(c.phone),
    email: opts.reveal ? c.email : maskEmail(c.email),
    masked: !opts.reveal,
    phoneVerified: !!c.phoneVerifiedAt,
    emailVerified: !!c.emailVerifiedAt,
    preferredLanguage: c.preferredLanguage,
    source: c.source,
    staffNote: c.staffNote,
    deletionRequestedAt: c.deletionRequestedAt,
    lastSeenAt: c.lastSeenAt,
    createdAt: c.createdAt,
    consents: currentConsents(c.consents),
    consentHistory: c.consents,
    orders: orders.map((o) => ({ ...o, earned: o.loyaltyEntries[0]?.points ?? null })),
    servedCount: servedAgg._count._all,
    servedTotalMinor: servedAgg._sum.totalMinor ?? 0,
    loyalty,
  };
}

export type StaffActor = { scope: TenantScope; userId: string; meta: RequestMeta };

/** Personel elle müşteri ekler — kaynak MANUAL_STAFF; personel müşteri adına HİÇBİR onay veremez. */
export async function createManualCustomer(actor: StaffActor, input: { firstName: string | null; lastName: string | null; contact: ContactInput; staffNote: string | null }): Promise<string> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.create({ data: { tenantId, publicId: newCustomerPublicId(), firstName: input.firstName, lastName: input.lastName, ...input.contact, staffNote: input.staffNote, source: "MANUAL_STAFF" }, select: { id: true } });
    await tx.auditLog.create({
      data: buildAuditRow({ action: "CUSTOMER_CREATED", entity: "Customer", entityId: c.id, tenantId, userId: actor.userId, metadata: { source: "MANUAL_STAFF", actor: "staff", hasPhone: !!input.contact.phoneNormalized, hasEmail: !!input.contact.emailNormalized } }, actor.meta),
    });
    return c.id;
  });
}

/**
 * Personel profil düzeltmesi. İletişim değişirse o kanalın doğrulaması düşer (doğrulanmış iletişim kaydı silinir) —
 * personel girdisi doğrulanmış kimlik sayılmaz. Onaylar bu yoldan değişmez.
 */
export async function updateCustomerByStaff(actor: StaffActor, customerId: string, input: { firstName: string | null; lastName: string | null; contact: ContactInput; staffNote: string | null }): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { firstName: true, lastName: true, phoneNormalized: true, emailNormalized: true, staffNote: true } });
    if (!c) return false;
    const phoneChanged = c.phoneNormalized !== input.contact.phoneNormalized;
    const emailChanged = c.emailNormalized !== input.contact.emailNormalized;
    await tx.customer.updateMany({
      where: { id: customerId, tenantId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        staffNote: input.staffNote,
        ...input.contact,
        ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
        ...(emailChanged ? { emailVerifiedAt: null } : {}),
      },
    });
    if (phoneChanged) await tx.customerVerifiedContact.deleteMany({ where: { tenantId, customerId, channel: "PHONE" } });
    if (emailChanged) await tx.customerVerifiedContact.deleteMany({ where: { tenantId, customerId, channel: "EMAIL" } });
    const fields = [
      ...(c.firstName !== input.firstName || c.lastName !== input.lastName ? ["name"] : []),
      ...(phoneChanged ? ["phone"] : []),
      ...(emailChanged ? ["email"] : []),
      ...(c.staffNote !== input.staffNote ? ["staffNote"] : []),
    ];
    if (fields.length) {
      await tx.auditLog.create({ data: buildAuditRow({ action: "CUSTOMER_UPDATED", entity: "Customer", entityId: customerId, tenantId, userId: actor.userId, metadata: { actor: "staff", fields } }, actor.meta) });
    }
    return true;
  });
}

/** Personel, müşterinin talebi üzerine bir pazarlama onayını GERİ ALABİLİR (personel onay VEREMEZ). */
export async function revokeConsentByStaff(actor: StaffActor, customerId: string, type: "MARKETING_EMAIL" | "MARKETING_SMS" | "MARKETING_WHATSAPP"): Promise<boolean> {
  const tenantId = actor.scope.tenantId;
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
    if (!c) return false;
    await applyConsentChangesInTx(tx, { tenantId, customerId, changes: { [type]: false }, source: "MANUAL_STAFF", actor: { userId: actor.userId, meta: actor.meta } });
    return true;
  });
}

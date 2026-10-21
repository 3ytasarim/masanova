import "server-only";
import { Prisma, type SubscriptionEventType, type SubscriptionStatus, type TenantPlan } from "@prisma/client";
import { DEFAULT_TRIAL_DAYS, GRACE_DAYS } from "@/config/billing";
import { isFeature, isLimitKey } from "@/config/plans";
import type { AuditAction } from "@/lib/audit/actions";
import { prisma } from "@/lib/db/prisma";
import type { RequestMeta } from "@/lib/security/request-meta";
import { buildAuditRow } from "@/server/services/audit.service";

/**
 * ManualSubscriptionService (Sprint 20) — faturalama sağlayıcısı YOK; abonelikleri yalnızca Super Admin yönetir
 * (kiracı paneli deneme başlatamaz / uzatamaz). Her değişiklik: abonelik satırı kilitlenir → güncellenir → değiştirilemez
 * SubscriptionEvent + denetim kaydı (eski / yeni paket ve durum) AYNI işlemde → yetki bir sonraki istekte geçerli.
 * Ödeme / kart / sağlayıcı sırrı tutulmaz. İleride bir BillingProvider (Stripe / iyzico …) yalnızca bu servisi çağırır;
 * yetkilendirme sağlayıcıdan bağımsız kalır.
 */
export type BillingActor = { userId: string | null; meta: RequestMeta };
type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;

type SubRow = { id: string; plan: TenantPlan; status: SubscriptionStatus; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; internal: boolean };
type Change = { type: SubscriptionEventType; action: AuditAction; fromPlan?: TenantPlan | null; toPlan?: TenantPlan | null; fromStatus?: SubscriptionStatus | null; toStatus?: SubscriptionStatus | null; metadata?: Record<string, string | number | boolean | null> };

async function record(tx: Tx, actor: BillingActor, tenantId: string, subscriptionId: string, c: Change) {
  const metadata = { fromPlan: c.fromPlan ?? null, toPlan: c.toPlan ?? null, fromStatus: c.fromStatus ?? null, toStatus: c.toStatus ?? null, ...(c.metadata ?? {}) };
  await tx.subscriptionEvent.create({ data: { tenantId, subscriptionId, type: c.type, fromPlan: c.fromPlan ?? null, toPlan: c.toPlan ?? null, fromStatus: c.fromStatus ?? null, toStatus: c.toStatus ?? null, actorUserId: actor.userId, metadata: c.metadata ?? Prisma.DbNull } });
  await tx.auditLog.create({ data: buildAuditRow({ action: c.action, entity: c.action.startsWith("ENTITLEMENT") ? "EntitlementOverride" : "Subscription", entityId: subscriptionId, tenantId, userId: actor.userId, metadata }, actor.meta) });
}

/** Satırı kilitle (yoksa STARTER / ACTIVE olarak oluştur — olay + denetim). */
async function lockOrCreate(tx: Tx, actor: BillingActor, tenantId: string): Promise<SubRow> {
  const select = { id: true, plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, internal: true } as const;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscriptions WHERE tenant_id = ${tenantId} FOR UPDATE`;
  if (rows.length) return tx.subscription.findUniqueOrThrow({ where: { tenantId }, select });
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new SubscriptionError("not_found");
  const created = await tx.subscription.create({ data: { tenantId, plan: "STARTER", status: "ACTIVE" }, select });
  await record(tx, actor, tenantId, created.id, { type: "SUBSCRIPTION_CREATED", action: "SUBSCRIPTION_CREATED", toPlan: created.plan, toStatus: created.status, metadata: { source: "admin" } });
  return created;
}

export class SubscriptionError extends Error {
  constructor(readonly code: "not_found" | "invalid") {
    super(code);
  }
}

/** Tek işlem; yetki önbelleği olmadığından değişiklik bir sonraki istekte her süreçte geçerlidir. */
async function mutate<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 15_000 });
}

/** Yeni işletme: deneme aboneliği (onboarding işlemi içinde). */
export async function createTrialSubscription(tx: Tx, actor: BillingActor, tenantId: string, plan: TenantPlan, now = new Date(), days = DEFAULT_TRIAL_DAYS) {
  const sub = await tx.subscription.create({ data: { tenantId, plan, status: "TRIALING", startsAt: now, currentPeriodStart: now, trialEndsAt: new Date(now.getTime() + days * DAY) }, select: { id: true } });
  await record(tx, actor, tenantId, sub.id, { type: "SUBSCRIPTION_CREATED", action: "SUBSCRIPTION_CREATED", toPlan: plan, toStatus: "TRIALING", metadata: { source: "onboarding", trialDays: days } });
  return sub;
}

export async function changePlan(actor: BillingActor, tenantId: string, plan: TenantPlan): Promise<void> {
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    if (s.plan === plan) return;
    await tx.subscription.update({ where: { id: s.id }, data: { plan } });
    await record(tx, actor, tenantId, s.id, { type: "SUBSCRIPTION_PLAN_CHANGED", action: "SUBSCRIPTION_PLAN_CHANGED", fromPlan: s.plan, toPlan: plan, fromStatus: s.status, toStatus: s.status });
  });
}

/** Etkinleştir / yenile: plan + dönem sonu (null = süresiz). Ek süre / iptal temizlenir. */
export async function activate(actor: BillingActor, tenantId: string, input: { plan: TenantPlan; periodEnd: Date | null; internal?: boolean }, now = new Date()): Promise<void> {
  if (input.periodEnd && input.periodEnd.getTime() <= now.getTime()) throw new SubscriptionError("invalid");
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    await tx.subscription.update({
      where: { id: s.id },
      data: { plan: input.plan, status: "ACTIVE", currentPeriodStart: now, currentPeriodEnd: input.periodEnd, graceEndsAt: null, cancelAtPeriodEnd: false, cancelledAt: null, internal: input.internal ?? s.internal },
    });
    if (s.plan !== input.plan) await record(tx, actor, tenantId, s.id, { type: "SUBSCRIPTION_PLAN_CHANGED", action: "SUBSCRIPTION_PLAN_CHANGED", fromPlan: s.plan, toPlan: input.plan, fromStatus: s.status, toStatus: "ACTIVE" });
    const reactivated = s.status !== "ACTIVE";
    await record(tx, actor, tenantId, s.id, {
      type: reactivated ? "SUBSCRIPTION_REACTIVATED" : "SUBSCRIPTION_PERIOD_CHANGED",
      action: reactivated ? "SUBSCRIPTION_REACTIVATED" : "SUBSCRIPTION_PERIOD_CHANGED",
      fromPlan: s.plan,
      toPlan: input.plan,
      fromStatus: s.status,
      toStatus: "ACTIVE",
      metadata: { periodEnd: input.periodEnd?.toISOString() ?? null, internal: input.internal ?? s.internal },
    });
  });
}

export async function startTrial(actor: BillingActor, tenantId: string, input: { plan: TenantPlan; days: number }, now = new Date()): Promise<void> {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 90) throw new SubscriptionError("invalid");
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    await tx.subscription.update({ where: { id: s.id }, data: { plan: input.plan, status: "TRIALING", trialEndsAt: new Date(now.getTime() + input.days * DAY), currentPeriodStart: now, currentPeriodEnd: null, graceEndsAt: null, cancelAtPeriodEnd: false, cancelledAt: null } });
    await record(tx, actor, tenantId, s.id, { type: "SUBSCRIPTION_TRIAL_STARTED", action: "SUBSCRIPTION_TRIAL_STARTED", fromPlan: s.plan, toPlan: input.plan, fromStatus: s.status, toStatus: "TRIALING", metadata: { days: input.days } });
  });
}

/** Denemeyi uzat: mevcut bitişten (geçmişteyse şimdiden) itibaren +gün. */
export async function extendTrial(actor: BillingActor, tenantId: string, days: number, now = new Date()): Promise<void> {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new SubscriptionError("invalid");
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    if (s.status !== "TRIALING") throw new SubscriptionError("invalid");
    const base = s.trialEndsAt && s.trialEndsAt.getTime() > now.getTime() ? s.trialEndsAt : now;
    const until = new Date(base.getTime() + days * DAY);
    await tx.subscription.update({ where: { id: s.id }, data: { trialEndsAt: until } });
    await record(tx, actor, tenantId, s.id, { type: "SUBSCRIPTION_TRIAL_EXTENDED", action: "SUBSCRIPTION_TRIAL_EXTENDED", fromPlan: s.plan, toPlan: s.plan, fromStatus: s.status, toStatus: s.status, metadata: { days, from: s.trialEndsAt?.toISOString() ?? null, to: until.toISOString() } });
  });
}

export async function setPeriodEnd(actor: BillingActor, tenantId: string, periodEnd: Date, now = new Date()): Promise<void> {
  if (periodEnd.getTime() <= now.getTime()) throw new SubscriptionError("invalid");
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    await tx.subscription.update({ where: { id: s.id }, data: { currentPeriodEnd: periodEnd } });
    await record(tx, actor, tenantId, s.id, { type: "SUBSCRIPTION_PERIOD_CHANGED", action: "SUBSCRIPTION_PERIOD_CHANGED", fromPlan: s.plan, toPlan: s.plan, fromStatus: s.status, toStatus: s.status, metadata: { from: s.currentPeriodEnd?.toISOString() ?? null, to: periodEnd.toISOString() } });
  });
}

export async function scheduleCancel(actor: BillingActor, tenantId: string, cancel: boolean): Promise<void> {
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    if (s.cancelAtPeriodEnd === cancel) return;
    await tx.subscription.update({ where: { id: s.id }, data: { cancelAtPeriodEnd: cancel } });
    const t = cancel ? "SUBSCRIPTION_CANCEL_SCHEDULED" : "SUBSCRIPTION_CANCEL_UNSCHEDULED";
    await record(tx, actor, tenantId, s.id, { type: t, action: t, fromPlan: s.plan, toPlan: s.plan, fromStatus: s.status, toStatus: s.status, metadata: { periodEnd: s.currentPeriodEnd?.toISOString() ?? null } });
  });
}

/** Durum: PAST_DUE (ek süre GRACE_DAYS), SUSPENDED, EXPIRED, CANCELLED. Geri almak için `activate`. */
export async function setStatus(actor: BillingActor, tenantId: string, status: Exclude<SubscriptionStatus, "ACTIVE" | "TRIALING" | "GRACE">, now = new Date()): Promise<void> {
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    if (s.status === status) return;
    await tx.subscription.update({
      where: { id: s.id },
      data: { status, ...(status === "PAST_DUE" ? { graceEndsAt: new Date(now.getTime() + GRACE_DAYS * DAY) } : {}), ...(status === "CANCELLED" ? { cancelledAt: now } : {}) },
    });
    await record(tx, actor, tenantId, s.id, { type: "SUBSCRIPTION_STATUS_CHANGED", action: "SUBSCRIPTION_STATUS_CHANGED", fromPlan: s.plan, toPlan: s.plan, fromStatus: s.status, toStatus: status });
  });
}

/** İstisna: özellik aç/kapa ya da limit değeri (−1 = sınırsız). Paket tanımı değişmez. */
export async function setOverride(actor: BillingActor, tenantId: string, input: { key: string; enabled: boolean | null; limitValue: number | null; expiresAt: Date | null; reason: string }): Promise<void> {
  const reason = input.reason.trim().slice(0, 200);
  const featureOk = isFeature(input.key) && input.enabled !== null && input.limitValue === null;
  const limitOk = isLimitKey(input.key) && input.enabled === null && input.limitValue !== null && Number.isInteger(input.limitValue) && input.limitValue >= -1;
  if ((!featureOk && !limitOk) || !reason) throw new SubscriptionError("invalid");
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    const data = { enabled: input.enabled, limitValue: input.limitValue === null ? null : BigInt(input.limitValue), expiresAt: input.expiresAt, reason, createdByUserId: actor.userId };
    await tx.entitlementOverride.upsert({ where: { tenantId_key: { tenantId, key: input.key } }, create: { tenantId, key: input.key, ...data }, update: data });
    await record(tx, actor, tenantId, s.id, { type: "ENTITLEMENT_OVERRIDE_SET", action: "ENTITLEMENT_OVERRIDE_SET", fromPlan: s.plan, toPlan: s.plan, metadata: { key: input.key, enabled: input.enabled, limitValue: input.limitValue, expiresAt: input.expiresAt?.toISOString() ?? null, reason } });
  });
}

export async function removeOverride(actor: BillingActor, tenantId: string, key: string): Promise<void> {
  await mutate(async (tx) => {
    const s = await lockOrCreate(tx, actor, tenantId);
    const r = await tx.entitlementOverride.deleteMany({ where: { tenantId, key } });
    if (r.count) await record(tx, actor, tenantId, s.id, { type: "ENTITLEMENT_OVERRIDE_REMOVED", action: "ENTITLEMENT_OVERRIDE_REMOVED", fromPlan: s.plan, toPlan: s.plan, metadata: { key } });
  });
}

/**
 * Bakım (isteğe bağlı): süresi dolmuş deneme / dönem / ek süreyi kayıtlı duruma yansıtır (EXPIRED) ve olay yazar.
 * Yetki buna BAĞLI DEĞİLDİR (motor zamandan türetir); bu yalnızca listeleri / raporları normalleştirir.
 */
export async function normalizeExpired(now = new Date()): Promise<number> {
  const candidates = await prisma.subscription.findMany({
    where: {
      internal: false,
      OR: [
        { status: "TRIALING", trialEndsAt: { lte: now } },
        { status: { in: ["PAST_DUE", "GRACE"] }, graceEndsAt: { lte: now } },
        { status: "CANCELLED", currentPeriodEnd: { lte: now } },
      ],
    },
    select: { tenantId: true },
  });
  for (const c of candidates) await setStatus({ userId: null, meta: { ipAddress: null, userAgent: "maintenance" } }, c.tenantId, "EXPIRED", now);
  return candidates.length;
}

import "server-only";
import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { FEATURE_LABELS, LIMIT_KEYS, minimumPlanFor, type Feature, type LimitKey, type PlanLimits } from "@/config/plans";
import { prisma } from "@/lib/db/prisma";
import { resolveBilling, usagePeriod, type BillingResolution, type EntitlementError, type SubscriptionInput } from "@/lib/billing/engine";
import type { TenantScope } from "@/lib/tenant/scope";

/**
 * KANONİK yetki çözücü (Sprint 20). Tüm özellik / limit kararları buradan geçer; paket karşılaştırması başka yerde
 * yazılmaz. Tarayıcı paket / özellik / limit / durum GÖNDEREMEZ — hepsi sunucuda kiracı kimliğinden çözülür.
 *
 * Önbellek: süreçler arası paylaşılan / süreli önbellek YOK (Redis ya da bellek) — paket değişikliği her süreçte bir
 * sonraki istekte geçerlidir, geçersizleme gerekmez. Görüntüleme için yalnızca İSTEK kapsamlı tekilleştirme (React cache:
 * yerleşim + kapı + sayfa aynı istekte tek sorgu). Mutasyonlar (requireFeature / limit) her zaman taze okur → "son mutasyon
 * kontrolü kazanır". Maliyet: istek başına iki küçük, kiracı dizinli sorgu.
 */
export type Entitlements = BillingResolution & {
  tenantId: string;
  hasSubscription: boolean;
  internal: boolean;
  subscription: (SubscriptionInput & { startsAt: Date; cancelledAt: Date | null }) | null;
  has(feature: Feature): boolean;
};

type Db = Prisma.TransactionClient | typeof prisma;

async function load(tenantId: string, db: Db, now: Date): Promise<Entitlements> {
  const [sub, overrides] = await Promise.all([
    db.subscription.findUnique({
      where: { tenantId },
      select: { plan: true, status: true, internal: true, startsAt: true, currentPeriodStart: true, currentPeriodEnd: true, trialEndsAt: true, graceEndsAt: true, cancelAtPeriodEnd: true, cancelledAt: true },
    }),
    db.entitlementOverride.findMany({ where: { tenantId }, select: { key: true, enabled: true, limitValue: true, expiresAt: true } }),
  ]);
  const resolution = resolveBilling(sub, overrides.map((o) => ({ ...o, limitValue: o.limitValue === null ? null : Number(o.limitValue) })), now);
  return { ...resolution, tenantId, hasSubscription: !!sub, internal: !!sub?.internal, subscription: sub, has: (f) => resolution.features.has(f) };
}

/** Taze (önbelleksiz) çözüm — tüm yetki kararları için. */
export async function resolveEntitlements(tenantId: string, opts: { db?: Db; now?: Date } = {}): Promise<Entitlements> {
  return load(tenantId, opts.db ?? prisma, opts.now ?? new Date());
}

/** Görüntüleme için (istek kapsamlı tekilleştirme; kiracı anahtarlı). Yetki kararı için `requireFeature` / `checkFeature`. */
export const getTenantEntitlements = cache((tenantId: string): Promise<Entitlements> => load(tenantId, prisma, new Date()));

// ─── Özellik kapısı ─────────────────────────────────────────────────────────

export class EntitlementDeniedError extends Error {
  constructor(
    readonly code: EntitlementError,
    readonly feature: Feature | null,
    readonly limit: LimitKey | null = null,
  ) {
    super(code);
    this.name = "EntitlementDeniedError";
  }
}

export type FeatureCheck = { allowed: true } | { allowed: false; code: EntitlementError; requiredPlan: ReturnType<typeof minimumPlanFor> };

export async function checkFeature(tenantId: string, feature: Feature, opts: { db?: Db; now?: Date } = {}): Promise<FeatureCheck> {
  const e = await resolveEntitlements(tenantId, opts);
  return e.has(feature) ? { allowed: true } : { allowed: false, code: e.denial, requiredPlan: minimumPlanFor(feature) };
}

/** Sunucu kapısı: özellik yoksa EntitlementDeniedError (kararlı kod). Eylem / rota / servis katmanında çağrılır. */
export async function requireFeature(scope: TenantScope | string, feature: Feature, opts: { db?: Db; now?: Date } = {}): Promise<void> {
  const tenantId = typeof scope === "string" ? scope : scope.tenantId;
  const r = await checkFeature(tenantId, feature, opts);
  if (!r.allowed) throw new EntitlementDeniedError(r.code, feature);
}

/** Kullanıcıya gösterilecek kararlı mesaj (uygulama ayrıntısı yok). */
export function entitlementMessage(code: EntitlementError, feature: Feature | null = null): string {
  switch (code) {
    case "limit_reached":
      return "Paketinizin limitine ulaşıldı. Daha fazlası için paketinizi yükseltin.";
    case "trial_expired":
      return "Deneme süreniz sona erdi. Bu özellik için paket yükseltin.";
    case "subscription_expired":
      return "Aboneliğiniz sona erdi. Bu özellik için aboneliğinizi yenileyin.";
    default:
      return feature ? `${FEATURE_LABELS[feature]} mevcut paketinizde yok (${minimumPlanFor(feature)} paketinde).` : "Bu özellik mevcut paketinizde yok.";
  }
}

// ─── Limitler ───────────────────────────────────────────────────────────────

export function getLimit(e: Pick<Entitlements, "limits">, key: LimitKey): number | null {
  return e.limits[key];
}

/**
 * Eşzamanlılık güvenli limit: (kiracı, limit) başına işlem içi danışma kilidi → sayım → izin. Aynı anda gelen iki
 * "son slot" isteğinden yalnızca biri geçer. Çağıran, kaydı AYNI işlemde oluşturmalıdır.
 */
export async function assertWithinLimit(tx: Prisma.TransactionClient, tenantId: string, key: LimitKey, count: () => Promise<number>, adding = 1): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`masanova:limit:${tenantId}:${key}`}, 0))`;
  const e = await resolveEntitlements(tenantId, { db: tx });
  const limit = e.limits[key];
  if (limit === null) return;
  const current = await count();
  if (current + adding > limit) throw new EntitlementDeniedError("limit_reached", null, key);
}

// ─── Kullanım ───────────────────────────────────────────────────────────────

type Period = { start: Date; end: Date };
/** Limit başına kullanım sorgusu (ayrı sayaç tablosu YOK — mevcut kayıtlardan türetilir). */
const COUNTERS: Record<LimitKey, (tenantId: string, p: Period) => Promise<number>> = {
  maxBranches: (tenantId) => prisma.branch.count({ where: { tenantId } }),
  maxTables: (tenantId) => prisma.diningTable.count({ where: { tenantId } }),
  maxMenuProducts: (tenantId) => prisma.product.count({ where: { tenantId, archivedAt: null } }),
  maxStaffUsers: (tenantId) => prisma.user.count({ where: { tenantId, active: true } }),
  maxMediaBytes: async (tenantId) => Number((await prisma.mediaAsset.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0),
  maxMonthlyAiMinutes: async (tenantId, p) => {
    const a = await prisma.aiTurn.aggregate({ where: { tenantId, createdAt: { gte: p.start, lt: p.end } }, _sum: { audioInMs: true, audioOutMs: true } });
    return Math.ceil(((a._sum.audioInMs ?? 0) + (a._sum.audioOutMs ?? 0)) / 60_000);
  },
  maxMonthlyAiReplies: (tenantId, p) => prisma.aiUsage.count({ where: { tenantId, kind: "CHAT", success: true, createdAt: { gte: p.start, lt: p.end } } }),
  maxMonthlyAdvisorRuns: (tenantId, p) => prisma.aiUsage.count({ where: { tenantId, kind: "ADVISOR", createdAt: { gte: p.start, lt: p.end } } }),
};
export const countUsage = (tenantId: string, key: LimitKey, period: Period) => COUNTERS[key](tenantId, period);

export type UsageSnapshot = Record<LimitKey, number> & { period: { start: Date; end: Date; kind: "subscription" | "calendar_month" } };

/** Tüm limitler için mevcut kullanım (abonelik sayfası). */
export async function getUsage(tenantId: string, e: Pick<Entitlements, "subscription">, now = new Date()): Promise<UsageSnapshot> {
  const period = usagePeriod(e.subscription, now);
  const values = await Promise.all(LIMIT_KEYS.map((k) => COUNTERS[k](tenantId, period)));
  return { ...(Object.fromEntries(LIMIT_KEYS.map((k, i) => [k, values[i]!])) as Record<LimitKey, number>), period };
}

/** Kullanım limiti (AI): dönem kullanımı limite ulaştıysa izin yok. Sağlayıcı çağrısından ÖNCE kontrol edilir. */
export async function usageAllows(e: Pick<Entitlements, "tenantId" | "limits" | "subscription">, keys: readonly LimitKey[], now = new Date()): Promise<{ allowed: boolean; limit: LimitKey | null }> {
  const relevant = keys.filter((k) => e.limits[k] !== null);
  if (!relevant.length) return { allowed: true, limit: null };
  const period = usagePeriod(e.subscription, now);
  const used = await Promise.all(relevant.map((k) => COUNTERS[k](e.tenantId, period)));
  const i = relevant.findIndex((k, idx) => used[idx]! >= (e.limits[k] as number));
  return i < 0 ? { allowed: true, limit: null } : { allowed: false, limit: relevant[i]! };
}

export type { PlanLimits };

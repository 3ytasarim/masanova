import type { SubscriptionStatus, TenantPlan } from "@prisma/client";
import { ENDING_SOON_DAYS, FALLBACK_PLAN, GRACE_DAYS, GRACE_DISABLED_FEATURES } from "@/config/billing";
import { FEATURES, LIMIT_KEYS, PLANS, type Feature, type LimitKey, type PlanLimits } from "@/config/plans";

/**
 * Faturalama durum motoru — SAF ve deterministik (Sprint 20). Girdi: kayıtlı abonelik + istisnalar + `now` (sunucu
 * saati). Çıktı: etkin durum, etkin paket, özellik kümesi, limitler. Cron'a bağımlı DEĞİL: süresi dolan deneme / dönem /
 * ek süre her kontrolde zaman damgalarından türetilir (bakım işi yalnızca kayıtlı durumu normalleştirir).
 */
export type SubscriptionInput = {
  plan: TenantPlan;
  status: SubscriptionStatus;
  internal: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
};
export type OverrideInput = { key: string; enabled: boolean | null; limitValue: number | null; expiresAt: Date | null };

/** Etkin durum: kayıtlı durum + zamandan türetilir. NONE = abonelik kaydı yok (güvenli varsayılan: FALLBACK_PLAN). */
export type EffectiveState = "TRIALING" | "ACTIVE" | "GRACE" | "TRIAL_EXPIRED" | "EXPIRED" | "SUSPENDED" | "NONE";
/** Kararlı hata kodları (uygulama ayrıntısı içermez). */
export type EntitlementError = "feature_disabled" | "limit_reached" | "subscription_expired" | "trial_expired";

export type BillingResolution = {
  state: EffectiveState;
  /** Abone olunan paket (kayıt). */
  subscribedPlan: TenantPlan;
  /** Özellikleri belirleyen paket (süre dolduysa FALLBACK_PLAN). */
  effectivePlan: TenantPlan;
  features: ReadonlySet<Feature>;
  limits: PlanLimits;
  /** Durumun bittiği an (deneme sonu / dönem sonu / ek süre sonu); süresizse null. */
  endsAt: Date | null;
  /** Sahibe gösterilecek uyarı (müşteriye ASLA). */
  warning: "trial_ending" | "period_ending" | "grace" | "trial_expired" | "expired" | "suspended" | null;
  /** Dönem sonunda iptal planlı mı (dönem bitene kadar hak sürer). */
  cancelScheduled: boolean;
  /** Özellik yokken verilecek kararlı hata kodu. */
  denial: EntitlementError;
};

const DAY = 86_400_000;
const after = (d: Date | null, now: Date) => !!d && d.getTime() > now.getTime();

/** Ek süre sonu: kayıtlı `graceEndsAt` varsa o, yoksa dönem sonu + GRACE_DAYS. */
export function graceEnd(sub: Pick<SubscriptionInput, "graceEndsAt" | "currentPeriodEnd">): Date | null {
  if (sub.graceEndsAt) return sub.graceEndsAt;
  return sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd.getTime() + GRACE_DAYS * DAY) : null;
}

export function resolveState(sub: SubscriptionInput | null, now: Date): { state: EffectiveState; endsAt: Date | null } {
  if (!sub) return { state: "NONE", endsAt: null };
  switch (sub.status) {
    case "SUSPENDED":
      return { state: "SUSPENDED", endsAt: null };
    case "EXPIRED":
      return { state: "EXPIRED", endsAt: null };
    case "TRIALING":
      return after(sub.trialEndsAt, now) ? { state: "TRIALING", endsAt: sub.trialEndsAt } : { state: "TRIAL_EXPIRED", endsAt: sub.trialEndsAt };
    case "PAST_DUE":
    case "GRACE": {
      const g = graceEnd(sub);
      return after(g, now) ? { state: "GRACE", endsAt: g } : { state: "EXPIRED", endsAt: g };
    }
    case "CANCELLED":
      // İptal edildi: ödenmiş dönem sonuna kadar hak sürer, ek süre yok.
      return after(sub.currentPeriodEnd, now) ? { state: "ACTIVE", endsAt: sub.currentPeriodEnd } : { state: "EXPIRED", endsAt: sub.currentPeriodEnd };
    case "ACTIVE": {
      if (sub.internal || !sub.currentPeriodEnd) return { state: "ACTIVE", endsAt: sub.currentPeriodEnd };
      if (after(sub.currentPeriodEnd, now)) return { state: "ACTIVE", endsAt: sub.currentPeriodEnd };
      if (sub.cancelAtPeriodEnd) return { state: "EXPIRED", endsAt: sub.currentPeriodEnd };
      const g = graceEnd(sub);
      return after(g, now) ? { state: "GRACE", endsAt: g } : { state: "EXPIRED", endsAt: g };
    }
  }
}

function activeOverrides(overrides: readonly OverrideInput[], now: Date) {
  return overrides.filter((o) => !o.expiresAt || o.expiresAt.getTime() > now.getTime());
}

export function resolveBilling(sub: SubscriptionInput | null, overrides: readonly OverrideInput[], now: Date): BillingResolution {
  const { state, endsAt } = resolveState(sub, now);
  const subscribedPlan = sub?.plan ?? FALLBACK_PLAN;
  const entitled = state === "TRIALING" || state === "ACTIVE" || state === "GRACE";
  const effectivePlan = entitled ? subscribedPlan : FALLBACK_PLAN;
  const features = new Set<Feature>(PLANS[effectivePlan].features);
  if (state === "GRACE") for (const f of GRACE_DISABLED_FEATURES) features.delete(f);
  const limits: PlanLimits = { ...PLANS[effectivePlan].limits };
  for (const o of activeOverrides(overrides, now)) {
    if (o.enabled !== null && (FEATURES as readonly string[]).includes(o.key)) {
      if (o.enabled) features.add(o.key as Feature);
      else features.delete(o.key as Feature);
    } else if (o.limitValue !== null && (LIMIT_KEYS as readonly string[]).includes(o.key)) {
      limits[o.key as LimitKey] = o.limitValue < 0 ? null : o.limitValue;
    }
  }
  const soon = endsAt && endsAt.getTime() - now.getTime() <= ENDING_SOON_DAYS * DAY;
  const warning: BillingResolution["warning"] =
    state === "GRACE" ? "grace" : state === "TRIAL_EXPIRED" ? "trial_expired" : state === "EXPIRED" ? "expired" : state === "SUSPENDED" ? "suspended" : state === "TRIALING" && soon ? "trial_ending" : state === "ACTIVE" && soon ? "period_ending" : null;
  return {
    state,
    subscribedPlan,
    effectivePlan,
    features,
    limits,
    endsAt,
    warning,
    cancelScheduled: !!sub?.cancelAtPeriodEnd && state === "ACTIVE",
    denial: state === "TRIAL_EXPIRED" ? "trial_expired" : state === "EXPIRED" || state === "SUSPENDED" ? "subscription_expired" : "feature_disabled",
  };
}

/** Limit kararı: null = sınırsız. `adding` yeni kayıtla toplamı aşar mı. */
export function limitAllows(limit: number | null, current: number, adding = 1): boolean {
  return limit === null || current + adding <= limit;
}

/** Uyarı seviyesi: 80 / 90 / 100 eşikleri (engel yalnızca 100'de). */
export function usageLevel(limit: number | null, used: number): { percent: number | null; level: 0 | 80 | 90 | 100 } {
  if (limit === null) return { percent: null, level: 0 };
  if (limit <= 0) return { percent: 100, level: 100 };
  const percent = Math.min(999, Math.floor((used / limit) * 100));
  return { percent, level: percent >= 100 ? 100 : percent >= 90 ? 90 : percent >= 80 ? 80 : 0 };
}

/** Kullanım dönemi: dönem başı/sonu tanımlıysa abonelik dönemi, değilse UTC takvim ayı. */
export function usagePeriod(sub: Pick<SubscriptionInput, "currentPeriodStart" | "currentPeriodEnd" | "internal"> | null, now: Date): { start: Date; end: Date; kind: "subscription" | "calendar_month" } {
  if (sub && !sub.internal && sub.currentPeriodEnd && sub.currentPeriodStart.getTime() <= now.getTime() && sub.currentPeriodEnd.getTime() > now.getTime()) {
    return { start: sub.currentPeriodStart, end: sub.currentPeriodEnd, kind: "subscription" };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end, kind: "calendar_month" };
}

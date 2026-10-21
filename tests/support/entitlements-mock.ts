import { vi } from "vitest";
import { FEATURES, PLANS, type Feature } from "@/config/plans";
import { resolveBilling } from "@/lib/billing/engine";
import type * as EntitlementsModule from "@/server/billing/entitlements";

/**
 * Birim testleri için yetki çözücü taklidi (prisma taklit edilen dosyalarda). Varsayılan: AI paketi, tüm özellikler.
 * Kullanım: vi.mock("@/server/billing/entitlements", () => import("../support/entitlements-mock"));
 * Testler `entitlementState.features` kümesini değiştirerek kapıyı (feature_disabled) doğrulayabilir.
 */
const actual = await vi.importActual<typeof EntitlementsModule>("@/server/billing/entitlements");

export const entitlementState = { features: new Set<Feature>(FEATURES) };
export const resetEntitlements = () => {
  entitlementState.features = new Set<Feature>(FEATURES);
};

const fake = (tenantId: string) => {
  const base = resolveBilling({ plan: "AI", status: "ACTIVE", internal: true, currentPeriodStart: new Date(0), currentPeriodEnd: null, trialEndsAt: null, graceEndsAt: null, cancelAtPeriodEnd: false }, [], new Date());
  return { ...base, features: entitlementState.features, limits: { ...PLANS.AI.limits }, tenantId, hasSubscription: true, internal: true, subscription: null, has: (f: Feature) => entitlementState.features.has(f) };
};

export const EntitlementDeniedError = actual.EntitlementDeniedError;
export const entitlementMessage = actual.entitlementMessage;
export const getLimit = actual.getLimit;
export const resolveEntitlements = vi.fn(async (tenantId: string) => fake(tenantId));
export const getTenantEntitlements = vi.fn(async (tenantId: string) => fake(tenantId));
export const checkFeature = vi.fn(async (_tenantId: string, feature: Feature) => (entitlementState.features.has(feature) ? { allowed: true as const } : { allowed: false as const, code: "feature_disabled" as const, requiredPlan: "PRO" as const }));
export const requireFeature = vi.fn(async (scope: { tenantId: string } | string, feature: Feature) => {
  if (!entitlementState.features.has(feature)) throw new actual.EntitlementDeniedError("feature_disabled", feature);
  void scope;
});
export const assertWithinLimit = vi.fn(async () => undefined);
export const usageAllows = vi.fn(async () => ({ allowed: true, limit: null }));
export const getUsage = actual.getUsage;
export const countUsage = actual.countUsage;

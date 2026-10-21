import "server-only";
import type { Feature } from "@/config/plans";
import { checkFeature, EntitlementDeniedError, entitlementMessage } from "@/server/billing/entitlements";

/**
 * Sunucu eylemleri için ince sarmalayıcılar (karar yine kanonik çözücüde): özellik yoksa kararlı mesajlı
 * `{ ok: false }` döner; çağıran `if (gate) return gate;` ile çıkar. Paket mantığı burada TEKRARLANMAZ.
 */
export type GateFailure = { ok: false; error: string; code: "feature_disabled" | "limit_reached" | "subscription_expired" | "trial_expired" };

export async function featureDenied(tenantId: string, feature: Feature): Promise<GateFailure | null> {
  const r = await checkFeature(tenantId, feature);
  return r.allowed ? null : { ok: false, error: entitlementMessage(r.code, feature), code: r.code };
}

/** EntitlementDeniedError (ör. limit) → kararlı eylem sonucu; başka hatalar olduğu gibi fırlatılır. */
export function deniedResult(error: unknown): GateFailure {
  if (error instanceof EntitlementDeniedError) return { ok: false, error: entitlementMessage(error.code, error.feature), code: error.code };
  throw error;
}

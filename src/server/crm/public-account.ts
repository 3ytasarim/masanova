import "server-only";
import type { PublicAccount } from "@/lib/crm/types";
import { readCustomerIdentity } from "@/server/crm/customer-session";
import { activeCustomerId } from "@/server/crm/customer.service";
import { getLoyaltySettings, publicPointsBalance } from "@/server/crm/loyalty.service";
import { getTenantEntitlements } from "@/server/billing/entitlements";

/**
 * QR menü / sipariş sayfası için küçük hesap özeti. Yalnızca bu tarayıcının müşteri oturumundan; içinde iletişim
 * bilgisi YOK (puan + kimlik var mı). Sesli AI'ya ya da menü önbelleğine GİRMEZ.
 */

export async function publicAccountFor(tenantId: string, token: string): Promise<PublicAccount> {
  const [identity, settings, ent] = await Promise.all([readCustomerIdentity(tenantId), getLoyaltySettings(tenantId), getTenantEntitlements(tenantId)]);
  const customerId = identity ? await activeCustomerId(tenantId, identity.customerId) : null;
  const points = customerId ? await publicPointsBalance(tenantId, customerId) : null;
  return { href: `/t/${token}/hesabim`, identified: !!customerId, points, loyaltyEnabled: settings.enabled && !!settings.minorPerPoint && ent.has("loyalty") };
}

import { Lock, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { UPGRADE_CONTACT } from "@/config/billing";
import { FEATURE_LABELS, PLANS, minimumPlanFor, type Feature } from "@/config/plans";
import { requireTenantUser } from "@/lib/auth/guards";
import { formatDate } from "@/lib/utils/format";
import { hasPermission } from "@/lib/permissions/roles";
import { getTenantEntitlements, type Entitlements } from "@/server/billing/entitlements";
import { buttonVariants } from "@/components/ui/button";

/**
 * Paket kapısı — panel bölümleri için TEK davranış (gezinme yapılandırmasındaki `lockMode` ile aynı):
 *   "screen"   → yükseltme ekranı (sayfa çökmez, 404 değil)
 *   "continue" → içerik açık + bilgi bandı; mevcut kayıtlar tamamlanır, yeni oluşturma SUNUCUDA reddedilir
 * Görüntüleme kararıdır; yetki her eylemde `requireFeature` ile ayrıca verilir.
 */
export async function FeatureSection({ feature, mode, children }: { feature: Feature; mode: "screen" | "continue"; children: ReactNode }) {
  const { scope, user, support } = await requireTenantUser({ permission: "panel.view" });
  const ent = await getTenantEntitlements(scope.tenantId);
  if (ent.has(feature)) return children;
  const owner = !!support || hasPermission(user.role, "billing.view");
  if (mode === "screen") return <FeatureLocked feature={feature} owner={owner} ent={ent} />;
  return (
    <>
      <p role="status" className="mb-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg" data-testid="feature-continuation" data-feature={feature}>
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          {FEATURE_LABELS[feature]} mevcut paketinizde yok ({PLANS[minimumPlanFor(feature)].label} paketinde). Mevcut kayıtlar görüntülenebilir ve tamamlanabilir; yeni kayıt oluşturulamaz.
          {owner ? (
            <>
              {" "}
              <Link href="/panel/abonelik" className="font-medium underline underline-offset-4">
                Paketi İncele
              </Link>
            </>
          ) : null}
        </span>
      </p>
      {children}
    </>
  );
}

export function FeatureLocked({ feature, owner, ent }: { feature: Feature; owner: boolean; ent: Pick<Entitlements, "denial"> }) {
  const plan = PLANS[minimumPlanFor(feature)].label;
  const lead = ent.denial === "trial_expired" ? "Deneme süreniz sona erdi." : ent.denial === "subscription_expired" ? "Aboneliğiniz sona erdi." : null;
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-border bg-bg p-8 text-center" data-testid="feature-locked" data-feature={feature}>
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Lock aria-hidden="true" className="size-5 text-fg-muted" />
      </span>
      <h1 className="mt-4 text-xl font-semibold text-fg">{FEATURE_LABELS[feature]}</h1>
      <p className="mt-2 text-[0.9375rem] text-fg-muted">
        {lead ? `${lead} ` : ""}Bu özellik {plan} paketinde.
      </p>
      <p className="mt-1 text-sm text-fg-subtle">Geçmiş verileriniz silinmez; paket yükseltildiğinde kaldığınız yerden devam edersiniz.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {owner ? (
          <Link href="/panel/abonelik" className={buttonVariants({ variant: "primary" })} data-testid="feature-locked-cta">
            Paketi İncele
          </Link>
        ) : (
          <p className="text-sm text-fg-subtle">Paket değişikliği için işletme sahibiyle görüşün.</p>
        )}
      </div>
    </section>
  );
}

/** Sahibe (yalnızca billing.view) abonelik uyarısı — müşteriye / personele gösterilmez. */
export function BillingWarning({ ent }: { ent: Pick<Entitlements, "warning" | "endsAt" | "subscribedPlan"> }) {
  if (!ent.warning) return null;
  const date = ent.endsAt ? formatDate(ent.endsAt) : null;
  const text: Record<NonNullable<Entitlements["warning"]>, string> = {
    grace: `Abonelik süreniz sona erdi. ${date ?? ""} tarihine kadar hizmetleriniz kesintisiz devam edecek (AI özellikleri bu sürede kapalı).`,
    trial_ending: `Deneme süreniz ${date ?? ""} tarihinde bitiyor.`,
    period_ending: `Abonelik döneminiz ${date ?? ""} tarihinde bitiyor.`,
    trial_expired: "Deneme süreniz sona erdi. Starter paketindeki özellikler kullanılabilir; verileriniz korunur.",
    expired: "Aboneliğiniz sona erdi. Starter paketindeki özellikler kullanılabilir; verileriniz korunur.",
    suspended: "Aboneliğiniz askıya alındı. Starter paketindeki özellikler kullanılabilir; verileriniz korunur.",
  };
  const severe = ent.warning === "grace" || ent.warning === "expired" || ent.warning === "trial_expired" || ent.warning === "suspended";
  return (
    <div role="status" className={severe ? "border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-fg sm:px-6 lg:px-8" : "border-b border-border bg-surface-2 px-4 py-2.5 text-sm text-fg-muted sm:px-6 lg:px-8"} data-testid="billing-warning" data-warning={ent.warning}>
      {text[ent.warning]}{" "}
      <Link href="/panel/abonelik" className="font-medium underline underline-offset-4">
        Aboneliği görüntüle
      </Link>{" "}
      ·{" "}
      <Link href={UPGRADE_CONTACT.href} className="font-medium underline underline-offset-4">
        {UPGRADE_CONTACT.label}
      </Link>
    </div>
  );
}

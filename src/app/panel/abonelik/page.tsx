import type { Metadata } from "next";
import { Check, Lock } from "lucide-react";
import Link from "next/link";
import { LIMITS_PROVISIONAL, LIMIT_KEYS, LIMIT_LABELS, PLANS, PLAN_ORDER, FEATURES, FEATURE_LABELS, minimumPlanFor, planHasFeature, type LimitKey } from "@/config/plans";
import { UPGRADE_CONTACT } from "@/config/billing";
import { requireTenantUser } from "@/lib/auth/guards";
import { usageLevel } from "@/lib/billing/engine";
import { EFFECTIVE_STATE_LABELS, EFFECTIVE_STATE_TONES } from "@/lib/billing/labels";
import { formatBytes, formatDate, formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { getUsage, resolveEntitlements } from "@/server/billing/entitlements";
import { planCards } from "@/lib/marketing/plans";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Abonelik" };

const fmtLimit = (key: LimitKey, v: number) => (key === "maxMediaBytes" ? formatBytes(v) : formatNumber(v));

/**
 * Kiracı abonelik sayfası — YALNIZCA işletme sahibi (billing.view); şube müdürü göremez (paket rozetini panoda görür).
 * Destek modu salt okunur görür. Ödeme formu YOK (faturalama sağlayıcısı yok): yükseltme için iletişim. Deneme
 * panelden başlatılamaz / uzatılamaz. Tüm değerler sunucuda çözülür; fiyat uydurulmaz.
 */
export default async function SubscriptionPage() {
  const { scope } = await requireTenantUser({ permission: "billing.view" });
  const ent = await resolveEntitlements(scope.tenantId);
  const usage = await getUsage(scope.tenantId, ent);
  const sub = ent.subscription;
  const cards = planCards();

  return (
    <>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Abonelik</h1>
        <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-fg-subtle">Paketiniz, abonelik durumu, özellikler, limitler ve bu dönemki kullanım.</p>
      </header>

      <section aria-label="Abonelik durumu" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card data-testid="subscription-summary" data-plan={ent.subscribedPlan} data-effective-plan={ent.effectivePlan} data-state={ent.state}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {PLANS[ent.subscribedPlan].label} paketi
              <Badge tone={EFFECTIVE_STATE_TONES[ent.state]} dot data-testid="subscription-state">
                {EFFECTIVE_STATE_LABELS[ent.state]}
              </Badge>
              {ent.internal ? <Badge tone="neutral">Faturasız (iç kullanım)</Badge> : null}
            </CardTitle>
            <CardDescription>{PLANS[ent.subscribedPlan].description}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {ent.effectivePlan !== ent.subscribedPlan ? (
                <>
                  <dt className="text-fg-subtle">Şu an geçerli</dt>
                  <dd className="font-medium text-fg" data-testid="effective-plan">
                    {PLANS[ent.effectivePlan].label} özellikleri (verileriniz korunur)
                  </dd>
                </>
              ) : null}
              {sub ? (
                <>
                  <dt className="text-fg-subtle">Başlangıç</dt>
                  <dd>{formatDate(sub.startsAt)}</dd>
                </>
              ) : null}
              {sub?.trialEndsAt && (ent.state === "TRIALING" || ent.state === "TRIAL_EXPIRED") ? (
                <>
                  <dt className="text-fg-subtle">Deneme bitişi</dt>
                  <dd data-testid="trial-ends">{formatDate(sub.trialEndsAt)}</dd>
                </>
              ) : null}
              {sub?.currentPeriodEnd ? (
                <>
                  <dt className="text-fg-subtle">Dönem sonu</dt>
                  <dd>
                    {formatDate(sub.currentPeriodEnd)}
                    {ent.cancelScheduled ? " · dönem sonunda sona erecek" : ""}
                  </dd>
                </>
              ) : sub && ent.state === "ACTIVE" ? (
                <>
                  <dt className="text-fg-subtle">Dönem</dt>
                  <dd>Süresiz</dd>
                </>
              ) : null}
              {ent.state === "GRACE" && ent.endsAt ? (
                <>
                  <dt className="text-fg-subtle">Ek süre bitişi</dt>
                  <dd data-testid="grace-ends">{formatDate(ent.endsAt)}</dd>
                </>
              ) : null}
            </dl>
            <p className="mt-5 text-sm text-fg-subtle">
              Paket değişikliği, deneme ve dönem uzatma MasaNova ekibi tarafından yapılır. Kart / ödeme bilgisi bu sayfada istenmez.
            </p>
            <Link href={UPGRADE_CONTACT.href} className={cn(buttonVariants({ variant: "primary" }), "mt-4")} data-testid="upgrade-cta">
              {UPGRADE_CONTACT.label}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Özellikler</CardTitle>
            <CardDescription>Şu an etkin olanlar.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm" data-testid="subscription-features">
              {FEATURES.map((f) => {
                const on = ent.has(f);
                return (
                  <li key={f} className="flex items-center justify-between gap-2" data-feature={f} data-enabled={on ? "1" : "0"}>
                    <span className={cn("flex items-center gap-2", on ? "text-fg" : "text-fg-subtle")}>
                      {on ? <Check aria-hidden="true" className="size-4 text-success" /> : <Lock aria-hidden="true" className="size-3.5" />}
                      {FEATURE_LABELS[f]}
                    </span>
                    {on ? <span className="sr-only">etkin</span> : <span className="text-xs text-fg-subtle">{PLANS[minimumPlanFor(f)].label}</span>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Limitler ve kullanım</CardTitle>
          <CardDescription>
            Aylık kullanım {usage.period.kind === "subscription" ? "abonelik dönemine" : "takvim ayına (UTC)"} göre: {formatDate(usage.period.start)} – {formatDate(new Date(usage.period.end.getTime() - 1))}.
            {LIMITS_PROVISIONAL ? " Limit değerleri geçicidir ve paket kararına göre güncellenebilir." : ""} Limit düşse de mevcut kayıtlarınız silinmez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="subscription-limits">
            {LIMIT_KEYS.map((key) => {
              const limit = ent.limits[key];
              const used = usage[key];
              const { percent, level } = usageLevel(limit, used);
              return (
                <li key={key} data-limit={key} data-level={level} data-used={used} data-max={limit ?? ""}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-fg">{LIMIT_LABELS[key]}</span>
                    <span className="tabular-nums text-fg-muted">
                      {fmtLimit(key, used)} / {limit === null ? "Sınırsız" : limit === 0 ? "Pakette yok" : fmtLimit(key, limit)}
                    </span>
                  </div>
                  {limit !== null && limit > 0 ? (
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent ?? 0)} aria-label={LIMIT_LABELS[key]}>
                      <div className={cn("h-full rounded-full", level >= 100 ? "bg-danger" : level >= 90 ? "bg-warning" : level >= 80 ? "bg-warning/70" : "bg-success")} style={{ width: `${Math.min(100, percent ?? 0)}%` }} />
                    </div>
                  ) : null}
                  {level >= 80 && limit ? (
                    <p className={cn("mt-1 text-xs", level >= 100 ? "text-danger" : "text-warning")} data-testid="limit-warning">
                      {level >= 100 ? "Limite ulaşıldı — yeni kayıt eklenemez." : `Limitin %${percent} kadarı kullanıldı.`}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <section aria-labelledby="plan-compare" className="mt-6">
        <h2 id="plan-compare" className="mb-3 text-base font-semibold text-fg">
          Paketleri karşılaştırın
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-bg">
          <table className="w-full min-w-[32rem] text-sm" data-testid="plan-compare">
            <caption className="sr-only">Paket özellikleri karşılaştırması</caption>
            <thead className="bg-surface">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">
                  Özellik
                </th>
                {cards.map((c) => (
                  <th key={c.plan} scope="col" className={cn("px-2 py-2.5 text-center text-xs font-medium uppercase tracking-wide", c.plan === ent.subscribedPlan ? "text-fg" : "text-fg-subtle")}>
                    {c.name}
                    {c.plan === ent.subscribedPlan ? <span className="block text-[0.625rem] normal-case">mevcut</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f} className="border-t border-border">
                  <th scope="row" className="px-4 py-2 text-left font-normal text-fg-muted">
                    {FEATURE_LABELS[f]}
                  </th>
                  {PLAN_ORDER.map((p) => (
                    <td key={p} className="px-2 py-2 text-center">
                      {planHasFeature(p, f) ? <Check aria-label="Dahil" className="mx-auto size-4 text-success" /> : <span aria-label="Dahil değil" className="text-fg-subtle">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-border">
                <th scope="row" className="px-4 py-2 text-left font-normal text-fg-muted">
                  Fiyat
                </th>
                {cards.map((c) => (
                  <td key={c.plan} className="px-2 py-2 text-center text-xs text-fg-subtle">
                    {c.priceLabel}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

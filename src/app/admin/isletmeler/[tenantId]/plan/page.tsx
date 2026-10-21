import { requireSuperAdminTenant } from "@/lib/auth/guards";
import { DEFAULT_TRIAL_DAYS, GRACE_DAYS } from "@/config/billing";
import { FEATURES, FEATURE_LABELS, LIMIT_KEYS, LIMIT_LABELS, PLANS, PLAN_ORDER, minimumPlanFor } from "@/config/plans";
import { usageLevel } from "@/lib/billing/engine";
import { EFFECTIVE_STATE_LABELS, EFFECTIVE_STATE_TONES, SUBSCRIPTION_EVENT_LABELS, SUBSCRIPTION_STATUS_LABELS } from "@/lib/billing/labels";
import { prisma } from "@/lib/db/prisma";
import { formatBytes, formatDate, formatDateTime, formatNumber } from "@/lib/utils/format";
import { changeTenantPlanAction } from "@/server/actions/tenant-admin.actions";
import {
  activateSubscriptionAction,
  extendTrialAction,
  removeOverrideAction,
  scheduleCancelAction,
  setOverrideAction,
  setPeriodEndAction,
  setSubscriptionStatusAction,
  startTrialAction,
} from "@/server/actions/subscription-admin.actions";
import { getUsage, resolveEntitlements } from "@/server/billing/entitlements";
import { ActionForm } from "@/components/billing/action-form";
import { PlanForm } from "@/components/dashboard/plan-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export const metadata = { title: "Abonelik & Plan" };

/**
 * Super Admin — kiracı aboneliği (MANUEL faturalama; ödeme sağlayıcısı yok). Paket / durum / deneme / dönem / iptal /
 * istisna değişiklikleri abonelik servisinden geçer: değiştirilemez olay geçmişi + denetim kaydı. Yetki anında değişir
 * (yeniden derleme / yeniden başlatma yok). Kart / ödeme verisi gösterilmez ve tutulmaz.
 */
export default async function TenantPlanPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenant } = await requireSuperAdminTenant((await params).tenantId);
  const [ent, overrides, events] = await Promise.all([
    resolveEntitlements(tenant.id),
    prisma.entitlementOverride.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } }),
    prisma.subscriptionEvent.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const usage = await getUsage(tenant.id, ent);
  const sub = ent.subscription;

  return (
    <div className="grid gap-6">
      <Card data-testid="admin-subscription" data-plan={ent.subscribedPlan} data-state={ent.state}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Abonelik · {PLANS[ent.subscribedPlan].label}
            <Badge tone={EFFECTIVE_STATE_TONES[ent.state]} dot>
              {EFFECTIVE_STATE_LABELS[ent.state]}
            </Badge>
            {sub ? <Badge tone="neutral">Kayıt: {SUBSCRIPTION_STATUS_LABELS[sub.status]}</Badge> : null}
            {ent.internal ? <Badge tone="neutral">Faturasız (iç)</Badge> : null}
            {ent.cancelScheduled ? <Badge tone="warning">Dönem sonunda iptal</Badge> : null}
          </CardTitle>
          <CardDescription>Manuel faturalama: değişiklikler anında geçerlidir ve olay geçmişine yazılır. Deneme bitince / ek süre ({GRACE_DAYS} gün) dolunca Starter özelliklerine düşülür; veri silinmez.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <dl className="grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-2 text-sm">
            <dt className="text-fg-subtle">Geçerli özellikler</dt>
            <dd className="font-medium">{PLANS[ent.effectivePlan].label}</dd>
            <dt className="text-fg-subtle">Başlangıç</dt>
            <dd>{sub ? formatDate(sub.startsAt) : "—"}</dd>
            <dt className="text-fg-subtle">Dönem</dt>
            <dd>{sub ? `${formatDate(sub.currentPeriodStart)} – ${sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "süresiz"}` : "—"}</dd>
            <dt className="text-fg-subtle">Deneme bitişi</dt>
            <dd>{sub?.trialEndsAt ? formatDateTime(sub.trialEndsAt) : "—"}</dd>
            <dt className="text-fg-subtle">Ek süre bitişi</dt>
            <dd>{ent.state === "GRACE" && ent.endsAt ? formatDateTime(ent.endsAt) : sub?.graceEndsAt ? formatDateTime(sub.graceEndsAt) : "—"}</dd>
          </dl>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">Özellik durumu</p>
            <ul className="flex flex-wrap gap-1.5" data-testid="admin-features">
              {FEATURES.map((f) => (
                <li key={f}>
                  <Badge tone={ent.has(f) ? "success" : "neutral"} data-feature={f} data-enabled={ent.has(f) ? "1" : "0"}>
                    {FEATURE_LABELS[f]}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Etkinleştir / yenile</CardTitle>
            <CardDescription>Ödemesi alınan dönem için paket ve bitiş tarihi. Boş tarih = süresiz. Ek süre ve planlı iptal temizlenir.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={activateSubscriptionAction.bind(null, tenant.id)} submitLabel="Etkinleştir" variant="primary" testId="sub-activate">
              <Field id="act-plan" label="Paket">
                <Select id="act-plan" name="plan" defaultValue={ent.subscribedPlan}>
                  {PLAN_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {PLANS[p].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="act-end" label="Dönem sonu (dahil)">
                <Input id="act-end" name="periodEnd" type="date" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="internal" defaultChecked={ent.internal} className="size-4 accent-primary" /> Faturasız iç / demo kiracı
              </label>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deneme</CardTitle>
            <CardDescription>Deneme yalnızca buradan başlatılır / uzatılır (panelden yapılamaz). Varsayılan {DEFAULT_TRIAL_DAYS} gün.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <ActionForm action={startTrialAction.bind(null, tenant.id)} submitLabel="Deneme başlat" testId="sub-trial" inline>
              <Field id="tr-plan" label="Paket">
                <Select id="tr-plan" name="plan" defaultValue="AI">
                  {PLAN_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {PLANS[p].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="tr-days" label="Gün">
                <Input id="tr-days" name="days" inputMode="numeric" defaultValue={String(DEFAULT_TRIAL_DAYS)} className="w-20" />
              </Field>
            </ActionForm>
            <ActionForm action={extendTrialAction.bind(null, tenant.id)} submitLabel="Denemeyi uzat" testId="sub-extend" inline>
              <Field id="ex-days" label="Ek gün">
                <Input id="ex-days" name="days" inputMode="numeric" defaultValue="7" className="w-20" />
              </Field>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dönem ve iptal</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <ActionForm action={setPeriodEndAction.bind(null, tenant.id)} submitLabel="Dönem sonunu kaydet" testId="sub-period" inline>
              <Field id="pe-end" label="Dönem sonu (dahil)">
                <Input id="pe-end" name="periodEnd" type="date" />
              </Field>
            </ActionForm>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={scheduleCancelAction.bind(null, tenant.id)} submitLabel="Dönem sonunda iptal et" testId="sub-cancel">
                <input type="hidden" name="cancel" value="true" />
              </ActionForm>
              <ActionForm action={scheduleCancelAction.bind(null, tenant.id)} submitLabel="Planlı iptali kaldır" testId="sub-uncancel">
                <input type="hidden" name="cancel" value="false" />
              </ActionForm>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Faturalama durumu</CardTitle>
            <CardDescription>“Ödeme gecikti” {GRACE_DAYS} günlük ek süre başlatır (menü / sipariş sürer, AI kapanır). Geri almak için “Etkinleştir”.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={setSubscriptionStatusAction.bind(null, tenant.id)} submitLabel="Durumu uygula" variant="danger" testId="sub-status" inline>
              <Field id="st-status" label="Durum">
                <Select id="st-status" name="status" defaultValue="PAST_DUE">
                  <option value="PAST_DUE">Ödeme gecikti (ek süre)</option>
                  <option value="SUSPENDED">Askıya al</option>
                  <option value="EXPIRED">Süresi doldu</option>
                  <option value="CANCELLED">İptal et (dönem sonuna kadar hak sürer)</option>
                </Select>
              </Field>
            </ActionForm>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kullanım ve limitler</CardTitle>
          <CardDescription>Aylık kullanım: {formatDate(usage.period.start)} – {formatDate(new Date(usage.period.end.getTime() - 1))}. Limitler geçicidir (ticari karar değil).</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2" data-testid="admin-usage">
            {LIMIT_KEYS.map((k) => {
              const limit = ent.limits[k];
              const used = usage[k];
              const fmt = (v: number) => (k === "maxMediaBytes" ? formatBytes(v) : formatNumber(v));
              return (
                <li key={k} className="flex justify-between gap-2" data-limit={k} data-level={usageLevel(limit, used).level}>
                  <span className="text-fg-muted">{LIMIT_LABELS[k]}</span>
                  <span className="tabular-nums">
                    {fmt(used)} / {limit === null ? "∞" : fmt(limit)}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>İstisnalar</CardTitle>
          <CardDescription>Paket tanımını değiştirmeden tek kiracıya özellik aç / kapa ya da limit değeri (boş = sınırsız). Süreli olabilir; gerekçe zorunlu ve denetlenir.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {overrides.length ? (
            <ul className="grid gap-2 text-sm" data-testid="admin-overrides">
              {overrides.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2" data-override={o.key}>
                  <span>
                    <span className="font-medium">{o.key in FEATURE_LABELS ? FEATURE_LABELS[o.key as keyof typeof FEATURE_LABELS] : LIMIT_LABELS[o.key as keyof typeof LIMIT_LABELS] ?? o.key}</span> ·{" "}
                    {o.enabled !== null ? (o.enabled ? "açık" : "kapalı") : o.limitValue !== null && o.limitValue < BigInt(0) ? "sınırsız" : `limit ${o.limitValue}`}
                    {o.expiresAt ? ` · ${formatDate(o.expiresAt)} tarihine kadar` : ""} · <span className="text-fg-subtle">{o.reason}</span>
                  </span>
                  <ActionForm action={removeOverrideAction.bind(null, tenant.id)} submitLabel="Kaldır">
                    <input type="hidden" name="key" value={o.key} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={setOverrideAction.bind(null, tenant.id)} submitLabel="İstisna ekle" testId="sub-override" inline>
            <Field id="ov-key" label="Özellik / limit">
              <Select id="ov-key" name="key" defaultValue="voice_ai">
                <optgroup label="Özellik">
                  {FEATURES.map((f) => (
                    <option key={f} value={f}>
                      {FEATURE_LABELS[f]} ({PLANS[minimumPlanFor(f)].label})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Limit">
                  {LIMIT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {LIMIT_LABELS[k]}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field id="ov-mode" label="Özellik">
              <Select id="ov-mode" name="mode" defaultValue="enable">
                <option value="enable">Aç</option>
                <option value="disable">Kapat</option>
              </Select>
            </Field>
            <Field id="ov-limit" label="Limit değeri">
              <Input id="ov-limit" name="limitValue" inputMode="numeric" placeholder="boş = sınırsız" className="w-32" />
            </Field>
            <Field id="ov-exp" label="Bitiş (isteğe bağlı)">
              <Input id="ov-exp" name="expiresAt" type="date" />
            </Field>
            <Field id="ov-reason" label="Gerekçe">
              <Input id="ov-reason" name="reason" maxLength={200} />
            </Field>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan & Özellikler</CardTitle>
          <CardDescription>Yalnızca paketi değiştirir (durum / dönem aynı kalır). Fiyat tanımlı değil.</CardDescription>
        </CardHeader>
        <CardContent>
          <PlanForm action={changeTenantPlanAction.bind(null, tenant.id)} current={ent.subscribedPlan} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Abonelik geçmişi</CardTitle>
          <CardDescription>Değiştirilemez olay kaydı (son 30).</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm" data-testid="subscription-events">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-0" data-type={e.type}>
                <span>
                  <span className="font-medium">{SUBSCRIPTION_EVENT_LABELS[e.type] ?? e.type}</span>
                  {e.fromPlan && e.toPlan && e.fromPlan !== e.toPlan ? ` · ${PLANS[e.fromPlan].label} → ${PLANS[e.toPlan].label}` : ""}
                  {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus ? ` · ${SUBSCRIPTION_STATUS_LABELS[e.fromStatus]} → ${SUBSCRIPTION_STATUS_LABELS[e.toStatus]}` : ""}
                </span>
                <span className="text-fg-subtle">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

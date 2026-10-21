import type { Metadata } from "next";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { minuteLabel } from "@/lib/reservations/time";
import { formatDateTime } from "@/lib/utils/format";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { addBlackoutAction, createCombinationAction, deleteBlackoutAction, deleteCombinationAction, saveOpeningHoursAction, saveReservationSettingsAction } from "@/server/actions/reservation.actions";
import { panelBranches } from "@/server/reservations/queries.service";
import { loadSettingsPage } from "@/server/reservations/settings.service";
import { BlackoutForm, CombinationForm, DeleteButton, HoursForm, PolicyForm } from "@/components/reservations/panel/reservation-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Rezervasyon ayarları" };

/** Kurallar (kiracı), açılış saatleri / kapalı dönemler / masa birleşimleri (şube). reservations.settings; destek salt okunur. */
export default async function ReservationSettingsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireTenantUser({ permission: "reservations.settings" });
  const params = await searchParams;
  const branches = await panelBranches(ctx.scope);
  const branch = branches.find((b) => b.id === param(params, "sube", 40)) ?? branches[0];
  if (!branch) notFound();
  const readOnly = !!ctx.support;
  const data = await loadSettingsPage(ctx.scope.tenantId, branch.id);
  const hoursDefaults = Array.from({ length: 7 }, (_, i) => {
    const day = data.hours.filter((h) => h.weekday === i + 1);
    return day.map((h) => `${minuteLabel(h.opensMinute)}-${h.closesMinute === 1440 ? "24:00" : minuteLabel(h.closesMinute)}`).join(",");
  });
  const noHours = data.hours.length === 0;
  const tablesWithoutCapacity = data.tables.filter((t) => !t.capacity).length;

  return (
    <>
      <Link href={`/panel/rezervasyonlar?sube=${branch.id}`} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" /> Rezervasyonlar
      </Link>
      <header className="pb-6">
        <h1 className="text-title font-semibold text-fg">Rezervasyon ayarları</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">
          Kurallar tüm şubeler için geçerlidir; saatler, kapalı dönemler ve masa birleşimleri şubeye özeldir ({branch.name}).
        </p>
        {data.policy.publicBookingEnabled ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-fg-muted">
            <ExternalLink aria-hidden="true" className="size-4" /> Müşteri sayfası: restoranınızın alan adında <code className="rounded bg-surface-2 px-1">/rezervasyon</code>
          </p>
        ) : null}
      </header>
      {readOnly ? <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">Destek modu: salt okunur.</p> : null}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Kurallar</CardTitle>
            <CardDescription>Varsayılan olarak kapalıdır. Tarih ve saatler şubenin saat diliminde hesaplanır.</CardDescription>
          </CardHeader>
          <CardContent>
            <PolicyForm action={saveReservationSettingsAction} policy={data.policy} disabled={readOnly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Açılış saatleri · {branch.name}</CardTitle>
            <CardDescription>{noHours ? "Saat tanımlanmadıkça bu şube rezervasyon kabul etmez. Örnek: 12:00-23:00." : "Rezervasyonlar yalnızca bu saatlerde başlar ve kapanıştan önce biter."}</CardDescription>
          </CardHeader>
          <CardContent>
            <HoursForm action={saveOpeningHoursAction.bind(null, branch.id)} defaults={noHours ? Array(7).fill("12:00-23:00") : hoursDefaults} disabled={readOnly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Masalar</CardTitle>
            <CardDescription>
              Rezervasyonda yalnızca kapasitesi girilmiş, “rezervasyona açık” masalar atanır. Kapasite ve en az kişi sayısını <Link href="/panel/masalar" className="underline">Masalar & QR</Link> sayfasından düzenleyin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tablesWithoutCapacity ? <p className="mb-3 text-sm text-warning">{tablesWithoutCapacity} masanın kapasitesi boş — bu masalar atanmaz.</p> : null}
            <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
              {data.tables.map((t) => (
                <li key={t.id} className="rounded-md border border-border px-3 py-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-xs text-fg-subtle">
                    {t.capacity ? `${t.capacity} kişilik` : "Kapasite yok"}
                    {t.area ? ` · ${t.area.name}` : ""}
                    {t.reservable ? "" : " · rez. kapalı"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Masa birleşimleri</CardTitle>
            <CardDescription>Büyük gruplar için birleştirilebilen masaları tanımlayın. Sistem yalnızca tanımlı birleşimleri kullanır.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.combinations.length ? (
              <ul className="mb-5 grid gap-2">
                {data.combinations.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{c.name}</span>
                      <span className="text-fg-subtle"> · {c.tables.map((t) => t.table.name).join(" + ")} · {c.tables.reduce((s, t) => s + (t.table.capacity ?? 0), 0)} kişi</span>
                    </span>
                    {readOnly ? null : <DeleteButton action={deleteCombinationAction.bind(null, c.id)} label={`${c.name} birleşimini kaldır`} confirmText="Birleşim kaldırılsın mı? Mevcut rezervasyonlar etkilenmez." />}
                  </li>
                ))}
              </ul>
            ) : null}
            <CombinationForm action={createCombinationAction.bind(null, branch.id)} tables={data.tables.map((t) => ({ id: t.id, name: t.name, capacity: t.capacity, area: t.area?.name ?? null }))} disabled={readOnly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kapalı dönemler</CardTitle>
            <CardDescription>Tatil, özel etkinlik ya da kapalı gün. Bu aralıklarda rezervasyon alınmaz (mevcut rezervasyonlar silinmez).</CardDescription>
          </CardHeader>
          <CardContent>
            {data.blackouts.length ? (
              <ul className="mb-5 grid gap-2">
                {data.blackouts.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <span>
                      <span className="tabular-nums">
                        {formatDateTime(b.startsAt)} → {formatDateTime(b.endsAt)}
                      </span>
                      {b.reason ? <span className="text-fg-subtle"> · {b.reason}</span> : null}
                    </span>
                    {readOnly ? null : <DeleteButton action={deleteBlackoutAction.bind(null, b.id)} label="Kapalı dönemi kaldır" confirmText="Kapalı dönem kaldırılsın mı?" />}
                  </li>
                ))}
              </ul>
            ) : null}
            <BlackoutForm action={addBlackoutAction.bind(null, branch.id)} disabled={readOnly} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

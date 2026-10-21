import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { hasPermission } from "@/lib/permissions/roles";
import { RESERVATION_SOURCE_LABELS, RESERVATION_STATUS_LABELS, RESERVATION_STATUS_TONES, canMarkNoShow, isActiveStatus, lateMinutes } from "@/lib/reservations/status";
import { localParts, minuteLabel } from "@/lib/reservations/time";
import { formatDateTime } from "@/lib/utils/format";
import { reassignTablesAction, reservationNoteAction } from "@/server/actions/reservation.actions";
import { getPolicy } from "@/server/reservations/context";
import { reassignOptions, reservationDetail } from "@/server/reservations/queries.service";
import { NoteForm, ReassignForm, StatusButtons } from "@/components/reservations/panel/reservation-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Rezervasyon" };

/**
 * Rezervasyon ayrıntısı — reservations.view. Tam iletişim yetkili personele; destek modunda maskeli ve salt okunur.
 * Özel istek / not HTML olarak işlenmez (React metni). Teknik kimlik / yönetim belirteci gösterilmez.
 */
export default async function ReservationDetailPage({ params }: { params: Promise<{ reservationId: string }> }) {
  const ctx = await requireTenantUser({ permission: "reservations.view" });
  const { reservationId } = await params;
  if (!/^[a-z0-9]{1,40}$/i.test(reservationId)) notFound();
  const support = !!ctx.support;
  const r = await reservationDetail(ctx.scope, reservationId, { reveal: !support });
  if (!r) notFound();
  const canManage = !support && hasPermission(ctx.user.role, "reservations.manage");
  const canOverride = !support && hasPermission(ctx.user.role, "reservations.override");
  const policy = await getPolicy(ctx.scope.tenantId);
  const now = new Date();
  const tz = r.branch.timezone;
  const start = localParts(r.startsAt, tz);
  const end = localParts(r.endsAt, tz);
  const late = lateMinutes(r, now);
  const active = isActiveStatus(r.status);
  const [options, branchTables] = canOverride && active
    ? await Promise.all([reassignOptions(ctx.scope, r.id), prisma.diningTable.findMany({ where: { tenantId: ctx.scope.tenantId, branchId: r.branchId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, capacity: true } })])
    : [[], []];
  const dateLabel = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${start.date}T12:00:00Z`));

  return (
    <>
      <Link href={`/panel/rezervasyonlar?sube=${r.branchId}&gun=${start.date}`} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden="true" className="size-4" /> Rezervasyonlar
      </Link>
      <header className="flex flex-col gap-3 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-title font-semibold text-fg" data-testid="reservation-guest">
            {r.guestName}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.9375rem] text-fg-subtle">
            <span className="capitalize">{dateLabel}</span> · <span className="tabular-nums">{minuteLabel(start.minute)}–{minuteLabel(end.minute)}</span> · {r.partySize} kişi · {r.branch.name}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={RESERVATION_STATUS_TONES[r.status]} dot data-testid="reservation-status" data-status={r.status}>
              {RESERVATION_STATUS_LABELS[r.status]}
            </Badge>
            <Badge tone="neutral">{RESERVATION_SOURCE_LABELS[r.source]}</Badge>
            {r.overridden ? <Badge tone="warning">Kural aşıldı (yönetici)</Badge> : null}
            {late ? <Badge tone="warning">{late} dk gecikti</Badge> : null}
          </p>
        </div>
        {canManage ? <StatusButtons id={r.id} status={r.status} noShowAllowed={canMarkNoShow(r, now, policy.noShowGraceMinutes)} /> : null}
      </header>

      {support ? <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">Destek modu: salt okunur, iletişim bilgileri maskelidir.</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Misafir</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-[0.9375rem]">
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">Telefon</dt>
                <dd className="tabular-nums" data-testid="reservation-phone">
                  {r.guestPhone ?? "—"}
                </dd>
              </div>
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">E-posta</dt>
                <dd className="break-all">{r.guestEmail ?? "—"}</dd>
              </div>
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">CRM</dt>
                <dd data-testid="reservation-crm">
                  {r.customer ? (
                    hasPermission(support ? "TENANT_OWNER" : ctx.user.role, "crm.view") ? (
                      <Link href={`/panel/musteriler/${r.customer.id}`} className="font-medium underline-offset-4 hover:underline">
                        {r.customer.name}
                      </Link>
                    ) : (
                      r.customer.name
                    )
                  ) : (
                    <span className="text-fg-subtle">Anonim rezervasyon (CRM profili yok)</span>
                  )}
                </dd>
              </div>
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">Özel istek</dt>
                <dd className="whitespace-pre-line break-words" data-testid="reservation-request">
                  {r.specialRequest ?? "—"}
                </dd>
              </div>
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">Bölge tercihi</dt>
                <dd>{r.preferredArea?.name ?? "Fark etmez"}</dd>
              </div>
              <div className="grid gap-0.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-fg-subtle">Süre</dt>
                <dd>
                  {r.durationMinutes} dk{r.bufferMinutes ? ` + ${r.bufferMinutes} dk hazırlık` : ""}
                </dd>
              </div>
            </dl>
            <div className="mt-6 border-t border-border pt-5">
              <NoteForm action={reservationNoteAction.bind(null, r.id)} defaultValue={r.internalNote ?? ""} disabled={!canManage} />
            </div>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Masa</CardTitle>
              <CardDescription>Atama sunucuda doğrulanır; aynı saatte dolu masaya atama yapılamaz.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-[0.9375rem] font-medium" data-testid="reservation-tables">
                {r.tables.length ? r.tables.map((t) => `${t.table.name}${t.table.area ? ` (${t.table.area.name})` : ""}`).join(" + ") : "Atanmamış"}
              </p>
              {canOverride && active ? (
                <div className="mt-4">
                  <ReassignForm action={reassignTablesAction.bind(null, r.id)} options={options.map((o) => ({ tableIds: o.tableIds, label: o.label, capacity: o.capacity }))} canOverride={canOverride} tables={branchTables} />
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Durum geçmişi</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-2 text-sm" data-testid="reservation-history">
                {r.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums text-fg-subtle">{formatDateTime(h.createdAt)}</span>
                    <span className="font-medium text-fg">{h.fromStatus ? `${RESERVATION_STATUS_LABELS[h.fromStatus]} → ` : ""}{RESERVATION_STATUS_LABELS[h.toStatus]}</span>
                    <span className="text-fg-muted">· {h.actorName}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

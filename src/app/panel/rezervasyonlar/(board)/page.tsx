import type { Metadata } from "next";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions/roles";
import { RESERVATION_SOURCE_LABELS, RESERVATION_STATUS_LABELS, RESERVATION_STATUS_TONES, canMarkNoShow, lateMinutes } from "@/lib/reservations/status";
import { addDays, isValidDate, localParts, minuteLabel, weekdayOf } from "@/lib/reservations/time";
import { param, type RawSearchParams } from "@/lib/utils/search-params";
import { cn } from "@/lib/utils/cn";
import { getPolicy, loadBranchContext } from "@/server/reservations/context";
import { listDay, monthSummary, panelBranches, timeline } from "@/server/reservations/queries.service";
import { StatusButtons, WalkInButton } from "@/components/reservations/panel/reservation-actions";
import { ReservationTimeline } from "@/components/reservations/panel/timeline";
import { MonthCalendar } from "@/components/reservations/panel/month-calendar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata: Metadata = { title: "Rezervasyonlar" };

const VIEWS = [
  { key: "liste", label: "Liste" },
  { key: "zaman", label: "Zaman çizelgesi" },
  { key: "takvim", label: "Takvim" },
] as const;
type View = (typeof VIEWS)[number]["key"];

/**
 * Rezervasyon panosu — reservations.view (sahip, müdür, garson, kasiyer; mutfak / bar yok). Görünürlük kiracı
 * düzeyinde; şube seçimi filtredir (personel → şube ataması henüz yok). Destek modu salt okunur.
 * Tarihler ŞUBE saat diliminde. Liste iletişimi maskeli.
 */
export default async function ReservationsBoard({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireTenantUser({ permission: "reservations.view" });
  const params = await searchParams;
  const role = ctx.support ? "TENANT_OWNER" : ctx.user.role;
  const canManage = !ctx.support && hasPermission(ctx.user.role, "reservations.manage");
  const canSettings = hasPermission(role, "reservations.settings");
  const branches = await panelBranches(ctx.scope);
  if (!branches.length) return <EmptyState icon={CalendarClock} title="Şube yok" description="Önce bir şube oluşturun." />;
  const branch = branches.find((b) => b.id === param(params, "sube", 40)) ?? branches[0]!;
  const now = new Date();
  const today = localParts(now, branch.timezone).date;
  const rawDate = param(params, "gun", 10);
  const date = rawDate && isValidDate(rawDate) ? rawDate : today;
  const rawView = param(params, "gorunum", 10);
  const view: View = rawView === "zaman" || rawView === "takvim" ? rawView : "liste";
  const policy = await getPolicy(ctx.scope.tenantId);
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ sube: branch.id, gun: date, gorunum: view, ...patch });
    return `/panel/rezervasyonlar?${q.toString()}`;
  };
  const rows = await listDay(ctx.scope, branch, date);
  const branchCtx = await loadBranchContext(ctx.scope.tenantId, branch.id);
  const counts = { total: rows.filter((r) => r.status !== "CANCELLED").length, guests: rows.filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW").reduce((s, r) => s + r.partySize, 0), seated: rows.filter((r) => r.status === "SEATED").length, waiting: rows.filter((r) => r.status === "PENDING").length };
  const dateTitle = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));

  return (
    <>
      <header className="flex flex-col gap-4 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-title font-semibold text-fg">Rezervasyonlar</h1>
          <p className="mt-1.5 text-[0.9375rem] capitalize text-fg-subtle" data-testid="board-date">
            {dateTitle} · {branch.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && policy.enabled ? (
            <>
              <WalkInButton branchId={branch.id} areas={branchCtx?.areas ?? []} />
              <Link href={`/panel/rezervasyonlar/yeni?sube=${branch.id}&gun=${date}`} className={buttonVariants({ variant: "primary" })}>
                <Plus aria-hidden="true" /> Yeni rezervasyon
              </Link>
            </>
          ) : null}
          {canSettings ? (
            <Link href={`/panel/rezervasyonlar/ayarlar?sube=${branch.id}`} className={buttonVariants({ variant: "ghost" })}>
              <Settings aria-hidden="true" /> Ayarlar
            </Link>
          ) : null}
        </div>
      </header>

      {ctx.support ? <p role="note" className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">Destek modu: salt okunur, iletişim bilgileri maskelidir.</p> : null}
      {!policy.enabled ? (
        <p role="note" className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-fg" data-testid="reservations-off">
          Rezervasyonlar kapalı. {canSettings ? <Link href={`/panel/rezervasyonlar/ayarlar?sube=${branch.id}`} className="font-medium underline">Ayarlar&apos;dan açın</Link> : "Sahip / müdür ayarlardan açabilir."}
        </p>
      ) : null}

      <nav aria-label="Gün ve görünüm" className="mb-5 flex flex-col gap-3 rounded-lg border border-border bg-bg p-3 shadow-xs md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ gun: addDays(date, -1) })} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Önceki gün">
            <ChevronLeft aria-hidden="true" />
          </Link>
          <Link href={href({ gun: today })} className={buttonVariants({ variant: date === today ? "primary" : "secondary", size: "md" })} aria-current={date === today ? "date" : undefined} data-testid="day-today">
            Bugün
          </Link>
          <Link href={href({ gun: addDays(today, 1) })} className={buttonVariants({ variant: date === addDays(today, 1) ? "primary" : "secondary", size: "md" })} data-testid="day-tomorrow">
            Yarın
          </Link>
          <Link href={href({ gun: addDays(date, 1) })} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Sonraki gün">
            <ChevronRight aria-hidden="true" />
          </Link>
          <form action="/panel/rezervasyonlar" method="get" className="flex items-center gap-2">
            <input type="hidden" name="sube" value={branch.id} />
            <input type="hidden" name="gorunum" value={view} />
            <label htmlFor="board-date" className="sr-only">
              Tarih
            </label>
            <input id="board-date" name="gun" type="date" defaultValue={date} className="h-11 rounded-md border border-border-strong bg-bg px-3 text-sm" />
            <button type="submit" className={buttonVariants({ variant: "secondary", size: "md" })}>
              Git
            </button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 1 ? (
            <form action="/panel/rezervasyonlar" method="get" className="flex items-center gap-2">
              <input type="hidden" name="gun" value={date} />
              <input type="hidden" name="gorunum" value={view} />
              <label htmlFor="board-branch" className="sr-only">
                Şube
              </label>
              <select id="board-branch" name="sube" defaultValue={branch.id} className="h-11 rounded-md border border-border-strong bg-bg px-3 text-sm">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonVariants({ variant: "secondary", size: "md" })}>
                Seç
              </button>
            </form>
          ) : null}
          <div role="tablist" aria-label="Görünüm" className="inline-flex rounded-md border border-border p-0.5">
            {VIEWS.map((v) => (
              <Link key={v.key} role="tab" aria-selected={view === v.key} href={href({ gorunum: v.key })} className={cn("inline-flex h-10 items-center rounded px-3 text-sm font-medium", view === v.key ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")} data-view={v.key}>
                {v.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      <section aria-label="Gün özeti" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Rezervasyon" value={counts.total} hint="İptaller hariç" />
        <StatCard label="Beklenen kişi" value={counts.guests} />
        <StatCard label="Masada" value={counts.seated} />
        <StatCard label="Onay bekleyen" value={counts.waiting} />
      </section>

      {view === "takvim" ? (
        <MonthCalendar month={date.slice(0, 7)} today={today} selected={date} counts={await monthSummary(ctx.scope, branch, date.slice(0, 7))} hrefFor={(d) => href({ gun: d, gorunum: "liste" })} />
      ) : view === "zaman" ? (
        await (async () => {
          const data = await timeline(ctx.scope, branch, date);
          const hours = data.hours.filter((h) => h.weekday === weekdayOf(date));
          const starts = [...hours.map((h) => h.opensMinute), ...data.blocks.map((b) => b.from)];
          const ends = [...hours.map((h) => h.closesMinute), ...data.blocks.map((b) => b.to)];
          const startMinute = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 600;
          const endMinute = ends.length ? Math.min(1440, Math.ceil(Math.max(...ends) / 60) * 60) : 1440;
          return <ReservationTimeline tables={data.tables} blocks={data.blocks} startMinute={startMinute} endMinute={Math.max(endMinute, startMinute + 120)} nowMinute={date === today ? localParts(now, branch.timezone).minute : null} />;
        })()
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Bu gün için rezervasyon yok" description={canManage ? "Yeni rezervasyon ya da walk-in ekleyebilirsiniz." : "Rezervasyonlar burada listelenir."} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Saat</TH>
              <TH>Misafir</TH>
              <TH className="text-right">Kişi</TH>
              <TH>Masa / bölge</TH>
              <TH>Durum</TH>
              <TH>Kaynak</TH>
              {canManage ? <TH>İşlem</TH> : null}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const late = lateMinutes(r, now);
              return (
                <TR key={r.id} data-reservation-row={r.status} data-guest={r.guestName}>
                  <TD label="Saat" className="whitespace-nowrap font-semibold tabular-nums">
                    {minuteLabel(r.localTime)}
                    {late ? (
                      <Badge tone="warning" className="ml-2" data-testid="late-badge">
                        {late} dk gecikti
                      </Badge>
                    ) : null}
                  </TD>
                  <TD label="Misafir">
                    <Link href={`/panel/rezervasyonlar/${r.id}`} className="font-semibold text-fg underline-offset-4 hover:underline">
                      {r.guestName}
                    </Link>
                    <span className="block text-xs tabular-nums text-fg-subtle">{r.guestPhone ?? "—"}</span>
                    {r.customerId ? <span className="block text-xs text-accent-strong">CRM müşterisi</span> : null}
                  </TD>
                  <TD label="Kişi" className="text-right tabular-nums">
                    {r.partySize}
                  </TD>
                  <TD label="Masa / bölge">
                    {r.tableNames.length ? r.tableNames.join(" + ") : "—"}
                    {r.areaNames.length ? <span className="block text-xs text-fg-subtle">{r.areaNames.join(", ")}</span> : null}
                  </TD>
                  <TD label="Durum">
                    <Badge tone={RESERVATION_STATUS_TONES[r.status]} dot>
                      {RESERVATION_STATUS_LABELS[r.status]}
                    </Badge>
                  </TD>
                  <TD label="Kaynak">{RESERVATION_SOURCE_LABELS[r.source]}</TD>
                  {canManage ? (
                    <TD label="İşlem">
                      <StatusButtons id={r.id} status={r.status} noShowAllowed={canMarkNoShow(r, now, policy.noShowGraceMinutes)} compact />
                    </TD>
                  ) : null}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}

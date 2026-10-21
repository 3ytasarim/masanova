import Link from "next/link";
import { RESERVATION_STATUS_LABELS, type ReservationStatusName } from "@/lib/reservations/status";
import { minuteLabel } from "@/lib/reservations/time";
import { cn } from "@/lib/utils/cn";

type Table = { id: string; name: string; capacity: number | null; reservable: boolean; area: { id: string; name: string } | null };
type Block = { tableId: string; id: string; guestName: string; partySize: number; status: ReservationStatusName; from: number; to: number };

const TONE: Record<ReservationStatusName, string> = {
  PENDING: "bg-amber-100 text-amber-950 ring-amber-300",
  CONFIRMED: "bg-sky-100 text-sky-950 ring-sky-300",
  SEATED: "bg-violet-100 text-violet-950 ring-violet-300",
  COMPLETED: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  CANCELLED: "bg-stone-100 text-stone-500 ring-stone-200",
  NO_SHOW: "bg-red-50 text-red-800 ring-red-200 line-through",
};

/**
 * Operasyon zaman çizelgesi: satır = masa (bölgeye göre gruplu), yatay eksen = saat. Sürükle-bırak YOK; bloklar
 * ayrıntıya bağlanır ve masa değişikliği sunucuda doğrulanan formla yapılır. Dar ekranda kendi içinde yatay kaydırılır.
 */
export function ReservationTimeline({ tables, blocks, startMinute, endMinute, nowMinute }: { tables: Table[]; blocks: Block[]; startMinute: number; endMinute: number; nowMinute: number | null }) {
  const span = Math.max(60, endMinute - startMinute);
  const hours: number[] = [];
  for (let m = Math.ceil(startMinute / 60) * 60; m <= endMinute; m += 60) hours.push(m);
  const pct = (m: number) => `${((Math.min(Math.max(m, startMinute), endMinute) - startMinute) / span) * 100}%`;
  const groups = new Map<string, { name: string; tables: Table[] }>();
  for (const t of tables) {
    const key = t.area?.id ?? "_";
    const g = groups.get(key) ?? { name: t.area?.name ?? "Bölgesiz", tables: [] };
    g.tables.push(t);
    groups.set(key, g);
  }

  return (
    <div className="relative overflow-x-auto rounded-lg border border-border bg-bg" data-testid="reservation-timeline">
      <div className="min-w-[56rem]">
        <div className="sticky top-0 z-10 grid grid-cols-[9rem_1fr] border-b border-border bg-surface text-xs text-fg-subtle">
          <div className="px-3 py-2 font-medium">Masa</div>
          <div className="relative h-8">
            {hours.map((h) => (
              <span key={h} className="absolute top-2 -translate-x-1/2 tabular-nums" style={{ left: pct(h) }}>
                {minuteLabel(h % 1440)}
              </span>
            ))}
          </div>
        </div>
        {[...groups.values()].map((g) => (
          <div key={g.name} role="rowgroup" aria-label={g.name}>
            <div className="border-b border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">{g.name}</div>
            {g.tables.map((t) => (
              <div key={t.id} className="grid grid-cols-[9rem_1fr] border-b border-border last:border-b-0" data-timeline-table={t.name}>
                <div className="px-3 py-2 text-sm">
                  <span className="font-medium text-fg">{t.name}</span>
                  <span className="block text-xs text-fg-subtle">{t.capacity ? `${t.capacity} kişilik` : "Kapasite yok"}{t.reservable ? "" : " · rez. kapalı"}</span>
                </div>
                <div className="relative min-h-12">
                  {hours.map((h) => (
                    <span key={h} aria-hidden="true" className="absolute inset-y-0 w-px bg-border/70" style={{ left: pct(h) }} />
                  ))}
                  {nowMinute !== null && nowMinute >= startMinute && nowMinute <= endMinute ? <span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-danger/70" style={{ left: pct(nowMinute) }} /> : null}
                  {blocks
                    .filter((b) => b.tableId === t.id)
                    .map((b) => (
                      <Link
                        key={b.id}
                        href={`/panel/rezervasyonlar/${b.id}`}
                        data-timeline-block={b.status}
                        title={`${minuteLabel(b.from % 1440)}–${minuteLabel(b.to % 1440)} · ${b.guestName} · ${b.partySize} kişi · ${RESERVATION_STATUS_LABELS[b.status]}`}
                        className={cn("absolute inset-y-1.5 overflow-hidden rounded-md px-2 py-1 text-xs ring-1 hover:z-10 hover:shadow-sm focus-visible:z-10", TONE[b.status])}
                        style={{ left: pct(b.from), width: `calc(${pct(b.to)} - ${pct(b.from)})` }}
                      >
                        <span className="block truncate font-semibold">{b.guestName}</span>
                        <span className="block truncate tabular-nums">
                          {minuteLabel(b.from % 1440)} · {b.partySize} kişi
                        </span>
                      </Link>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

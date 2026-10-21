import Link from "next/link";
import { addDays, weekdayOf } from "@/lib/reservations/time";
import { cn } from "@/lib/utils/cn";

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Hafif ay takvimi (kütüphanesiz): gün → rezervasyon / kişi sayısı; tıklayınca o günün listesi. */
export function MonthCalendar({ month, today, selected, counts, hrefFor }: { month: string; today: string; selected: string; counts: Map<string, { total: number; active: number; guests: number }>; hrefFor: (date: string) => string }) {
  const first = `${month}-01`;
  const lead = weekdayOf(first) - 1;
  const days: string[] = [];
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d);
  return (
    <div className="rounded-lg border border-border bg-bg p-3" data-testid="reservation-calendar">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-fg-subtle">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead${i}`} />
        ))}
        {days.map((d) => {
          const c = counts.get(d);
          return (
            <Link
              key={d}
              href={hrefFor(d)}
              data-calendar-day={d}
              aria-current={d === selected ? "date" : undefined}
              className={cn(
                "flex min-h-16 flex-col rounded-md border p-1.5 text-left text-xs transition-colors hover:border-fg-subtle/50",
                d === selected ? "border-fg bg-surface" : "border-border",
                d < today && "opacity-60",
              )}
            >
              <span className={cn("font-semibold tabular-nums", d === today && "text-accent-strong")}>{Number(d.slice(8))}</span>
              {c?.active ? (
                <span className="mt-auto tabular-nums text-fg">
                  {c.active} rez. · {c.guests} kişi
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Rezervasyon saatleri: kullanıcı ŞUBE saat diliminde yerel tarih + saat seçer, veritabanı UTC anı saklar.
 *
 * Yaz saati (DST):
 *   - "missing": ileri alınan saatteki yerel zaman (ör. Berlin 2026-03-29 02:30) YOKTUR → reddedilir / slot üretilmez.
 *   - "ambiguous": geri alınan saatte yerel zaman iki kez yaşanır (ör. 2026-10-25 02:30) → İLK geçiş seçilir
 *     (deterministik; belgelenmiştir). Slot listesinde aynı yerel saat iki kez gösterilmez.
 * Europe/Istanbul DST kullanmaz; testler Europe/Berlin ile yapılır.
 */
const MIN = 60_000;
const DAY = 86_400_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    fmtCache.set(timeZone, f);
  }
  return f;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string };
function parts(timeZone: string, at: number): Parts {
  const out: Record<string, string> = {};
  for (const p of fmt(timeZone).formatToParts(new Date(at))) if (p.type !== "literal") out[p.type] = p.value;
  return { year: +out.year!, month: +out.month!, day: +out.day!, hour: +out.hour!, minute: +out.minute!, second: +out.second!, weekday: out.weekday! };
}

/** Saat dilimi farkı (ms): yerel duvar saati − UTC. */
export function offsetMs(timeZone: string, at: number): number {
  const p = parts(timeZone, at);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export type ZonedResult = { kind: "ok"; at: Date } | { kind: "ambiguous"; at: Date; later: Date } | { kind: "missing" };

/** Yerel tarih + günün dakikası → UTC anı (DST'ye dayanıklı). */
export function zonedLocalToUtc(date: string, minuteOfDay: number, timeZone: string): ZonedResult {
  const m = DATE_RE.exec(date);
  if (!m || minuteOfDay < 0 || minuteOfDay >= 1440) return { kind: "missing" };
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) + minuteOfDay * MIN;
  const found = new Set<number>();
  for (const probe of [wall - 12 * 3600_000, wall, wall + 12 * 3600_000]) {
    const t = wall - offsetMs(timeZone, probe);
    if (offsetMs(timeZone, t) === wall - t) found.add(t);
  }
  const sorted = [...found].sort((a, b) => a - b);
  if (sorted.length === 0) return { kind: "missing" };
  if (sorted.length === 1) return { kind: "ok", at: new Date(sorted[0]!) };
  return { kind: "ambiguous", at: new Date(sorted[0]!), later: new Date(sorted[sorted.length - 1]!) };
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** UTC anının şube saat dilimindeki yerel tarihi, günün dakikası ve ISO hafta günü (1 = Pzt … 7 = Paz). */
export function localParts(at: Date, timeZone: string): { date: string; minute: number; weekday: number } {
  const p = parts(timeZone, at.getTime());
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { date, minute: p.hour * 60 + p.minute, weekday: WEEKDAY[p.weekday] ?? 1 };
}

/** "YYYY-MM-DD" için ISO hafta günü (takvim günü; saat diliminden bağımsız). */
export function weekdayOf(date: string): number {
  const m = DATE_RE.exec(date)!;
  const js = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date)!;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) + days * DAY).toISOString().slice(0, 10);
}

/** Yerel gün sınırları [00:00, ertesi 00:00) UTC (DST günlerinde 23 / 25 saat). */
export function localDayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  const first = (d: string) => {
    for (let minute = 0; minute < 240; minute++) {
      const r = zonedLocalToUtc(d, minute, timeZone);
      if (r.kind !== "missing") return r.at;
    }
    return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  };
  return { start: first(date), end: first(addDays(date, 1)) };
}

export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function parseMinuteLabel(label: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(label);
  return m ? +m[1]! * 60 + +m[2]! : null;
}

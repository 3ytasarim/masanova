/**
 * Saat dilimi güvenli takvim yardımcıları (saf). Analitikte "gün", "saat", "hafta günü" ve "ay" HER ZAMAN restoranın
 * saat diliminde hesaplanır — UTC günü kullanılmaz. Yaz saati geçişleri (23 / 25 saatlik günler) doğru işlenir:
 * yerel gece yarısının UTC anı, o güne ait ofsetle bulunur.
 */
export type LocalDate = { y: number; m: number; d: number };
export type LocalParts = LocalDate & { h: number; min: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Bir anın yerel takvim parçaları (ISO hafta günü: Pazartesi = 1 … Pazar = 7). */
export function localParts(timeZone: string, at: Date | number): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), h: Number(get("hour")), min: Number(get("minute")), weekday: WEEKDAYS[get("weekday")] ?? 1 };
}

/** Saat diliminin verilen andaki UTC ofseti (ms; yerel = UTC + ofset). */
export function offsetMs(timeZone: string, at: number): number {
  const p = localParts(timeZone, at);
  const sec = new Date(at).getUTCSeconds();
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, sec);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Yerel takvim gününün gece yarısının UTC anı (yaz saati geçiş günleri dahil). */
export function startOfLocalDay(timeZone: string, date: LocalDate): Date {
  const guess = Date.UTC(date.y, date.m - 1, date.d);
  const first = guess - offsetMs(timeZone, guess);
  return new Date(guess - offsetMs(timeZone, first));
}

export function localDateOf(timeZone: string, at: Date | number): LocalDate {
  const p = localParts(timeZone, at);
  return { y: p.y, m: p.m, d: p.d };
}

/** Takvim günü aritmetiği (saat diliminden bağımsız; gün taşmaları normalize edilir). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: Math.min(date.d, last) };
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function formatLocalDate(date: LocalDate): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

export function parseLocalDate(value: string | null | undefined): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const date = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const check = new Date(Date.UTC(date.y, date.m - 1, date.d));
  return check.getUTCFullYear() === date.y && check.getUTCMonth() + 1 === date.m && check.getUTCDate() === date.d && date.y >= 2000 && date.y <= 2100 ? date : null;
}

/** Saat dilimi adının geçerli olup olmadığı (IANA). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Yerel zaman damgası metni + ofset — CSV dışa aktarımında belirsizlik olmasın ("2026-10-11 14:05 +03:00"). */
export function formatLocalTimestamp(timeZone: string, at: Date): string {
  const p = localParts(timeZone, at);
  const off = Math.round(offsetMs(timeZone, at.getTime()) / 60_000);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${formatLocalDate(p)} ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")} ${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

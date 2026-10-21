import { addDays, addMonths, daysBetween, formatLocalDate, localDateOf, parseLocalDate, startOfLocalDay, type LocalDate } from "@/lib/analytics/time";

/**
 * Tarih aralıkları ve karşılaştırma dönemi (saf). Tüm sınırlar restoranın saat diliminde yerel gece yarısıdır;
 * aralık [start, end) yarı açıktır.
 *
 * Karşılaştırma ilkesi — "aynı uzunlukta, eşdeğer önceki dönem", devam eden dönemde ADİL karşılaştırma:
 *   aralık henüz bitmediyse (ör. Bugün, Son 7 gün, Bu ay) mevcut dönem `effectiveEnd = şimdi`ye kadar sayılır ve önceki
 *   dönem de AYNI geçen süreyle karşılaştırılır (bugün 14:00'e kadar ↔ dün 14:00'e kadar). Böylece yarım gün tam günle
 *   kıyaslanıp yapay düşüş gösterilmez.
 *     Bugün      ↔ dün (aynı saate kadar)
 *     Dün        ↔ önceki gün
 *     Son 7 / 30 ↔ hemen önceki 7 / 30 gün
 *     Bu ay      ↔ geçen ay (aynı gün sayısına kadar)
 *     Geçen ay   ↔ ondan önceki ay
 *     Özel       ↔ hemen önceki aynı uzunlukta dönem
 */
export const RANGE_KEYS = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

/** Kötüye kullanım sınırı: özel aralık en fazla 366 gün; CSV de bu sınıra tabidir. */
export const MAX_RANGE_DAYS = 366;

export type Granularity = "hour" | "day";

export type ResolvedRange = {
  key: RangeKey;
  timeZone: string;
  /** Yerel günler (dahil) — gösterim ve CSV adı için. */
  fromDate: LocalDate;
  toDate: LocalDate;
  start: Date;
  /** Aralığın takvim sonu (hariç). */
  end: Date;
  /** Veri sorgusunun gerçek sonu: min(end, şimdi). */
  effectiveEnd: Date;
  granularity: Granularity;
  previous: { start: Date; end: Date; fromDate: LocalDate; toDate: LocalDate };
};

export type RangeInput = { key?: string | null; from?: string | null; to?: string | null };

export type RangeError = "invalid_dates" | "range_too_long" | "future";

export function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === "string" && (RANGE_KEYS as readonly string[]).includes(value);
}

function window(timeZone: string, from: LocalDate, toInclusive: LocalDate) {
  return { start: startOfLocalDay(timeZone, from), end: startOfLocalDay(timeZone, addDays(toInclusive, 1)) };
}

export function resolveRange(input: RangeInput, timeZone: string, now: Date = new Date()): { ok: true; range: ResolvedRange } | { ok: false; error: RangeError } {
  const key: RangeKey = isRangeKey(input.key) ? input.key : "today";
  const today = localDateOf(timeZone, now);
  let from: LocalDate;
  let to: LocalDate;
  let prevFrom: LocalDate;
  let prevTo: LocalDate;

  switch (key) {
    case "today":
      from = to = today;
      prevFrom = prevTo = addDays(today, -1);
      break;
    case "yesterday":
      from = to = addDays(today, -1);
      prevFrom = prevTo = addDays(today, -2);
      break;
    case "last7":
    case "last30": {
      const n = key === "last7" ? 7 : 30;
      from = addDays(today, -(n - 1));
      to = today;
      prevFrom = addDays(from, -n);
      prevTo = addDays(from, -1);
      break;
    }
    case "thisMonth": {
      from = { y: today.y, m: today.m, d: 1 };
      to = addDays(addMonths(from, 1), -1);
      prevFrom = addMonths(from, -1);
      prevTo = addDays(from, -1);
      break;
    }
    case "lastMonth": {
      const thisMonth = { y: today.y, m: today.m, d: 1 };
      from = addMonths(thisMonth, -1);
      to = addDays(thisMonth, -1);
      prevFrom = addMonths(from, -1);
      prevTo = addDays(from, -1);
      break;
    }
    case "custom": {
      const f = parseLocalDate(input.from);
      const t = parseLocalDate(input.to);
      if (!f || !t || daysBetween(f, t) < 0) return { ok: false, error: "invalid_dates" };
      if (daysBetween(f, t) + 1 > MAX_RANGE_DAYS) return { ok: false, error: "range_too_long" };
      if (daysBetween(today, f) > 0) return { ok: false, error: "future" };
      from = f;
      to = t;
      const len = daysBetween(f, t) + 1;
      prevTo = addDays(f, -1);
      prevFrom = addDays(f, -len);
      break;
    }
  }

  const { start, end } = window(timeZone, from, to);
  const effectiveEnd = new Date(Math.min(end.getTime(), now.getTime()));
  const prev = window(timeZone, prevFrom, prevTo);
  // Devam eden dönem: önceki dönemi de aynı geçen süreyle sınırla (adil karşılaştırma).
  const elapsed = effectiveEnd.getTime() - start.getTime();
  const prevEnd = new Date(Math.min(prev.end.getTime(), prev.start.getTime() + Math.max(0, elapsed)));
  const days = daysBetween(from, to) + 1;
  return {
    ok: true,
    range: {
      key,
      timeZone,
      fromDate: from,
      toDate: to,
      start,
      end,
      effectiveEnd,
      granularity: days <= 2 ? "hour" : "day",
      previous: { start: prev.start, end: prevEnd, fromDate: prevFrom, toDate: prevTo },
    },
  };
}

export function rangeLabel(range: Pick<ResolvedRange, "fromDate" | "toDate">): string {
  const a = formatLocalDate(range.fromDate);
  const b = formatLocalDate(range.toDate);
  return a === b ? a : `${a} – ${b}`;
}

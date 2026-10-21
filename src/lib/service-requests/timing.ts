import { urgencyFor, type Urgency } from "@/lib/orders/routing";

/**
 * Yanıt / tamamlama süreleri ve aciliyet. Ön salon eşikleri KDS'ten kısadır (varsayılan; ileride işletme ayarı).
 *   yanıt süresi      = oluşturma → üstlenme
 *   tamamlanma süresi = oluşturma → tamamlama
 */
export const SERVICE_URGENCY = { warningMinutes: 3, criticalMinutes: 7 } as const;

export function serviceUrgency(waitingMs: number, thresholds: { warningMinutes: number; criticalMinutes: number } = SERVICE_URGENCY): Urgency {
  return urgencyFor(waitingMs, thresholds);
}

type Timestamps = { createdAt: Date; acknowledgedAt: Date | null; completedAt: Date | null };

export function responseMs(r: Timestamps): number | null {
  return r.acknowledgedAt ? Math.max(0, r.acknowledgedAt.getTime() - r.createdAt.getTime()) : null;
}

export function completionMs(r: Timestamps): number | null {
  return r.completedAt ? Math.max(0, r.completedAt.getTime() - r.createdAt.getTime()) : null;
}

export function averageMs(values: readonly (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

/** "45 sn", "2 dk 05 sn", "1 sa 04 dk" — panel metrikleri için kısa süre. */
export function formatDurationShort(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} sa ${String(m).padStart(2, "0")} dk`;
  if (m) return `${m} dk ${String(s).padStart(2, "0")} sn`;
  return `${s} sn`;
}

// ─── Restoran günü (şube saat dilimine göre; UTC günü değil) ────────────────

function offsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(at))
    .reduce<Record<string, number>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Verilen saat diliminde "bugün"ün [başlangıç, bitiş) anları (gece yarısı yerel saat; yaz saati geçişleri dahil). */
export function zonedDayBounds(timeZone: string, now = new Date()): { start: Date; end: Date } {
  const local = new Date(now.getTime() + offsetMs(timeZone, now.getTime()));
  const midnightGuess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = midnightGuess - offsetMs(timeZone, midnightGuess - offsetMs(timeZone, midnightGuess));
  const nextGuess = midnightGuess + 24 * 3600 * 1000;
  const end = nextGuess - offsetMs(timeZone, nextGuess - offsetMs(timeZone, nextGuess));
  return { start: new Date(start), end: new Date(end) };
}

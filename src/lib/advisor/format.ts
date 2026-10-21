import type { MetricUnit } from "@/lib/advisor/types";

/** Danışman biçimleyicileri (TR). AI doğrulaması da AYNI biçimleri kullanır — izin verilen sayılar buradan türer. */
export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} sa ${String(m).padStart(2, "0")} dk`;
  if (m) return `${m} dk ${String(s).padStart(2, "0")} sn`;
  return `${s} sn`;
}

export function fmtMoney(minor: number | null, currency: string): string {
  if (minor === null || !Number.isFinite(minor)) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(minor / 100));
}

export function fmtCount(n: number | null): string {
  return n === null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("tr-TR").format(Math.round(n));
}

/** İşaretli yüzde: +%12, −%8 (tam sayı). */
export function fmtPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const r = Math.round(pct);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}%${Math.abs(r)}`;
}

/** Oran → yüzde (0.42 → %42). */
export function fmtShare(share: number | null): string {
  return share === null || !Number.isFinite(share) ? "—" : `%${Math.round(share * 100)}`;
}

export function hourRange(startHour: number, hours = 2): string {
  const end = (startHour + hours) % 24;
  return `${String(startHour).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`;
}

export function fmtMetric(value: number | null | undefined, unit: MetricUnit, currency: string): string {
  if (value == null) return "—";
  switch (unit) {
    case "count":
      return fmtCount(value);
    case "money":
      return fmtMoney(value, currency);
    case "duration":
      return fmtDuration(value);
    case "percent":
      return `%${Math.round(value)}`;
    case "share":
      return fmtShare(value);
    case "score":
      return String(value);
  }
}

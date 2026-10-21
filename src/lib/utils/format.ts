const numberFormatter = new Intl.NumberFormat("tr-TR");
const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDateTime(value: Date): string {
  return dateTimeFormatter.format(value);
}

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" });

/** Yalnızca tarih (abonelik dönemleri; mantık mutlak zamandır, gösterim yerel). */
export function formatDate(value: Date): string {
  return dateFormatter.format(value);
}

/** Bayt → okunur (MB / GB). */
export function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${numberFormatter.format(Math.round((value / 1024 ** 3) * 10) / 10)} GB`;
  return `${numberFormatter.format(Math.round(value / 1024 ** 2))} MB`;
}

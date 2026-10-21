/**
 * URL arama parametrelerini güvenle okuma (sayfa listeleri GET formlarıyla filtrelenir).
 * Bilinmeyen değerler yok sayılır; hiçbir değer doğrudan sorguya gitmez.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

export function param(params: RawSearchParams, key: string, maxLength = 200): string | undefined {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export function enumParam<T extends string>(params: RawSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const value = param(params, key, 64);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function pageParam(params: RawSearchParams, key = "sayfa"): number {
  const n = Number(param(params, key, 6));
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/** "YYYY-MM-DD" → Europe/Istanbul gün başlangıcı (UTC Date). Geçersizse undefined. */
export function dateParam(params: RawSearchParams, key: string, endOfDay = false): Date | undefined {
  const value = param(params, key, 10);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00+03:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

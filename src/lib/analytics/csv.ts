/**
 * CSV üretimi (saf). Formül enjeksiyonu: metin hücresi =, +, -, @, TAB ya da CR ile başlıyorsa başına tek tırnak
 * eklenir (Excel / Sheets formül olarak yorumlamaz). Tüm metin hücreleri tırnak içinde, iç tırnaklar çiftlenir.
 * Sayılar (tamsayı süreler, kuruş tutarlar) olduğu gibi yazılır.
 */
const DANGEROUS = /^[=+\-@\t\r]/;

export type CsvCell = string | number | null | undefined;

export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value.replace(/\r?\n/g, " ");
  if (DANGEROUS.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(cells: readonly CsvCell[]): string {
  return `${cells.map(escapeCsvCell).join(",")}\r\n`;
}

/** Excel'in UTF-8'i (Türkçe karakterler) doğru açması için bayt sırası işareti. */
export const CSV_BOM = "﻿";

/** Tutarlar CSV'de kuruş tamsayısı + ayrıca okunur ondalık sütun (float hesaplama yok; yalnızca biçim). */
export function minorToDecimalString(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Dışa aktarım satır üst sınırı (bellek / süre koruması). */
export const CSV_MAX_ROWS = 50_000;

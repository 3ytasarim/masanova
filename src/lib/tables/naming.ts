/**
 * Toplu masa adlandırma — saf kurallar (servis ve testler aynı fonksiyonu kullanır).
 * "Masa {n}", başlangıç 1, adet 20 → Masa 1 … Masa 20. Kalıpta {n} yoksa ad sonuna boşlukla numara eklenir.
 */

/** Tek işlemde en fazla oluşturulabilecek masa (yanlışlıkla 100.000 masa oluşmasın). */
export const BULK_TABLE_MAX = 200;
/** Bir şubedeki toplam masa üst sınırı (büyük mekânlar dahil makul sınır). */
export const BRANCH_TABLE_LIMIT = 1000;
export const TABLE_NUMBER_MAX = 9999;
export const DEFAULT_TABLE_PATTERN = "Masa {n}";

export function formatTableName(pattern: string, n: number): string {
  const trimmed = pattern.trim();
  return trimmed.includes("{n}") ? trimmed.replaceAll("{n}", String(n)) : `${trimmed} ${n}`;
}

/** Ad karşılaştırması büyük/küçük harf duyarsız (Türkçe kurallarıyla): "masa 1" ile "Masa 1" çakışır. */
export function tableNameKey(name: string): string {
  return name.trim().toLocaleLowerCase("tr-TR");
}

export type BulkTablePlan =
  | { ok: true; tables: { name: string; number: number }[] }
  | { ok: false; reason: "range"; message: string }
  | { ok: false; reason: "limit"; message: string }
  | { ok: false; reason: "conflict"; message: string; names: string[]; numbers: number[] };

export function planBulkTables(
  input: { count: number; startNumber: number; pattern: string },
  existing: { names: Iterable<string>; numbers: Iterable<number | null>; total: number },
): BulkTablePlan {
  const endNumber = input.startNumber + input.count - 1;
  if (input.count < 1 || input.count > BULK_TABLE_MAX) {
    return { ok: false, reason: "range", message: `Tek seferde 1–${BULK_TABLE_MAX} masa oluşturulabilir.` };
  }
  if (input.startNumber < 1 || endNumber > TABLE_NUMBER_MAX) {
    return { ok: false, reason: "range", message: `Masa numaraları 1–${TABLE_NUMBER_MAX} arasında olmalı.` };
  }
  if (existing.total + input.count > BRANCH_TABLE_LIMIT) {
    return { ok: false, reason: "limit", message: `Bir şubede en fazla ${BRANCH_TABLE_LIMIT} masa olabilir (şu an ${existing.total}).` };
  }

  const nameKeys = new Set([...existing.names].map(tableNameKey));
  const usedNumbers = new Set([...existing.numbers].filter((n): n is number => n !== null));
  const tables: { name: string; number: number }[] = [];
  const conflictNames: string[] = [];
  const conflictNumbers: number[] = [];
  const planned = new Set<string>();

  for (let n = input.startNumber; n <= endNumber; n++) {
    const name = formatTableName(input.pattern, n);
    const key = tableNameKey(name);
    if (nameKeys.has(key) || planned.has(key)) conflictNames.push(name);
    if (usedNumbers.has(n)) conflictNumbers.push(n);
    planned.add(key);
    tables.push({ name, number: n });
  }

  if (conflictNames.length || conflictNumbers.length) {
    const sample = [...conflictNames.slice(0, 3), ...conflictNumbers.slice(0, 3).map((n) => `No ${n}`)].join(", ");
    return {
      ok: false,
      reason: "conflict",
      message: `Bu şubede zaten var: ${sample}${conflictNames.length + conflictNumbers.length > 6 ? "…" : ""}. Başlangıç numarasını ya da kalıbı değiştirin.`,
      names: conflictNames,
      numbers: conflictNumbers,
    };
  }
  return { ok: true, tables };
}

/** Mevcut numaralardan sonraki boş numara (toplu oluşturma formunun varsayılan başlangıcı). */
export function nextTableNumber(numbers: Iterable<number | null>): number {
  let max = 0;
  for (const n of numbers) if (n !== null && n > max) max = n;
  return Math.min(max + 1, TABLE_NUMBER_MAX);
}

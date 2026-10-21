import { addDays, formatLocalDate, localDateOf, localParts, type LocalDate } from "@/lib/analytics/time";
import type { Granularity } from "@/lib/analytics/range";

/**
 * Analitik hesap kuralları (saf) — panel, CSV ve testler AYNI tanımları kullanır.
 */

// ─── Sipariş tutarı tanımı ──────────────────────────────────────────────────
/**
 * "Sipariş Tutarı" (MasaNova Sipariş Toplamı) — muhasebe / net ciro DEĞİLDİR (vergi, iade, ödeme mutabakatı modellenmez):
 *   - yalnızca restoran tarafından KABUL EDİLMİŞ siparişler (acceptedAt dolu) — kabul bekleyen SUBMITTED sayılmaz
 *   - REJECTED ve CANCELLED (kabulden sonra iptal edilenler dahil) HARİÇ
 *   - tutar, sipariş anında kaydedilen `totalMinor` (fiyat değişse de tarihsel değer değişmez)
 *   - dönem ataması `submittedAt` (siparişin verildiği an) — restoran saat diliminde
 * Hunide (funnel) ise tüm gönderilen siparişler ve her aşamaya ULAŞILIP ulaşılmadığı (zaman damgaları) gösterilir.
 */
export const SALES_STATUSES = ["ACCEPTED", "PREPARING", "READY", "SERVED"] as const;
export const EXCLUDED_FROM_SALES = ["SUBMITTED", "REJECTED", "CANCELLED"] as const;

export function countsAsSale(order: { status: string; acceptedAt: Date | null }): boolean {
  return order.acceptedAt !== null && (SALES_STATUSES as readonly string[]).includes(order.status);
}

// ─── Karşılaştırma ─────────────────────────────────────────────────────────
export type Comparison = {
  current: number;
  previous: number;
  diff: number;
  /** Yüzde değişim; önceki dönem 0 ise ya da veri çok azsa null (Infinity / anlamsız yüzde gösterilmez). */
  pct: number | null;
  trend: "up" | "down" | "flat";
  /** Önceki dönem anlamlı karşılaştırma için çok küçük (yüzde vurgulanmaz). */
  lowData: boolean;
};

export function compare(current: number, previous: number, options: { minBaseline?: number } = {}): Comparison {
  const minBaseline = options.minBaseline ?? 1;
  const diff = current - previous;
  const trend = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const lowData = previous < minBaseline || (current === 0 && previous === 0);
  const pct = previous > 0 && !lowData ? Math.round((diff / previous) * 1000) / 10 : null;
  return { current, previous, diff, pct, trend, lowData };
}

/** Sayım karşılaştırmalarında yüzde için en az önceki dönem değeri (tek siparişten "%100 artış" çıkmasın). */
export const MIN_COUNT_BASELINE = 5;

// ─── İstatistik ─────────────────────────────────────────────────────────────
/** Doğrusal enterpolasyonlu yüzdelik (PostgreSQL percentile_cont ile aynı tanım). */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  const rank = p * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return xs[lo]! + (xs[hi]! - xs[lo]!) * (rank - lo);
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}

/** p90 yalnızca yeterli örnekle gösterilir (az veride aşırı vurgu yok). */
export const MIN_SAMPLES_FOR_P90 = 10;
/** Saat × gün ısı haritası için en az sipariş (seyrek veride anlamsız harita çizilmez). */
export const MIN_ORDERS_FOR_HEATMAP = 20;
/** Menü dörtlü tablosu için en az ürün. */
export const MIN_PRODUCTS_FOR_QUADRANT = 4;

/** Para: tamsayı kuruş toplamı (float yok). */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isInteger(v)) throw new Error("money_must_be_integer_minor_units");
    total += v;
  }
  return total;
}

/** Ortalama sepet (kuruş, tamsayıya yuvarlanır); sipariş yoksa null (0/0 yok). */
export function averageMinor(totalMinor: number, count: number): number | null {
  return count > 0 ? Math.round(totalMinor / count) : null;
}

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

// ─── Zaman kovaları ─────────────────────────────────────────────────────────
/** Kova anahtarı (yerel): saatlik "YYYY-MM-DD HH", günlük "YYYY-MM-DD" — SQL tarafı aynı biçimi üretir. */
export function bucketKey(timeZone: string, at: Date, granularity: Granularity): string {
  const p = localParts(timeZone, at);
  const day = formatLocalDate(p);
  return granularity === "hour" ? `${day} ${String(p.h).padStart(2, "0")}` : day;
}

/**
 * [start, end) aralığındaki TÜM kovalar (boş kovalar 0 ile doldurulsun diye). Yaz saati: ileri alınan günde atlanan
 * saat görünmez, geri alınan günde tekrar eden saat tek kovada birleşir (yerel duvar saati).
 */
export function bucketKeys(timeZone: string, start: Date, end: Date, granularity: Granularity): string[] {
  const keys: string[] = [];
  if (granularity === "day") {
    let d: LocalDate = localDateOf(timeZone, start);
    const last = localDateOf(timeZone, new Date(end.getTime() - 1));
    for (let i = 0; i < 400; i++) {
      keys.push(formatLocalDate(d));
      if (formatLocalDate(d) === formatLocalDate(last)) break;
      d = addDays(d, 1);
    }
    return keys;
  }
  const seen = new Set<string>();
  for (let t = start.getTime(); t < end.getTime(); t += 3_600_000) {
    const k = bucketKey(timeZone, new Date(t), "hour");
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

export function fillBuckets<T extends { key: string }>(keys: readonly string[], rows: readonly T[], empty: (key: string) => T): T[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return keys.map((k) => byKey.get(k) ?? empty(k));
}

// ─── Menü dörtlü tablosu (kârlılık DEĞİL) ─────────────────────────────────────
export type QuadrantKey = "highQtyHighValue" | "highQtyLowValue" | "lowQtyHighValue" | "lowQtyLowValue";

/**
 * Satış adedi × ortalama birim değer (sipariş tutarı katkısı). Maliyet modellenmediği için kâr / marj DEĞİLDİR.
 * Eşikler ürünlerin medyanıdır (göreli sınıflama).
 */
export function classifyQuadrants<T extends { quantity: number; avgUnitMinor: number }>(items: readonly T[]): Record<QuadrantKey, T[]> | null {
  const out: Record<QuadrantKey, T[]> = { highQtyHighValue: [], highQtyLowValue: [], lowQtyHighValue: [], lowQtyLowValue: [] };
  if (items.length < MIN_PRODUCTS_FOR_QUADRANT) return null;
  const qMed = median(items.map((i) => i.quantity))!;
  const vMed = median(items.map((i) => i.avgUnitMinor))!;
  for (const i of items) {
    const highQ = i.quantity >= qMed;
    const highV = i.avgUnitMinor >= vMed;
    out[highQ ? (highV ? "highQtyHighValue" : "highQtyLowValue") : highV ? "lowQtyHighValue" : "lowQtyLowValue"].push(i);
  }
  return out;
}

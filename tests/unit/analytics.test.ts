import { describe, expect, it } from "vitest";
import { addDays, addMonths, formatLocalTimestamp, localParts, parseLocalDate, startOfLocalDay } from "@/lib/analytics/time";
import { MAX_RANGE_DAYS, resolveRange } from "@/lib/analytics/range";
import { averageMinor, bucketKey, bucketKeys, classifyQuadrants, compare, countsAsSale, fillBuckets, median, MIN_COUNT_BASELINE, percentile, ratio, sumMinor } from "@/lib/analytics/metrics";
import { csvRow, escapeCsvCell, minorToDecimalString } from "@/lib/analytics/csv";
import { analyticsLabels } from "@/lib/analytics/labels";
import { hasPermission } from "@/lib/permissions/roles";

/** Sprint 12 — analitik saf kuralları: tarih aralıkları, saat dilimi / DST, karşılaştırma, istatistik, CSV, yetki. */
const IST = "Europe/Istanbul";
const BER = "Europe/Berlin";

describe("saat dilimi ve takvim", () => {
  it("yerel gece yarısı: İstanbul (UTC+3, DST yok)", () => {
    expect(startOfLocalDay(IST, { y: 2026, m: 6, d: 15 }).toISOString()).toBe("2026-06-14T21:00:00.000Z");
    expect(localParts(IST, new Date("2026-06-14T21:30:00Z"))).toMatchObject({ y: 2026, m: 6, d: 15, h: 0, weekday: 1 });
  });

  it("DST: Berlin 29 Mart 2026 (23 saatlik gün) ve 25 Ekim 2026 (25 saatlik gün)", () => {
    const spring = startOfLocalDay(BER, { y: 2026, m: 3, d: 29 });
    const springNext = startOfLocalDay(BER, { y: 2026, m: 3, d: 30 });
    expect(spring.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect((springNext.getTime() - spring.getTime()) / 3_600_000).toBe(23);
    const fall = startOfLocalDay(BER, { y: 2026, m: 10, d: 25 });
    const fallNext = startOfLocalDay(BER, { y: 2026, m: 10, d: 26 });
    expect((fallNext.getTime() - fall.getTime()) / 3_600_000).toBe(25);
    // Saatlik kovalar: ileri alınan günde 23, geri alınan günde (tekrar eden saat birleşir) 24 yerel saat
    expect(bucketKeys(BER, spring, springNext, "hour")).toHaveLength(23);
    expect(bucketKeys(BER, spring, springNext, "hour")).not.toContain("2026-03-29 02");
    expect(bucketKeys(BER, fall, fallNext, "hour")).toHaveLength(24);
  });

  it("takvim aritmetiği ve tarih ayrıştırma", () => {
    expect(addDays({ y: 2026, m: 3, d: 1 }, -1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(addMonths({ y: 2026, m: 3, d: 31 }, -1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-13-01")).toBeNull();
    expect(parseLocalDate("x")).toBeNull();
    expect(formatLocalTimestamp(IST, new Date("2026-06-15T11:05:00Z"))).toBe("2026-06-15 14:05 +03:00");
    expect(formatLocalTimestamp(BER, new Date("2026-01-15T11:05:00Z"))).toBe("2026-01-15 12:05 +01:00");
  });
});

describe("tarih aralıkları ve karşılaştırma dönemi", () => {
  const NOW = new Date("2026-06-15T15:00:00Z"); // İstanbul 18:00

  it("Bugün ↔ dün AYNI SAATE kadar (yarım gün tam günle kıyaslanmaz)", () => {
    const r = resolveRange({ key: "today" }, IST, NOW);
    if (!r.ok) throw new Error();
    expect(r.range.start.toISOString()).toBe("2026-06-14T21:00:00.000Z");
    expect(r.range.effectiveEnd.toISOString()).toBe(NOW.toISOString());
    expect(r.range.previous.start.toISOString()).toBe("2026-06-13T21:00:00.000Z");
    expect(r.range.previous.end.toISOString()).toBe("2026-06-14T15:00:00.000Z");
    expect(r.range.granularity).toBe("hour");
  });

  it("Dün, son 7 / 30 gün, bu ay, geçen ay", () => {
    const y = resolveRange({ key: "yesterday" }, IST, NOW);
    expect(y.ok && y.range.previous.end.getTime() - y.range.previous.start.getTime()).toBe(24 * 3_600_000);
    const w = resolveRange({ key: "last7" }, IST, NOW);
    expect(w.ok && w.range.fromDate).toEqual({ y: 2026, m: 6, d: 9 });
    expect(w.ok && w.range.previous.fromDate).toEqual({ y: 2026, m: 6, d: 2 });
    expect(w.ok && w.range.granularity).toBe("day");
    const m = resolveRange({ key: "thisMonth" }, IST, NOW);
    expect(m.ok && m.range.previous.fromDate).toEqual({ y: 2026, m: 5, d: 1 });
    // bu ay 15 gün + 18 saat geçti → geçen ay da aynı süreyle sınırlı
    expect(m.ok && m.range.previous.end.getTime() - m.range.previous.start.getTime()).toBe(m.ok ? m.range.effectiveEnd.getTime() - m.range.start.getTime() : 0);
    const lm = resolveRange({ key: "lastMonth" }, IST, NOW);
    expect(lm.ok && [lm.range.fromDate, lm.range.toDate]).toEqual([{ y: 2026, m: 5, d: 1 }, { y: 2026, m: 5, d: 31 }]);
    expect(lm.ok && lm.range.previous.fromDate).toEqual({ y: 2026, m: 4, d: 1 });
  });

  it("özel aralık: sınırlar ve kötüye kullanım", () => {
    expect(resolveRange({ key: "custom", from: "2026-06-01", to: "2026-06-10" }, IST, NOW)).toMatchObject({ ok: true });
    expect(resolveRange({ key: "custom", from: "2025-01-01", to: "2026-06-10" }, IST, NOW)).toEqual({ ok: false, error: "range_too_long" });
    expect(resolveRange({ key: "custom", from: "2026-06-10", to: "2026-06-01" }, IST, NOW)).toEqual({ ok: false, error: "invalid_dates" });
    expect(resolveRange({ key: "custom", from: "2026-07-01", to: "2026-07-02" }, IST, NOW)).toEqual({ ok: false, error: "future" });
    expect(resolveRange({ key: "custom", from: "nope", to: "2026-06-01" }, IST, NOW)).toEqual({ ok: false, error: "invalid_dates" });
    expect(MAX_RANGE_DAYS).toBe(366);
    // bilinmeyen anahtar → bugün
    expect(resolveRange({ key: "hack" }, IST, NOW)).toMatchObject({ ok: true, range: { key: "today" } });
  });
});

describe("karşılaştırma ve düşük veri", () => {
  it("yüzde değişim, sıfır taban (Infinity yok), düşük veri", () => {
    expect(compare(150, 100)).toMatchObject({ diff: 50, pct: 50, trend: "up", lowData: false });
    expect(compare(80, 100)).toMatchObject({ diff: -20, pct: -20, trend: "down" });
    expect(compare(10, 0)).toMatchObject({ pct: null, lowData: true, trend: "up" });
    expect(compare(0, 0)).toMatchObject({ pct: null, trend: "flat", lowData: true });
    expect(compare(3, 1, { minBaseline: MIN_COUNT_BASELINE })).toMatchObject({ pct: null, lowData: true });
    expect(compare(12, 10, { minBaseline: MIN_COUNT_BASELINE }).pct).toBe(20);
    expect(JSON.stringify(compare(5, 0))).not.toMatch(/Infinity|NaN/);
  });
});

describe("istatistik ve para", () => {
  it("medyan / p90 (percentile_cont ile aynı tanım)", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
    expect(median([])).toBeNull();
  });

  it("para tamsayı kuruş; ortalama 0/0 yok; float reddedilir", () => {
    expect(sumMinor([1999, 1, 100])).toBe(2100);
    expect(() => sumMinor([10.5])).toThrow();
    expect(averageMinor(1000, 3)).toBe(333);
    expect(averageMinor(0, 0)).toBeNull();
    expect(ratio(1, 0)).toBeNull();
    expect(minorToDecimalString(123456)).toBe("1234.56");
    expect(minorToDecimalString(5)).toBe("0.05");
  });

  it("satış sayılan durumlar: kabul edilmiş + REJECTED / CANCELLED / SUBMITTED hariç", () => {
    const d = new Date();
    expect(countsAsSale({ status: "SERVED", acceptedAt: d })).toBe(true);
    expect(countsAsSale({ status: "ACCEPTED", acceptedAt: d })).toBe(true);
    expect(countsAsSale({ status: "CANCELLED", acceptedAt: d })).toBe(false);
    expect(countsAsSale({ status: "REJECTED", acceptedAt: null })).toBe(false);
    expect(countsAsSale({ status: "SUBMITTED", acceptedAt: null })).toBe(false);
  });
});

describe("zaman kovaları ve boş durumlar", () => {
  it("kova anahtarları yerel saatte; boş kovalar 0 ile doldurulur", () => {
    expect(bucketKey(IST, new Date("2026-06-14T21:30:00Z"), "hour")).toBe("2026-06-15 00");
    expect(bucketKey(IST, new Date("2026-06-14T21:30:00Z"), "day")).toBe("2026-06-15");
    const keys = bucketKeys(IST, new Date("2026-06-08T21:00:00Z"), new Date("2026-06-15T21:00:00Z"), "day");
    expect(keys).toEqual(["2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14", "2026-06-15"]);
    const filled = fillBuckets(keys, [{ key: "2026-06-12", n: 3 }], (key) => ({ key, n: 0 }));
    expect(filled.map((f) => f.n)).toEqual([0, 0, 0, 3, 0, 0, 0]);
  });

  it("menü dörtlü tablosu: az üründe boş (null); medyana göre sınıflama", () => {
    expect(classifyQuadrants([{ quantity: 1, avgUnitMinor: 100 }])).toBeNull();
    const q = classifyQuadrants([
      { quantity: 50, avgUnitMinor: 50000 },
      { quantity: 40, avgUnitMinor: 5000 },
      { quantity: 2, avgUnitMinor: 60000 },
      { quantity: 1, avgUnitMinor: 3000 },
    ])!;
    expect(q.highQtyHighValue).toHaveLength(1);
    expect(q.highQtyLowValue).toHaveLength(1);
    expect(q.lowQtyHighValue).toHaveLength(1);
    expect(q.lowQtyLowValue).toHaveLength(1);
  });
});

describe("CSV", () => {
  it.each(["=SUM(A1)", "+1", "-1+2", "@cmd", "\tx", "\rx"])("formül enjeksiyonu kaçışlanır: %s", (v) => {
    expect(escapeCsvCell(v).startsWith(`"'`)).toBe(true);
  });
  it("tırnak, satır sonu, sayı ve boş değer", () => {
    expect(escapeCsvCell('Ayran "büyük"')).toBe('"Ayran ""büyük"""');
    expect(escapeCsvCell("a\nb")).toBe('"a b"');
    expect(escapeCsvCell(-5)).toBe("-5");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(Number.NaN)).toBe("");
    expect(csvRow(["a", 1, null])).toBe('"a",1,\r\n');
  });
});

describe("yetki ve metinler", () => {
  it("analitik yalnızca sahip / şube müdürü; garson, kasiyer, mutfak, bar göremez", () => {
    for (const role of ["TENANT_OWNER", "BRANCH_MANAGER"] as const) {
      expect(hasPermission(role, "analytics.view")).toBe(true);
      expect(hasPermission(role, "analytics.export")).toBe(true);
    }
    for (const role of ["WAITER", "CASHIER", "KITCHEN", "BAR", "SUPER_ADMIN"] as const) expect(hasPermission(role, "analytics.view")).toBe(false);
  });

  it("TR / EN metinler; muhasebe terimi kullanılmaz", () => {
    const tr = analyticsLabels("tr");
    const en = analyticsLabels("en");
    expect(tr.kpi.sales).toBe("Sipariş tutarı");
    expect(en.kpi.sales).toBe("Order value");
    expect(analyticsLabels("de").title).toBe("Analitik");
    const all = JSON.stringify([tr, en]);
    expect(all).not.toMatch(/Net Ciro|Net Revenue|"Kâr|"Profit|Marj"|Food cost/i);
  });
});

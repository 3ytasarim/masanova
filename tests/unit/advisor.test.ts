import { describe, expect, it } from "vitest";
import { generateCandidates, RULES } from "@/lib/advisor/engine";
import { factHash, materialSignature, stableStringify } from "@/lib/advisor/hash";
import { parseExplanationArray, toExplainItem } from "@/lib/advisor/prompt";
import { aiFailureRate, aiFallbackChange } from "@/lib/advisor/rules/ai";
import { stationBottleneck, stationPrepChange, stationTail } from "@/lib/advisor/rules/kds";
import { menuMix, productMomentum } from "@/lib/advisor/rules/menu";
import { peakPrepWindow, prepTimeChange, rejectionRateChange } from "@/lib/advisor/rules/operations";
import { averageOrderChange, orderDayAnomaly, orderVolumeChange } from "@/lib/advisor/rules/sales";
import { areaServiceGap, serviceResponseChange } from "@/lib/advisor/rules/service";
import { confidenceFor, isMeaningfulChange, pctChange, robustZ } from "@/lib/advisor/stats";
import { renderInsight } from "@/lib/advisor/templates";
import { THRESHOLDS } from "@/lib/advisor/thresholds";
import { INSIGHT_TYPES, type AdvisorFacts, type InsightCandidate, type PeriodFacts } from "@/lib/advisor/types";
import { allowedNumbers, extractNumbers, validateExplanation } from "@/lib/advisor/validate";

/** Sprint 15 — İşletme Danışmanı deterministik motoru (saf). */
const MIN = 60_000;

function period(over: Partial<PeriodFacts> = {}): PeriodFacts {
  return {
    orders: { salesOrders: 0, salesMinor: 0, itemsSold: 0, submitted: 0, rejected: 0 },
    preparation: { count: 0, medianMs: null, p90Ms: null },
    acceptance: { count: 0, medianMs: null, p90Ms: null },
    stations: [],
    products: [],
    service: { total: 0, response: { count: 0, medianMs: null, p90Ms: null } },
    areas: [],
    ai: { conversations: 0, turns: 0, fallbackTurns: 0, failedTurns: 0, providerErrors: 0 },
    ...over,
  };
}
function facts(current: Partial<PeriodFacts> = {}, previous: Partial<PeriodFacts> = {}, detail: Partial<AdvisorFacts["detail"]> = {}): AdvisorFacts {
  return {
    current: period(current),
    previous: period(previous),
    detail: { prepWindows: [], stationWindows: [], bottleneck: { multiStationOrders: 0, lastReady: [] }, serviceAreas: [], daily: [], ...detail },
    currency: "TRY",
  };
}
const orders = (n: number, minor = n * 30000) => ({ salesOrders: n, salesMinor: minor, itemsSold: n * 2, submitted: n, rejected: 0 });

describe("istatistik yardımcıları", () => {
  it("sıfır taban → yüzde yok (sonsuz artış üretilmez)", () => {
    expect(pctChange(50, 0)).toBeNull();
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(80, 100)).toBe(-20);
  });

  it("örneklem, göreli ve mutlak eşik birlikte gerekir", () => {
    expect(isMeaningfulChange({ current: 130, previous: 100, currentN: 130, previousN: 100, minSamples: 20, minPct: 15, minAbs: 5 })).toBe(true);
    expect(isMeaningfulChange({ current: 110, previous: 100, currentN: 110, previousN: 100, minSamples: 20, minPct: 15, minAbs: 5 })).toBe(false); // %10
    expect(isMeaningfulChange({ current: 2, previous: 1, currentN: 2, previousN: 1, minSamples: 20, minPct: 15 })).toBe(false); // düşük hacim
    expect(isMeaningfulChange({ current: 24, previous: 20, currentN: 24, previousN: 20, minSamples: 20, minPct: 15, minAbs: 5 })).toBe(false); // mutlak 4
  });

  it("güven: örneklem / taban / dağılım", () => {
    expect(confidenceFor({ n: 60, min: 20 })).toBe("HIGH");
    expect(confidenceFor({ n: 30, min: 20 })).toBe("MEDIUM");
    expect(confidenceFor({ n: 20, min: 20 })).toBe("LOW");
    expect(confidenceFor({ n: 60, min: 20, hasBaseline: false })).toBe("MEDIUM");
    expect(confidenceFor({ n: 60, min: 20, spread: 4 })).toBe("MEDIUM");
    expect(confidenceFor({ n: 30, min: 20, spread: 4 })).toBe("LOW");
  });

  it("MAD tabanlı sağlam z (MAD 0 → null)", () => {
    expect(robustZ(50, [10, 11, 9, 10, 12, 8, 10])!.z).toBeGreaterThan(10);
    expect(robustZ(10, [10, 10, 10])).toBeNull();
  });
});

describe("satış kuralları", () => {
  it("sipariş adedi: anlamlı artış → içgörü; az veri / küçük değişim → yok", () => {
    const [c] = orderVolumeChange(facts({ orders: orders(130) }, { orders: orders(100) }));
    expect(c).toMatchObject({ type: "ORDER_VOLUME_CHANGE", category: "SALES", severity: "INFO", facts: { currentOrders: 130, previousOrders: 100, deltaPct: 30 } });
    expect(orderVolumeChange(facts({ orders: orders(108) }, { orders: orders(100) }))).toEqual([]);
    expect(orderVolumeChange(facts({ orders: orders(12) }, { orders: orders(3) }))).toEqual([]);
    expect(orderVolumeChange(facts({ orders: orders(40) }, { orders: orders(0) }))).toEqual([]);
    expect(orderVolumeChange(facts({ orders: orders(60) }, { orders: orders(100) }))[0]!.severity).toBe("ATTENTION");
  });

  it("ortalama sipariş", () => {
    const [c] = averageOrderChange(facts({ orders: orders(50, 50 * 40000) }, { orders: orders(50, 50 * 30000) }));
    expect(c).toMatchObject({ type: "AVERAGE_ORDER_CHANGE", facts: { currentAverageMinor: 40000, previousAverageMinor: 30000 } });
    expect(averageOrderChange(facts({ orders: orders(10, 10 * 40000) }, { orders: orders(10, 10 * 30000) }))).toEqual([]);
  });

  it("gün anomalisi (median / MAD): aykırı gün → içgörü; sakin seri → yok", () => {
    const days = Array.from({ length: 28 }, (_, i) => ({ day: `2026-05-${String(i + 1).padStart(2, "0")}`, orders: 20 + (i % 3) }));
    expect(orderDayAnomaly(facts({}, {}, { daily: [...days, { day: "2026-05-29", orders: 60 }] }))[0]).toMatchObject({ type: "ORDER_DAY_ANOMALY", facts: { dayOrders: 60, baselineMedian: 21 } });
    expect(orderDayAnomaly(facts({}, {}, { daily: [...days, { day: "2026-05-29", orders: 22 }] }))).toEqual([]);
    expect(orderDayAnomaly(facts({}, {}, { daily: days.slice(0, 5) }))).toEqual([]);
  });
});

describe("operasyon / mutfak kuralları", () => {
  it("hazırlama süresi değişimi (medyan; dağılım güveni düşürür)", () => {
    const [c] = prepTimeChange(facts({ preparation: { count: 60, medianMs: 12 * MIN, p90Ms: 20 * MIN } }, { preparation: { count: 60, medianMs: 9 * MIN, p90Ms: 15 * MIN } }));
    expect(c).toMatchObject({ type: "PREP_TIME_CHANGE", severity: "ATTENTION", confidence: "HIGH", facts: { deltaPct: 33.3 } });
    expect(prepTimeChange(facts({ preparation: { count: 8, medianMs: 12 * MIN, p90Ms: null } }, { preparation: { count: 8, medianMs: 9 * MIN, p90Ms: null } }))).toEqual([]);
    expect(prepTimeChange(facts({ preparation: { count: 60, medianMs: 12 * MIN, p90Ms: 60 * MIN } }, { preparation: { count: 60, medianMs: 9 * MIN, p90Ms: 15 * MIN } }))[0]!.confidence).toBe("MEDIUM");
  });

  it("yoğun saat penceresi + pencerede en yavaş istasyon", () => {
    const f = facts(
      { preparation: { count: 80, medianMs: 9 * MIN, p90Ms: 14 * MIN } },
      {},
      {
        prepWindows: [
          { startHour: 12, n: 20, medianMs: 9 * MIN },
          { startHour: 19, n: 30, medianMs: 12 * MIN },
          { startHour: 22, n: 5, medianMs: 20 * MIN },
        ],
        stationWindows: [
          { startHour: 19, station: "Izgara", n: 18, medianMs: 13 * MIN },
          { startHour: 19, station: "Bar", n: 10, medianMs: 3 * MIN },
        ],
      },
    );
    const [c] = peakPrepWindow(f);
    expect(c).toMatchObject({ type: "PEAK_PREP_WINDOW", subjectKey: "19", facts: { startHour: 19, endHour: 21, station: "Izgara", windowOrders: 30 } });
    expect(renderInsight(c!, "TRY").title).toBe("19:00–21:00 arasında hazırlama süresi yükseliyor");
  });

  it("ret oranı (yüzde puanı)", () => {
    const [c] = rejectionRateChange(facts({ orders: { ...orders(40), submitted: 50, rejected: 10 } }, { orders: { ...orders(48), submitted: 50, rejected: 2 } }));
    expect(c).toMatchObject({ type: "REJECTION_RATE_CHANGE", facts: { currentRatePct: 20, previousRatePct: 4, deltaPp: 16 } });
  });

  it("istasyon değişimi / uzun kuyruk / darboğaz", () => {
    const st = (name: string, tickets: number, med: number, p90: number) => ({ name, tickets, medianMs: med * MIN, p90Ms: p90 * MIN });
    expect(stationPrepChange(facts({ stations: [st("Bar", 40, 6, 9)] }, { stations: [st("Bar", 40, 3, 5)] }))[0]).toMatchObject({ subject: "Bar", facts: { deltaPct: 100 } });
    expect(stationPrepChange(facts({ stations: [st("Bar", 5, 6, 9)] }, { stations: [st("Bar", 5, 3, 5)] }))).toEqual([]);
    expect(stationTail(facts({ stations: [st("Tatlı", 30, 4, 12)] }))[0]).toMatchObject({ type: "STATION_TAIL", facts: { ratio: 3 } });
    expect(stationTail(facts({ stations: [st("Tatlı", 30, 4, 6)] }))).toEqual([]);
    const bottleneck = stationBottleneck(
      facts({ stations: [st("Tatlı", 30, 12, 15)] }, {}, { bottleneck: { multiStationOrders: 20, lastReady: [{ station: "Tatlı", count: 14 }, { station: "Bar", count: 6 }] } }),
    );
    expect(bottleneck[0]).toMatchObject({ type: "STATION_BOTTLENECK", subject: "Tatlı", facts: { sharePct: 70, multiStationOrders: 20 } });
    expect(stationBottleneck(facts({}, {}, { bottleneck: { multiStationOrders: 6, lastReady: [{ station: "Tatlı", count: 6 }] } }))).toEqual([]);
    expect(stationBottleneck(facts({}, {}, { bottleneck: { multiStationOrders: 20, lastReady: [{ station: "Tatlı", count: 8 }, { station: "Bar", count: 12 - 0 }] } }))[0]!.subject).toBe("Bar");
  });
});

describe("servis / bölge kuralları (personel sıralaması yok)", () => {
  it("servis yanıt süresi değişimi", () => {
    const [c] = serviceResponseChange(facts({ service: { total: 40, response: { count: 40, medianMs: 3 * MIN, p90Ms: 5 * MIN } } }, { service: { total: 40, response: { count: 40, medianMs: 2 * MIN, p90Ms: 3 * MIN } } }));
    expect(c).toMatchObject({ type: "SERVICE_RESPONSE_CHANGE", facts: { deltaPct: 50 } });
    expect(JSON.stringify(c)).not.toMatch(/user|staff|garson adı/i);
  });

  it("bölgeler arası yanıt farkı", () => {
    const [c] = areaServiceGap(facts({}, {}, { serviceAreas: [{ area: "Bahçe", n: 12, medianMs: 4 * MIN }, { area: "İç Salon", n: 15, medianMs: 2 * MIN }] }));
    expect(c).toMatchObject({ type: "AREA_SERVICE_GAP", subject: "Bahçe", facts: { slowArea: "Bahçe", fastArea: "İç Salon", gapPct: 100 } });
    expect(areaServiceGap(facts({}, {}, { serviceAreas: [{ area: "Bahçe", n: 3, medianMs: 9 * MIN }, { area: "İç Salon", n: 15, medianMs: 2 * MIN }] }))).toEqual([]);
  });
});

describe("menü kuralları (maliyet yok → kârlılık söylenmez)", () => {
  const p = (key: string, quantity: number, totalMinor: number, extra: { archived?: boolean } = {}) => ({ key, name: key, archived: !!extra.archived, deleted: false, quantity, totalMinor });

  it("ürün ivmesi: yükselen + düşen; düşük hacim ve arşivlenmiş düşüş bastırılır", () => {
    const rows = productMomentum(facts({ products: [p("Burger", 40, 1), p("Salata", 6, 1), p("Ayran", 2, 1)] }, { products: [p("Burger", 25, 1), p("Salata", 20, 1), p("Ayran", 1, 1)] }));
    expect(rows.map((r) => [r.subject, r.facts.direction])).toEqual([
      ["Burger", "up"],
      ["Salata", "down"],
    ]);
    expect(productMomentum(facts({ products: [p("Eski", 0, 0, { archived: true })] }, { products: [p("Eski", 30, 1, { archived: true })] }))).toEqual([]);
  });

  it("yüksek adet / görece düşük katkı ve tersi", () => {
    const rows = menuMix(facts({ products: [p("Ayran", 60, 60 * 5000), p("Burger", 40, 40 * 40000), p("Biftek", 6, 6 * 120000), p("Salata", 30, 30 * 18000)] }));
    const types = rows.map((r) => `${r.type}:${r.subject}`);
    expect(types).toContain("MENU_HIGH_QTY_LOW_VALUE:Ayran");
    expect(types).toContain("MENU_LOW_QTY_HIGH_VALUE:Biftek");
    expect(menuMix(facts({ products: [p("A", 10, 1000)] }))).toEqual([]);
  });
});

describe("AI kullanım kuralları (içerik yok, nedensellik yok)", () => {
  it("bas-konuşa düşme oranı ve hata oranı", () => {
    expect(aiFallbackChange(facts({ ai: { conversations: 30, turns: 50, fallbackTurns: 15, failedTurns: 0, providerErrors: 0 } }, { ai: { conversations: 30, turns: 50, fallbackTurns: 5, failedTurns: 0, providerErrors: 0 } }))[0]).toMatchObject({ facts: { currentRatePct: 30, previousRatePct: 10, deltaPp: 20 } });
    expect(aiFailureRate(facts({ ai: { conversations: 30, turns: 40, fallbackTurns: 0, failedTurns: 6, providerErrors: 0 } }))[0]).toMatchObject({ facts: { failed: 6, ratePct: 15 } });
    expect(aiFailureRate(facts({ ai: { conversations: 30, turns: 40, fallbackTurns: 0, failedTurns: 1, providerErrors: 0 } }))).toEqual([]);
  });
});

describe("motor, özet, şablonlar", () => {
  it("adaylar puana göre sıralı; hata veren kural diğerlerini durdurmaz; az veride boş", () => {
    const f = facts({ orders: orders(130), preparation: { count: 60, medianMs: 12 * MIN, p90Ms: 20 * MIN } }, { orders: orders(100), preparation: { count: 60, medianMs: 9 * MIN, p90Ms: 15 * MIN } });
    const { candidates } = generateCandidates(f);
    expect(candidates.map((c) => c.type)).toEqual(expect.arrayContaining(["ORDER_VOLUME_CHANGE", "PREP_TIME_CHANGE"]));
    expect([...candidates].sort((a, b) => b.score - a.score)).toEqual(candidates);
    expect(generateCandidates(facts({ orders: orders(3) }, { orders: orders(1) })).candidates).toEqual([]);
    const broken = { ...f, detail: null } as unknown as AdvisorFacts;
    const r = generateCandidates(broken);
    expect(r.failedRules.length).toBeGreaterThan(0);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(RULES.length).toBeGreaterThanOrEqual(15);
  });

  it("olgu özeti kararlı (anahtar sırası önemsiz); önemli değişim imzası küçük dalgalanmada aynı, yön değişince farklı", () => {
    const base = { type: "PREP_TIME_CHANGE" as const, subjectKey: "", confidence: "HIGH" as const };
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    expect(factHash({ ...base, facts: { a: 1, b: 2 } })).toBe(factHash({ ...base, facts: { b: 2, a: 1 } }));
    expect(factHash({ ...base, facts: { a: 1 } })).not.toBe(factHash({ ...base, facts: { a: 2 } }));
    expect(materialSignature({ ...base, facts: { deltaPct: 31 } })).toBe(materialSignature({ ...base, facts: { deltaPct: 33 } }));
    expect(materialSignature({ ...base, facts: { deltaPct: 31 } })).not.toBe(materialSignature({ ...base, facts: { deltaPct: -31 } }));
    expect(materialSignature({ ...base, facts: { deltaPct: 31 } })).not.toBe(materialSignature({ ...base, facts: { deltaPct: 160 } }));
  });

  it("her tür için deterministik şablon (AI olmadan); eylemler temkinli, kesin fiyat / kaldırma / işe alma yok", () => {
    const f = facts();
    const sample = (type: InsightCandidate["type"]): InsightCandidate => ({ type, category: "SALES", severity: "INFO", confidence: "MEDIUM", subjectKey: "x", subject: "X", facts: { deltaPct: 20, station: "Izgara", product: "Burger", area: "Bahçe", slowArea: "Bahçe", fastArea: "Salon", day: "2026-05-01", startHour: 19 }, metrics: [], score: 1, tab: "overview", actions: ["MONITOR"] });
    for (const t of INSIGHT_TYPES) {
      const r = renderInsight(sample(t), f.currency);
      expect(r.title.length).toBeGreaterThan(5);
      expect(r.action).toMatch(/^Değerlendirilebilir:/);
      expect(`${r.title} ${r.finding} ${r.action}`).not.toMatch(/kaldırın|işe al|işten çıkar|fiyatı .* yapın|sayesinde|yüzünden/i);
    }
  });
});

describe("AI açıklama doğrulaması", () => {
  const f = facts({ preparation: { count: 60, medianMs: 701_000, p90Ms: 20 * MIN } }, { preparation: { count: 60, medianMs: 535_000, p90Ms: 15 * MIN } });
  const candidate = prepTimeChange(f)[0]!;
  const rendered = renderInsight(candidate, "TRY");
  const allowed = allowedNumbers(candidate, rendered, "TRY");
  const ok = { summary: "Medyan hazırlama süresi 8 dk 55 sn'den 11 dk 41 sn'ye çıktı (+%31).", whyItMatters: "Misafirler siparişlerini daha uzun bekliyor olabilir.", suggestedAction: "Değerlendirilebilir: yoğun saatlerde hazırlık kapasitesini gözden geçirmek." };

  it("olgulardaki sayılarla yazılmış temkinli açıklama kabul edilir", () => {
    expect(rendered.finding).toContain("8 dk 55 sn");
    expect(validateExplanation(ok, allowed)).toEqual({ ok: true, value: ok });
  });

  it.each([
    ["number", { ...ok, summary: "Medyan hazırlama süresi 14 dk'ya çıktı." }],
    ["number", { ...ok, whyItMatters: "Bu, günde 250 siparişi etkiler." }],
    ["profit", { ...ok, whyItMatters: "Bu durum kârınızı düşürüyor." }],
    ["profit", { ...ok, whyItMatters: "Marj baskısı oluşabilir." }],
    ["profit", { ...ok, whyItMatters: "Revenue may drop." }],
    ["employee", { ...ok, suggestedAction: "Değerlendirilebilir: en yavaş garsonu uyarmak." }],
    ["employee", { ...ok, suggestedAction: "Bir çalışan daha işe alın." }],
    ["causal", { ...ok, whyItMatters: "Sesli asistan sayesinde siparişler arttı." }],
    ["causal", { ...ok, whyItMatters: "Yeni menü hazırlama süresini artırdı." }],
    ["prescription", { ...ok, suggestedAction: "Burgerin fiyatını yükseltin." }],
    ["prescription", { ...ok, suggestedAction: "Bu ürünü menüden kaldırın." }],
    ["mutation", { ...ok, suggestedAction: "İstasyon yönlendirmesini güncelledim." }],
    ["format", { ...ok, summary: "<b>önemli</b>" }],
    ["format", { summary: "x", whyItMatters: "" }],
    ["format", null],
    ["length", { ...ok, summary: "a".repeat(500) }],
  ] as const)("reddedilir: %s", (reason, value) => {
    expect(validateExplanation(value, allowed)).toEqual({ ok: false, reason });
  });

  it("sayı ayıklama: TR binlik / ondalık / yüzde", () => {
    expect(extractNumbers("₺48.250 ve %31, 11 dk 42 sn, 3,5")).toEqual(["48250", "31", "11", "42", "3.5"]);
  });

  it("istem çıktısı ayrıştırma + derli toplu olgu yükü (ham veri yok)", () => {
    expect(parseExplanationArray('```json\n[{"id":"a","summary":"x"}]\n```')).toEqual([{ id: "a", summary: "x" }]);
    expect(parseExplanationArray("üzgünüm")).toEqual([]);
    const item = toExplainItem("id1", candidate, rendered, "TRY");
    expect(item.facts.map((x) => x.label)).toEqual(["Medyan hazırlama", "p90 hazırlama", "Sipariş (örneklem)"]);
    expect(JSON.stringify(item).length).toBeLessThan(1500);
  });

  it("eşikler merkezi (sihirli sayı yok)", () => {
    expect(THRESHOLDS.orderVolume.minSamples).toBeGreaterThanOrEqual(20);
    expect(THRESHOLDS.productMomentum.minPrevious).toBeGreaterThan(1);
  });
});

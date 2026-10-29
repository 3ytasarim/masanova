import { describe, expect, it } from "vitest";
import { buildTableBills, openFor, type BillOrderInput } from "@/lib/cashier/bill";

const now = new Date("2026-10-29T20:00:00Z");
const order = (id: string, tableId: string, minutesAgo: number, items: BillOrderInput["items"], payments: BillOrderInput["payments"] = []): BillOrderInput => {
  const total = items.reduce((n, i) => n + i.lineTotalMinor, 0);
  return { id, tableId, orderNumber: Number(id.replace(/\D/g, "")) || 1, createdAt: new Date(now.getTime() - minutesAgo * 60_000), currency: "TRY", subtotalMinor: total, discountMinor: 0, totalMinor: total, items, payments };
};
const item = (name: string, quantity: number, unit: number, extra: Partial<BillOrderInput["items"][number]> = {}) => ({ name, variant: null, quantity, unitPriceMinor: unit, lineTotalMinor: unit * quantity, modifiers: [], ...extra });

describe("kasa adisyonu", () => {
  it("masa siparişlerini toplar, aynı ürünü tek satırda birleştirir", () => {
    const bills = buildTableBills([order("o1", "t1", 40, [item("Rakı", 1, 25000), item("Çipura", 2, 75000)]), order("o2", "t1", 10, [item("Rakı", 2, 25000)])], now);
    const b = bills.get("t1")!;
    expect(b.orderNumbers).toEqual([1, 2]);
    expect(b.lines).toEqual([
      { name: "Rakı", detail: null, quantity: 3, unitPriceMinor: 25000, totalMinor: 75000 },
      { name: "Çipura", detail: null, quantity: 2, unitPriceMinor: 75000, totalMinor: 150000 },
    ]);
    expect(b.totalMinor).toBe(225000);
    expect(b.remainingMinor).toBe(225000);
  });

  it("farklı seçenek / fiyat ayrı satır", () => {
    const b = buildTableBills([order("o1", "t1", 5, [item("Rakı", 1, 25000, { variant: "Duble" }), item("Rakı", 1, 18000, { variant: "Tek" })])], now).get("t1")!;
    expect(b.lines.map((l) => l.detail)).toEqual(["Duble", "Tek"]);
  });

  it("ödenmiş sipariş hesaba girmez; kısmi ödeme kalan tutarı düşürür", () => {
    const paid = { status: "SUCCEEDED" as const, amountMinor: 10000, refundedMinor: 0, reservedUntil: null };
    const bills = buildTableBills([order("o1", "t1", 30, [item("Çay", 1, 10000)], [paid]), order("o2", "t2", 30, [item("Kahve", 2, 10000)], [paid])], now);
    expect(bills.has("t1")).toBe(false);
    expect(bills.get("t2")).toMatchObject({ totalMinor: 20000, paidMinor: 10000, remainingMinor: 10000 });
  });

  it("24 saatten eski ödenmemiş sipariş adisyona karışmaz", () => {
    expect(buildTableBills([order("o1", "t1", 25 * 60, [item("Çay", 1, 10000)])], now).size).toBe(0);
  });

  it("açık kalma süresi", () => {
    expect(openFor(now.getTime() - 12 * 60_000, now)).toBe("12 dk");
    expect(openFor(now.getTime() - 65 * 60_000, now)).toBe("1 sa 5 dk");
  });
});

import { paymentSummary, type PaymentLike } from "@/lib/payments/state";

/**
 * Kasa / adisyon — saf hesap (veritabanı yok). Masanın "açık hesabı" ayrı bir kayıt değildir: masanın son
 * OPEN_WINDOW_MS içindeki, ödenebilir durumdaki (kabul → servis) ve bakiyesi kalan siparişlerinin toplamıdır.
 * Ödeme alınınca (nakit / kart, mevcut kasa kaydı) sipariş bakiyesi sıfırlanır → masa kendiliğinden boşalır.
 */
export const OPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

export type BillOrderInput = {
  id: string;
  tableId: string;
  orderNumber: number;
  createdAt: Date;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  items: { name: string; variant: string | null; quantity: number; unitPriceMinor: number; lineTotalMinor: number; modifiers: string[] }[];
  payments: PaymentLike[];
};

export type BillLine = { name: string; detail: string | null; quantity: number; unitPriceMinor: number; totalMinor: number };

export type TableBill = {
  tableId: string;
  currency: string;
  orderIds: string[];
  orderNumbers: number[];
  openedAt: Date;
  lines: BillLine[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
};

/** Aynı ürün + seçenek + birim fiyat tek satırda toplanır (adisyon kısa ve okunur olsun). */
function mergeLines(orders: readonly BillOrderInput[]): BillLine[] {
  const map = new Map<string, BillLine>();
  for (const o of orders)
    for (const i of o.items) {
      const detail = [i.variant, ...i.modifiers].filter(Boolean).join(", ") || null;
      const key = `${i.name}|${detail ?? ""}|${i.unitPriceMinor}`;
      const line = map.get(key);
      if (line) {
        line.quantity += i.quantity;
        line.totalMinor += i.lineTotalMinor;
      } else map.set(key, { name: i.name, detail, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.lineTotalMinor });
    }
  return [...map.values()];
}

/** Masa başına açık hesaplar. Bakiyesi kalmayan sipariş hesaba girmez; hiç açık siparişi olmayan masa dönmez. */
export function buildTableBills(orders: readonly BillOrderInput[], now: Date): Map<string, TableBill> {
  const byTable = new Map<string, { order: BillOrderInput; paid: number; remaining: number }[]>();
  for (const order of orders) {
    if (now.getTime() - order.createdAt.getTime() > OPEN_WINDOW_MS) continue;
    const s = paymentSummary(order.totalMinor, order.payments, now);
    if (s.remaining <= 0) continue;
    byTable.set(order.tableId, [...(byTable.get(order.tableId) ?? []), { order, paid: s.paid, remaining: s.remaining }]);
  }
  const bills = new Map<string, TableBill>();
  for (const [tableId, list] of byTable) {
    list.sort((a, b) => a.order.createdAt.getTime() - b.order.createdAt.getTime());
    const ords = list.map((x) => x.order);
    bills.set(tableId, {
      tableId,
      currency: ords[0]!.currency,
      orderIds: ords.map((o) => o.id),
      orderNumbers: ords.map((o) => o.orderNumber),
      openedAt: ords[0]!.createdAt,
      lines: mergeLines(ords),
      subtotalMinor: ords.reduce((n, o) => n + o.subtotalMinor, 0),
      discountMinor: ords.reduce((n, o) => n + o.discountMinor, 0),
      totalMinor: ords.reduce((n, o) => n + o.totalMinor, 0),
      paidMinor: list.reduce((n, x) => n + x.paid, 0),
      remainingMinor: list.reduce((n, x) => n + x.remaining, 0),
    });
  }
  return bills;
}

/** "12 dk" / "1 sa 5 dk" — masa ne zamandır açık. */
export function openFor(openedAt: Date | number, now: Date | number): string {
  const min = Math.max(0, Math.floor((+now - +openedAt) / 60_000));
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} sa ${min % 60} dk` : `${h} sa`;
}

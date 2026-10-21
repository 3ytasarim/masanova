import "server-only";
import { prisma } from "@/lib/db/prisma";
import { countsAsSale } from "@/lib/analytics/metrics";
import { CSV_BOM, CSV_MAX_ROWS, csvRow, minorToDecimalString, type CsvCell } from "@/lib/analytics/csv";
import { formatLocalDate, formatLocalTimestamp } from "@/lib/analytics/time";
import type { AnalyticsContext } from "@/server/analytics/filter";
import { productPerformance } from "@/server/analytics/menu.analytics";

/**
 * Sunucuda üretilen CSV dışa aktarımları (akış). Kapsam yalnızca oturumdaki kiracı + doğrulanmış şube; tarih aralığı
 * analitikle aynı (en fazla 366 gün); satır sınırı CSV_MAX_ROWS. Zaman damgaları restoranın yerel saati + UTC ofseti
 * ("2026-10-11 14:05 +03:00"). Tutar: kuruş tamsayısı + okunur ondalık sütun. Formül enjeksiyonu kaçışlanır.
 * Gizlilik: müşteri notu, AI konuşma metni, IP, QR tokenı, personel adı / kimliği DAHİL DEĞİL.
 */
export const CSV_EXPORTS = ["orders", "products", "service", "kds"] as const;
export type CsvExport = (typeof CSV_EXPORTS)[number];

const BATCH = 1000;
const secs = (a: Date | null, b: Date | null) => (a && b ? Math.max(0, Math.round((a.getTime() - b.getTime()) / 1000)) : null);

export function csvFileName(kind: CsvExport, ctx: AnalyticsContext): string {
  return `masanova-${kind}-${formatLocalDate(ctx.range.fromDate)}_${formatLocalDate(ctx.range.toDate)}.csv`;
}

async function* orderRows(ctx: AnalyticsContext): AsyncGenerator<CsvCell[]> {
  const f = ctx.filter;
  yield ["Sipariş No", "Tarih (yerel)", "Şube", "Masa", "Bölge", "Durum", "Sipariş tutarına dahil", "Ürün adedi", "Tutar (kuruş)", "Tutar", "Para birimi", "Kabul süresi (sn)", "Hazırlama süresi (sn)", "Hazır → servis (sn)"];
  let cursor: { createdAt: Date; id: string } | null = null;
  let sent = 0;
  while (sent < CSV_MAX_ROWS) {
    const rows: { id: string; orderNumber: number; createdAt: Date; branchName: string; tableName: string; areaName: string | null; status: string; itemCount: number; totalMinor: number; currency: string; acceptedAt: Date | null; readyAt: Date | null; servedAt: Date | null }[] = await prisma.order.findMany({
      where: {
        tenantId: f.tenantId,
        ...(f.branchId ? { branchId: f.branchId } : {}),
        createdAt: { gte: f.start, lt: f.end },
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(BATCH, CSV_MAX_ROWS - sent),
      select: { id: true, orderNumber: true, createdAt: true, branchName: true, tableName: true, areaName: true, status: true, itemCount: true, totalMinor: true, currency: true, acceptedAt: true, readyAt: true, servedAt: true },
    });
    if (!rows.length) return;
    for (const o of rows) {
      yield [`#${o.orderNumber}`, formatLocalTimestamp(f.timeZone, o.createdAt), o.branchName, o.tableName, o.areaName, o.status, countsAsSale(o) ? "Evet" : "Hayır", o.itemCount, o.totalMinor, minorToDecimalString(o.totalMinor), o.currency, secs(o.acceptedAt, o.createdAt), secs(o.readyAt, o.acceptedAt), secs(o.servedAt, o.readyAt)];
    }
    sent += rows.length;
    const last = rows[rows.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

async function* productRows(ctx: AnalyticsContext): AsyncGenerator<CsvCell[]> {
  yield ["Ürün", "Sipariş anındaki eski ad", "Durum", "Satılan adet", "Sipariş sayısı", "Sipariş tutarı katkısı (kuruş)", "Sipariş tutarı katkısı", "Ortalama birim (kuruş)", "Para birimi"];
  for (const p of await productPerformance(ctx.filter, 5000)) {
    yield [p.name, p.formerName, p.deleted ? "Silinmiş" : p.archived ? "Arşivde" : "Aktif", p.quantity, p.orders, p.totalMinor, minorToDecimalString(p.totalMinor), p.avgUnitMinor, ctx.filter.currency];
  }
}

async function* serviceRows(ctx: AnalyticsContext): AsyncGenerator<CsvCell[]> {
  const f = ctx.filter;
  yield ["Tarih (yerel)", "Tür", "Durum", "Şube", "Bölge", "Masa", "Yanıt süresi (sn)", "Tamamlanma süresi (sn)"];
  let cursor: { createdAt: Date; id: string } | null = null;
  let sent = 0;
  while (sent < CSV_MAX_ROWS) {
    const rows: { id: string; createdAt: Date; type: string; status: string; branchName: string; areaName: string | null; tableName: string; acknowledgedAt: Date | null; completedAt: Date | null }[] = await prisma.tableServiceRequest.findMany({
      where: {
        tenantId: f.tenantId,
        ...(f.branchId ? { branchId: f.branchId } : {}),
        createdAt: { gte: f.start, lt: f.end },
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(BATCH, CSV_MAX_ROWS - sent),
      // Not alanı (müşteri metni) ve personel adı / kimliği BİLEREK seçilmez.
      select: { id: true, createdAt: true, type: true, status: true, branchName: true, areaName: true, tableName: true, acknowledgedAt: true, completedAt: true },
    });
    if (!rows.length) return;
    for (const r of rows) yield [formatLocalTimestamp(f.timeZone, r.createdAt), r.type, r.status, r.branchName, r.areaName, r.tableName, secs(r.acknowledgedAt, r.createdAt), secs(r.completedAt, r.createdAt)];
    sent += rows.length;
    const last = rows[rows.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

async function* kdsRows(ctx: AnalyticsContext): AsyncGenerator<CsvCell[]> {
  const f = ctx.filter;
  yield ["Sipariş No", "İstasyon", "İstasyon türü", "Durum", "Fiş oluşturma (yerel)", "Bekleme (sn)", "Hazırlama (sn)"];
  let cursor: { createdAt: Date; id: string } | null = null;
  let sent = 0;
  while (sent < CSV_MAX_ROWS) {
    const rows: { id: string; createdAt: Date; stationName: string; stationType: string; status: string; startedAt: Date | null; readyAt: Date | null; order: { orderNumber: number } }[] = await prisma.orderTicket.findMany({
      where: {
        tenantId: f.tenantId,
        ...(f.branchId ? { branchId: f.branchId } : {}),
        createdAt: { gte: f.start, lt: f.end },
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(BATCH, CSV_MAX_ROWS - sent),
      select: { id: true, createdAt: true, stationName: true, stationType: true, status: true, startedAt: true, readyAt: true, order: { select: { orderNumber: true } } },
    });
    if (!rows.length) return;
    for (const t of rows) yield [`#${t.order.orderNumber}`, t.stationName, t.stationType, t.status, formatLocalTimestamp(f.timeZone, t.createdAt), secs(t.startedAt, t.createdAt), secs(t.readyAt, t.startedAt)];
    sent += rows.length;
    const last = rows[rows.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

const GENERATORS: Record<CsvExport, (ctx: AnalyticsContext) => AsyncGenerator<CsvCell[]>> = { orders: orderRows, products: productRows, service: serviceRows, kds: kdsRows };

/** CSV akışı (UTF-8 BOM + satırlar). */
export function csvStream(kind: CsvExport, ctx: AnalyticsContext): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const rows = GENERATORS[kind](ctx);
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(CSV_BOM));
      }
      const chunk: string[] = [];
      for (let i = 0; i < 200; i++) {
        const next = await rows.next();
        if (next.done) {
          if (chunk.length) controller.enqueue(encoder.encode(chunk.join("")));
          controller.close();
          return;
        }
        chunk.push(csvRow(next.value));
      }
      controller.enqueue(encoder.encode(chunk.join("")));
    },
    async cancel() {
      await rows.return(undefined);
    },
  });
}

/** Testler için: tüm CSV metni. */
export async function csvText(kind: CsvExport, ctx: AnalyticsContext): Promise<string> {
  return new Response(csvStream(kind, ctx)).text();
}

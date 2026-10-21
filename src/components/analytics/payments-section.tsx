import { formatMoney } from "@/lib/menu/money";
import type { PaymentMetrics } from "@/server/analytics/payments.analytics";
import { StatCard } from "@/components/ui/stat-card";

/** Analitik › Genel bakış ödeme özeti (Sprint 19). Muhasebe / kesinleşmiş ciro raporu DEĞİLDİR. */
export function PaymentsAnalytics({ data, currency }: { data: PaymentMetrics; currency: string }) {
  const money = (m: number) => formatMoney(m, currency);
  return (
    <section aria-labelledby="pay-analytics" className="grid gap-4" data-testid="analytics-payments">
      <h2 id="pay-analytics" className="text-base font-semibold text-fg">
        Ödemeler
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ödenmiş / kısmen / ödenmemiş" value={`${data.paidOrders} / ${data.partiallyPaidOrders} / ${data.unpaidOrders}`} hint="sipariş (ret / iptal hariç)" />
        <StatCard label="Online ödenen" value={money(data.onlineMinor)} hint={`${data.succeededPayments} başarılı ödeme`} />
        <StatCard label="Kasada kaydedilen" value={money(data.manualMinor)} hint="Nakit · POS · diğer" />
        <StatCard label="İade" value={money(data.refundedMinor)} hint={`${data.failedPayments} başarısız deneme`} />
      </div>
      <p className="text-xs text-fg-subtle">Tutarlar sağlayıcı / kasa tarafından kesinleşmiş ödemelerdir; komisyon, valör ve ters ibraz içermez — muhasebe ya da “kesinleşmiş ciro” raporu değildir.</p>
    </section>
  );
}

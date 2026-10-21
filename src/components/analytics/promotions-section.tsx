import { formatMoney } from "@/lib/menu/money";
import { StatCard } from "@/components/ui/stat-card";

type Metrics = { orders: number; grossMinor: number; discountMinor: number; netMinor: number; ordersWithPromotion: number; couponUses: number; rewardRedemptions: number; pointsRedeemed: number };

/**
 * Analitik › Genel bakış altındaki promosyon özeti (Sprint 18). Tanımlar açık: Brüt = indirimden önceki ara toplam,
 * İndirim = kupon / ödül, Net = siparişin toplamı ("Sipariş Tutarı" net tutardır). İptal / ret hariç. ROI ya da kampanya
 * dönüşümü İDDİA EDİLMEZ (gönderim olayı yok).
 */
export function PromotionsAnalytics({ data, currency }: { data: Metrics; currency: string }) {
  const money = (m: number) => formatMoney(m, currency);
  return (
    <section aria-labelledby="promo-analytics" className="grid gap-4" data-testid="analytics-promotions">
      <h2 id="promo-analytics" className="text-base font-semibold text-fg">
        Promosyonlar
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Brüt (indirim öncesi)" value={money(data.grossMinor)} hint={`${data.orders} sipariş`} />
        <StatCard label="Toplam indirim" value={money(data.discountMinor)} hint={`${data.ordersWithPromotion} promosyonlu sipariş`} />
        <StatCard label="Net (Sipariş Tutarı)" value={money(data.netMinor)} />
        <StatCard label="Kupon / ödül kullanımı" value={`${data.couponUses} / ${data.rewardRedemptions}`} hint={`${data.pointsRedeemed} puan kullanıldı`} />
      </div>
      <p className="text-xs text-fg-subtle">Reddedilen ve iptal edilen siparişler hariçtir. Bu sayılar kampanya getirisi (ROI) değildir.</p>
    </section>
  );
}

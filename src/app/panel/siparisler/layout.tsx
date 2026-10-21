import { FeatureSection } from "@/components/billing/feature-gate";

/** Sipariş bölümü — paket kapısı "devam" kipinde: mevcut siparişler tamamlanır, yeni sipariş müşteri tarafında kapalıdır. */
export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return <FeatureSection feature="ordering" mode="continue">{children}</FeatureSection>;
}

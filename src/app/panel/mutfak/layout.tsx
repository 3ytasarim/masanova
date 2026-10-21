import { FeatureSection } from "@/components/billing/feature-gate";

/** Mutfak ekranı — paket kapısı "devam" kipinde: açık fişler paket düşse de tamamlanabilir. */
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return <FeatureSection feature="kds" mode="continue">{children}</FeatureSection>;
}

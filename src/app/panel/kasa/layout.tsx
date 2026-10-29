import { FeatureSection } from "@/components/billing/feature-gate";

/** Kasa ekranı — yalnızca Full paket (cashier_screen). */
export default function CashierLayout({ children }: { children: React.ReactNode }) {
  return <FeatureSection feature="cashier_screen" mode="screen">{children}</FeatureSection>;
}

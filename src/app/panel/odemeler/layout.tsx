import { requireTenantUser } from "@/lib/auth/guards";
import { PaymentTabs } from "@/components/payments/payment-tabs";
import { FeatureSection } from "@/components/billing/feature-gate";

/**
 * Ödemeler bölümü — payments.view (sahip, şube müdürü, kasiyer). Garson / mutfak / bar erişemez (gerçek 404; yetki
 * denetimi loading.tsx sınırının DIŞINDA). Sekmeler: Ödemeler · Ayarlar.
 */
export default async function PaymentsLayout({ children }: { children: React.ReactNode }) {
  await requireTenantUser({ permission: "payments.view" });
  return (
    <>
      <PaymentTabs />
      <FeatureSection feature="restaurant_payments" mode="continue">{children}</FeatureSection>
    </>
  );
}

import { requireTenantUser } from "@/lib/auth/guards";
import { FeatureSection } from "@/components/billing/feature-gate";

/**
 * Yetki denetimi loading.tsx sınırının DIŞINDA: sayfa içindeki notFound() akış başladıktan sonra 200 durum koduyla
 * dönerdi. Burada yetkisiz rol (garson, kasiyer, mutfak, bar) gerçek 404 alır. Sayfa kendi denetimini de yapar.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await requireTenantUser({ permission: "analytics.view" });
  return <FeatureSection feature="analytics" mode="screen">{children}</FeatureSection>;
}

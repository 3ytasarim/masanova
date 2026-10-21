import { requireTenantUser } from "@/lib/auth/guards";
import { FeatureSection } from "@/components/billing/feature-gate";

/**
 * Yetki denetimi loading.tsx sınırının DIŞINDA: sayfa içindeki notFound() akış başladıktan sonra 200 durum koduyla
 * dönerdi. Burada CRM yetkisi olmayan rol (kasiyer, garson, mutfak, bar) gerçek 404 alır. Sayfalar kendi denetimini de yapar.
 */
export default async function CustomersLayout({ children }: { children: React.ReactNode }) {
  await requireTenantUser({ permission: "crm.view" });
  return <FeatureSection feature="crm" mode="continue">{children}</FeatureSection>;
}

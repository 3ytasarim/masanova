import { requireTenantUser } from "@/lib/auth/guards";
import { FeatureSection } from "@/components/billing/feature-gate";

/** Yetki denetimi loading.tsx sınırının DIŞINDA (yetkisiz rol gerçek 404 alır). Sayfa kendi denetimini de yapar. */
export default async function LoyaltyLayout({ children }: { children: React.ReactNode }) {
  await requireTenantUser({ permission: "loyalty.view" });
  return <FeatureSection feature="loyalty" mode="screen">{children}</FeatureSection>;
}

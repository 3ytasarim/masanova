import { requireTenantUser } from "@/lib/auth/guards";
import { CampaignTabs } from "@/components/campaigns/campaign-tabs";
import { FeatureSection } from "@/components/billing/feature-gate";

/**
 * Kampanyalar bölümü — campaigns.view (sahip, şube müdürü). Yetki denetimi loading.tsx sınırının DIŞINDA (gerçek 404).
 * Sekmeler: Kampanyalar · Kuponlar · Sadakat Ödülleri. Her sayfa ayrıca kendi yetkisini denetler.
 */
export default async function CampaignsLayout({ children }: { children: React.ReactNode }) {
  await requireTenantUser({ permission: "campaigns.view" });
  return (
    <>
      <CampaignTabs />
      <FeatureSection feature="promotions" mode="screen">{children}</FeatureSection>
    </>
  );
}

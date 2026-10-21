import { siteConfig } from "@/config/site";
import { buildHomeJsonLd, buildHomeMetadata, serializeJsonLd } from "@/lib/marketing/seo";
import { AssistantKnowsSection } from "@/components/marketing/assistant-knows-section";
import { ComparisonSection } from "@/components/marketing/comparison-section";
import { AnalyticsSection } from "@/components/marketing/analytics-section";
import { DemoSection } from "@/components/marketing/demo-section";
import { FeaturesSection } from "@/components/marketing/features-section";
import { Hero } from "@/components/marketing/hero";
import { MenuSection } from "@/components/marketing/menu-section";
import { OperationsSection } from "@/components/marketing/operations-section";
import { PlansSection } from "@/components/marketing/plans-section";
import { QrSection } from "@/components/marketing/qr-section";
import { VoiceSection } from "@/components/marketing/voice-section";
import { WhatSection } from "@/components/marketing/what-section";

export const metadata = buildHomeMetadata(siteConfig);

/**
 * MasaNova AI platform ana sayfası (yalnızca platform / kök alan adı). Hikâye sırası:
 * hero → nedir + nasıl çalışır (yapışkan anlatı) → klasik servisle karşılaştırma → sesli AI → menüyü bilen garson + onaylı sesli sipariş → QR menü + sipariş → mutfak + servis → analitik
 * → QR etiket → özellikler + güven → paketler → demo → altbilgi. Metinler: src/content/marketing/copy.ts
 */
export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildHomeJsonLd(siteConfig)) }} />
      <Hero />
      <WhatSection />
      <ComparisonSection />
      <VoiceSection />
      <AssistantKnowsSection />
      <MenuSection />
      <OperationsSection />
      <AnalyticsSection />
      <QrSection />
      <FeaturesSection />
      <PlansSection />
      <DemoSection />
    </>
  );
}

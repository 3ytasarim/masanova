import type { Metadata } from "next";
import { ServiceTabs } from "@/components/service/service-tabs";
import { FeatureSection } from "@/components/billing/feature-gate";

export const metadata: Metadata = { title: { default: "Servis", template: "%s · Servis · MasaNova Panel" } };

/** Ön salon servis talepleri (garson çağrısı, su, peçete, hesap, özel istek). Yetki her sayfada sunucuda denetlenir. */
export default function ServiceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="pb-2">
        <h1 className="text-title font-semibold text-fg">Servis</h1>
        <p className="mt-1.5 text-[0.9375rem] text-fg-subtle">Masalardan gelen garson çağrıları, su / peçete / hesap ve özel istekler — canlı.</p>
      </header>
      <ServiceTabs />
      <FeatureSection feature="service_requests" mode="continue">{children}</FeatureSection>
    </>
  );
}

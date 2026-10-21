import { MarketingTracker } from "@/components/marketing/marketing-tracker";
import { RevealObserver } from "@/components/marketing/reveal-observer";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

/**
 * Pazarlama düzeni — yalnızca platform kök alan adında (kiracı alan adları proxy'de /site'a yeniden yazılır).
 * Satır içi bayrak: JS varsa açığa çıkma animasyonları etkinleşir; JS yoksa içerik zaten görünür (ilerleyici iyileştirme).
 */
const JS_FLAG = "document.documentElement.setAttribute('data-mk-js','')";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-bg focus:px-4 focus:py-2.5 focus:shadow-md"
      >
        İçeriğe geç
      </a>
      <SiteHeader />
      <main id="icerik" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
      <RevealObserver />
      <MarketingTracker />
    </>
  );
}

"use client";

import { AssistantSheet, KdsTicket, Layer, MenuScreen, PhoneFrame, ScanScreen, ServiceToast } from "@/components/marketing/phone";
import { useDemoLoop } from "@/components/marketing/use-demo-loop";

/**
 * Hero canlandırması — sistemi anlatan sahne dizisi (rastgele süs değil):
 *   0 QR okutulur → 1 menü açılır → 2 asistan dinler → 3 soru → 4 menüden öneri → 5 fiş mutfağa düşer
 *   → 6 hazırlanıyor → 7 hazır + servis bildirimi → (döngü)
 * Gerçek mikrofon / ses / AI YOK. Görünmüyorken durur; hareket azaltmada son sahne (tüm bilgi) sabit gösterilir.
 */
const DURATIONS = [2200, 1600, 1700, 1400, 2600, 1400, 1700, 3400] as const;

export function HeroDemo() {
  const { ref, step, paused } = useDemoLoop<HTMLDivElement>(DURATIONS);
  const sheet = step >= 2 ? (step === 2 ? "listening" : step === 3 ? "asked" : "answered") : null;
  const ticket = step >= 5 ? ((step - 5) as 0 | 1 | 2) : null;

  return (
    <div ref={ref} aria-hidden="true" data-testid="hero-demo" data-step={step} data-paused={paused ? "" : undefined} className="relative mx-auto w-full max-w-[460px] select-none pb-6 pt-2">
      <div className="pointer-events-none absolute inset-x-6 top-10 bottom-0 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(234_88_12/0.35),transparent)] blur-2xl" />
      <PhoneFrame className="mx-auto w-[min(70vw,290px)]">
        <Layer show={step === 0}>
          <ScanScreen />
        </Layer>
        <Layer show={step >= 1}>
          <MenuScreen highlight={step >= 4} />
        </Layer>
        <div className={sheet ? "transition-all duration-700" : "pointer-events-none translate-y-full opacity-0 transition-all duration-700"}>
          <AssistantSheet phase={sheet ?? "listening"} />
        </div>
      </PhoneFrame>

      <div className={`absolute bottom-16 right-0 z-30 transition-all duration-700 sm:-right-2 lg:-right-10 ${ticket !== null ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
        <KdsTicket state={ticket ?? 0} compact className="mk-float" />
      </div>
      <ServiceToast show={step === 7} className="absolute bottom-0 left-0 z-30 sm:-left-2 lg:-left-10" />
    </div>
  );
}

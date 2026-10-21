import { ArrowRight, Check, PlayCircle } from "lucide-react";
import { CTA, HERO, HERO_SCENES } from "@/content/marketing/copy";
import { HeroDemo } from "@/components/marketing/hero-demo";

/**
 * Hero: solda değer önerisi + CTA (ekranın üst kısmında, mobilde demodan ÖNCE), sağda sistemi anlatan canlandırma.
 * H1 sayfadaki TEK H1. Canlandırma süs (aria-hidden); aynı akış ekran okuyucu için metin olarak da var.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-baslik" className="mk-dark relative isolate overflow-hidden bg-bg text-fg">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 right-[-10%] h-[620px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgb(234_88_12/0.22),transparent)]" />
        <div className="absolute -bottom-40 left-[-15%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(120_53_15/0.25),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      </div>
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-24 sm:px-6 sm:pt-28 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:px-8 lg:pb-24 lg:pt-36">
        <div className="animate-rise-in">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-fg-muted">
            <span className="size-1.5 rounded-full bg-orange-400" />
            {HERO.eyebrow}
          </p>
          <h1 id="hero-baslik" className="mt-5 text-[clamp(2.4rem,1.6rem+4vw,4.75rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-balance">
            {HERO.title}
          </h1>
          <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-pretty text-fg-muted sm:text-lg">{HERO.lead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <a
              href="#demo"
              data-track="MARKETING_DEMO_CTA"
              data-track-placement="hero"
              data-testid="hero-primary-cta"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#c2410c] px-6 text-[0.9375rem] font-semibold text-white shadow-[0_10px_30px_-10px_rgb(234_88_12/0.8)] transition-colors hover:bg-[#9a3412]"
            >
              {CTA.demo}
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
            <a
              href="#nasil-calisir"
              data-track="MARKETING_HOW_IT_WORKS"
              data-track-placement="hero"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 px-6 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-white/10"
            >
              {CTA.howItWorks}
            </a>
            <a href="#sesli-asistan" data-track="MARKETING_VOICE_DEMO" data-track-placement="hero" className="inline-flex h-12 items-center justify-center gap-2 px-2 text-sm font-medium text-fg-muted hover:text-fg">
              <PlayCircle aria-hidden="true" className="size-4 text-orange-400" />
              {CTA.watchVoice}
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-fg-subtle">
            {HERO.assurances.map((a) => (
              <li key={a} className="inline-flex items-center gap-1.5">
                <Check aria-hidden="true" className="size-4 text-orange-400" />
                {a}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <p className="sr-only">{HERO_SCENES.summary}</p>
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}

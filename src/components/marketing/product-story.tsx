"use client";

import { useEffect, useRef, useState } from "react";
import { STORY } from "@/content/marketing/copy";
import { cn } from "@/lib/utils/cn";
import { AnalyticsScreen, AssistantSheet, KdsScreen, Layer, MenuScreen, OrderScreen, PhoneFrame } from "@/components/marketing/phone";

type StoryKey = (typeof STORY)[number]["key"];

function Screen({ k }: { k: StoryKey }) {
  if (k === "menu") return <MenuScreen />;
  if (k === "ai")
    return (
      <>
        <MenuScreen />
        <AssistantSheet phase="answered" />
      </>
    );
  if (k === "order") return <OrderScreen />;
  if (k === "kds") return <KdsScreen />;
  return <AnalyticsScreen />;
}

/**
 * Yapışkan ürün anlatısı (yalnızca lg+): solda metin adımları kaydırıldıkça etkinleşir, sağdaki telefon aynı adımı
 * gösterir. lg altında normal yığın: her adımın kendi küçük maketi var (yapışkan / kaydırma bağımlılığı yok).
 * Metin her zaman HTML'de; JS yoksa ilk ekran gösterilir.
 */
export function ProductStory() {
  const [active, setActive] = useState<StoryKey>("menu");
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const key = hit?.target.getAttribute("data-story") as StoryKey | null;
        if (key) setActive(key);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.5, 1] },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="mt-16 grid gap-10 lg:mt-28 lg:grid-cols-[1fr_minmax(0,380px)] lg:gap-20" data-testid="product-story">
      <ol className="grid gap-8 sm:gap-12 lg:gap-0">
        {STORY.map((s, i) => (
          <li
            key={s.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-story={s.key}
            data-active={active === s.key ? "" : undefined}
            className="grid gap-6 sm:grid-cols-[1fr_200px] sm:items-center lg:flex lg:min-h-[60vh] lg:flex-col lg:justify-center"
          >
            <div className={cn("transition-colors duration-500 lg:max-w-md lg:border-l-2 lg:pl-6", active === s.key ? "lg:border-accent" : "lg:border-border")}>
              <span className="inline-flex rounded-full border border-border bg-bg px-2.5 py-1 text-xs font-semibold text-fg-muted">{s.label}</span>
              <h3 className="mt-4 text-[clamp(1.5rem,1.2rem+1.2vw,2.25rem)] font-semibold leading-tight tracking-[-0.025em] text-balance">{s.title}</h3>
              <p className="mt-3 text-[1.0625rem] leading-relaxed text-fg-muted">{s.text}</p>
            </div>
            <div aria-hidden="true" className="mx-auto hidden w-[200px] sm:block lg:hidden">
              <PhoneFrame>
                <Screen k={s.key} />
              </PhoneFrame>
            </div>
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="hidden lg:block">
        <div className="sticky top-[calc(50vh-300px)]">
          <PhoneFrame className="mx-auto w-[290px]">
            {STORY.map((s) => (
              <Layer key={s.key} show={active === s.key}>
                <Screen k={s.key} />
              </Layer>
            ))}
          </PhoneFrame>
          <div className="mt-5 flex justify-center gap-1.5">
            {STORY.map((s) => (
              <span key={s.key} className={cn("h-1.5 rounded-full transition-all duration-500", active === s.key ? "w-6 bg-accent" : "w-1.5 bg-border-strong")} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

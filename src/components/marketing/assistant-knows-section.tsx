import { CheckCircle2, Mic, Volume2 } from "lucide-react";
import { MENU_QA, VOICE_FLOW } from "@/content/marketing/copy";
import { FoodPhoto } from "@/components/marketing/food-photo";
import { MenuQa } from "@/components/marketing/menu-qa";
import { SectionHeading } from "@/components/marketing/section-heading";

const STEP_ICONS = [Mic, Volume2, CheckCircle2] as const;

/** Sesli AI bölümünün devamı: "Menünüzü bilen garson" etkileşimi + onaylı sesli sipariş akışı (3 adım). */
export function AssistantKnowsSection() {
  return (
    <>
      <section id={MENU_QA.id} aria-labelledby={`${MENU_QA.id}-baslik`} className="scroll-mt-20 bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_1fr] lg:items-center lg:gap-16 lg:px-8 lg:py-28">
          <div data-reveal="scale" className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] shadow-[0_40px_80px_-40px_rgb(12_10_9/0.55)] ring-1 ring-black/5">
              <FoodPhoto photo={MENU_QA.product.photo} sizes="(min-width: 1024px) 460px, 90vw" />
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-3 text-white">
                <div>
                  <span className="rounded-full bg-white/15 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider backdrop-blur">{MENU_QA.product.tag}</span>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">{MENU_QA.product.name}</p>
                </div>
                <p className="text-xl font-semibold tabular-nums">{MENU_QA.product.price}</p>
              </div>
            </div>
          </div>
          <div>
            <SectionHeading id={MENU_QA.id} eyebrow={MENU_QA.eyebrow} title={MENU_QA.title} lead={MENU_QA.lead} />
            <div className="mt-8">
              <MenuQa />
            </div>
          </div>
        </div>
      </section>

      <section id={VOICE_FLOW.id} aria-labelledby={`${VOICE_FLOW.id}-baslik`} className="scroll-mt-20 border-t border-border bg-bg">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <SectionHeading id={VOICE_FLOW.id} eyebrow={VOICE_FLOW.eyebrow} title={VOICE_FLOW.title} lead={VOICE_FLOW.lead} align="center" />
          <ol className="relative mt-14 grid gap-5 md:grid-cols-3" data-testid="voice-flow-steps">
            <span aria-hidden="true" className="absolute inset-x-[16%] top-7 hidden h-px bg-[linear-gradient(90deg,transparent,rgb(234_88_12/0.5),transparent)] md:block" />
            {VOICE_FLOW.steps.map((s, i) => {
              const Icon = STEP_ICONS[i]!;
              return (
                <li key={s.title} data-reveal="" style={{ ["--reveal-delay" as string]: `${i * 140}ms` }} className="relative flex flex-col items-center rounded-3xl border border-border bg-surface px-6 pb-7 pt-8 text-center">
                  <span className="relative grid size-14 place-items-center rounded-full bg-[linear-gradient(135deg,#ea580c,#dc2626)] text-white shadow-[0_12px_30px_-10px_rgb(234_88_12/0.7)]">
                    <Icon aria-hidden="true" className="size-6" />
                    <span className="absolute -end-1 -top-1 grid size-6 place-items-center rounded-full bg-fg text-[0.75rem] font-bold text-bg">{i + 1}</span>
                  </span>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">{s.text}</p>
                  <p className="mt-5 rounded-2xl bg-bg px-4 py-3 text-[0.9375rem] font-medium italic text-fg ring-1 ring-border">{s.quote}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </>
  );
}

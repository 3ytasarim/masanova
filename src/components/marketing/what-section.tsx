import { HOW, WHAT } from "@/content/marketing/copy";
import { SectionHeading } from "@/components/marketing/section-heading";
import { ProductStory } from "@/components/marketing/product-story";

/** "MasaNova nedir?" + "Nasıl çalışır?" (4 adım, kaydırmayla açığa çıkar) + yapışkan ürün anlatısı. */
export function WhatSection() {
  return (
    <>
      <section id={WHAT.id} aria-labelledby={`${WHAT.id}-baslik`} className="scroll-mt-20 bg-bg">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-end">
            <SectionHeading id={WHAT.id} eyebrow={WHAT.eyebrow} title={WHAT.title} lead={WHAT.lead} />
            <div className="grid gap-4 sm:grid-cols-2">
              {WHAT.pillars.map((p, i) => (
                <div key={p.title} data-reveal="" style={{ ["--reveal-delay" as string]: `${i * 120}ms` }} className="rounded-2xl border border-border bg-surface p-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-fg-subtle">{p.title}</h3>
                  <ul className="mt-4 grid gap-2.5">
                    {p.items.map((item) => (
                      <li key={item} className="flex items-center gap-2.5 text-[0.9375rem] font-medium">
                        <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id={HOW.id} aria-labelledby={`${HOW.id}-baslik`} className="scroll-mt-20 border-t border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <SectionHeading id={HOW.id} eyebrow={HOW.eyebrow} title={HOW.title} />
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="how-steps">
            {HOW.steps.map((s, i) => (
              <li key={s.title} data-reveal="" style={{ ["--reveal-delay" as string]: `${i * 110}ms` }} className="relative rounded-2xl border border-border bg-bg p-6">
                <span className="font-mono text-sm font-semibold text-accent-strong">0{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{s.text}</p>
              </li>
            ))}
          </ol>
          <ProductStory />
        </div>
      </section>
    </>
  );
}

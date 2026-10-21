import { Check } from "lucide-react";
import { PLANS_COPY } from "@/content/marketing/copy";
import { planCards } from "@/lib/marketing/plans";
import { cn } from "@/lib/utils/cn";
import { SectionHeading } from "@/components/marketing/section-heading";

/** Paketler — içerik `config/plans.ts` tablosundan türetilir; fiyat UYDURULMAZ ("Fiyat için iletişime geçin"). */
export function PlansSection() {
  const cards = planCards();
  return (
    <section id={PLANS_COPY.id} aria-labelledby={`${PLANS_COPY.id}-baslik`} className="scroll-mt-20 bg-bg">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <SectionHeading id={PLANS_COPY.id} eyebrow={PLANS_COPY.eyebrow} title={PLANS_COPY.title} lead={PLANS_COPY.lead} align="center" />
        <ul className="mt-12 grid gap-4 lg:grid-cols-3" data-testid="plans">
          {cards.map((c, i) => (
            <li
              key={c.plan}
              data-plan={c.plan}
              data-reveal=""
              style={{ ["--reveal-delay" as string]: `${i * 100}ms` }}
              className={cn("relative flex flex-col rounded-[1.75rem] border p-6 sm:p-8", c.highlighted ? "mk-dark border-transparent bg-bg text-fg shadow-[0_30px_60px_-30px_rgb(12_10_9/0.6)]" : "border-border bg-surface")}
            >
              {c.highlighted ? <span className="absolute right-6 top-6 rounded-full bg-[#c2410c] px-2.5 py-1 text-xs font-semibold text-white">{PLANS_COPY.recommended}</span> : null}
              <h3 className="text-2xl font-semibold tracking-tight">{c.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted lg:min-h-[2.75rem]">{c.summary}</p>
              <p className="mt-6 text-lg font-semibold" data-testid="plan-price">
                {c.priceLabel}
              </p>
              <div className="mt-6 flex-1 border-t border-border pt-6">
                {c.includesPrevious ? <p className="mb-3 text-sm font-semibold">{PLANS_COPY.includes(c.includesPrevious)}</p> : null}
                <ul className="grid gap-2.5">
                  {c.adds.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-strong" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <a
                href="#demo"
                data-track="MARKETING_PLAN_CTA"
                data-track-placement={c.plan}
                className={cn(
                  "mt-8 inline-flex h-12 items-center justify-center rounded-full text-[0.9375rem] font-semibold transition-colors",
                  c.highlighted ? "bg-[#c2410c] text-white hover:bg-[#9a3412]" : "border border-border-strong bg-bg text-fg hover:bg-surface-2",
                )}
              >
                {PLANS_COPY.cta}
                <span className="sr-only"> — {c.name} paketi</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

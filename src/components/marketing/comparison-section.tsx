import { Check, X } from "lucide-react";
import { COMPARE } from "@/content/marketing/copy";
import { SectionHeading } from "@/components/marketing/section-heading";

/** Klasik servis ile MasaNova karşılaştırması — masaüstünde tablo, mobilde satır kartları. Yalnızca gerçek özellikler. */
export function ComparisonSection() {
  return (
    <section id={COMPARE.id} aria-labelledby={`${COMPARE.id}-baslik`} className="mk-dark scroll-mt-20 bg-bg text-fg">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <SectionHeading id={COMPARE.id} eyebrow={COMPARE.eyebrow} title={COMPARE.title} lead={COMPARE.lead} align="center" />

        {/* Masaüstü: tablo */}
        <div data-reveal="" className="mt-14 hidden overflow-hidden rounded-3xl border border-white/10 md:block" data-testid="compare-table">
          <table className="w-full border-collapse text-left text-[0.9375rem]">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wider">
                <th scope="col" className="w-[22%] bg-white/[0.03] px-6 py-4 text-fg-subtle">{COMPARE.head.area}</th>
                <th scope="col" className="bg-white/[0.03] px-6 py-4 text-fg-subtle">{COMPARE.head.classic}</th>
                <th scope="col" className="bg-[linear-gradient(135deg,rgb(234_88_12/0.28),rgb(220_38_38/0.18))] px-6 py-4 text-orange-200">{COMPARE.head.masanova}</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.rows.map((r) => (
                <tr key={r.area} className="border-t border-white/[0.07]">
                  <th scope="row" className="px-6 py-4 font-semibold text-orange-300/90">{r.area}</th>
                  <td className="px-6 py-4 text-fg-muted">
                    <span className="inline-flex items-start gap-2.5">
                      <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                      {r.classic}
                    </span>
                  </td>
                  <td className="bg-orange-500/[0.07] px-6 py-4 font-medium text-fg">
                    <span className="inline-flex items-start gap-2.5">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-orange-400" />
                      {r.masanova}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobil: satır başına kart */}
        <ul className="mt-12 grid gap-3 md:hidden" data-testid="compare-cards">
          {COMPARE.rows.map((r, i) => (
            <li key={r.area} data-reveal="" style={{ ["--reveal-delay" as string]: `${i * 60}ms` }} className="overflow-hidden rounded-2xl border border-white/10">
              <p className="bg-white/[0.04] px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-orange-300/90">{r.area}</p>
              <div className="grid gap-2 px-4 py-3.5 text-[0.9375rem]">
                <p className="flex items-start gap-2.5 text-fg-muted">
                  <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                  <span>
                    <span className="sr-only">{COMPARE.head.classic}: </span>
                    {r.classic}
                  </span>
                </p>
                <p className="flex items-start gap-2.5 font-medium text-fg">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-orange-400" />
                  <span>
                    <span className="sr-only">{COMPARE.head.masanova}: </span>
                    {r.masanova}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import { BadgeCheck, Coins, PackageCheck, ShieldAlert, ShieldCheck, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { VOICE } from "@/content/marketing/copy";
import { SectionHeading } from "@/components/marketing/section-heading";
import { VoiceDemo } from "@/components/marketing/voice-demo";

const CAP_ICONS: LucideIcon[] = [UtensilsCrossed, Coins, PackageCheck, ShieldAlert];

/** Ana farklılaştırıcı: sesli AI. Koyu bölüm; örnek sorular, yetenekler, 5 dil, "AI önerir, veri doğrular". */
export function VoiceSection() {
  return (
    <section id={VOICE.id} aria-labelledby={`${VOICE.id}-baslik`} className="mk-dark scroll-mt-20 bg-bg text-fg">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_minmax(0,560px)] lg:items-center lg:gap-16">
          <div>
            <SectionHeading id={VOICE.id} eyebrow={VOICE.eyebrow} title={VOICE.title} lead={VOICE.lead} />
            <ul className="mt-7 flex flex-wrap gap-2" aria-label="Örnek sorular">
              {VOICE.examples.map((q) => (
                <li key={q} lang={q.startsWith("Do you") ? "en" : "tr"} className="rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-sm text-fg-muted">
                  “{q}”
                </li>
              ))}
            </ul>
            <ul className="mt-10 grid gap-5 sm:grid-cols-2">
              {VOICE.capabilities.map((c, i) => {
                const Icon = CAP_ICONS[i] ?? BadgeCheck;
                return (
                  <li key={c.title} data-reveal="" style={{ ["--reveal-delay" as string]: `${i * 90}ms` }} className="flex gap-3">
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-orange-400">
                      <Icon aria-hidden="true" className="size-4.5" />
                    </span>
                    <div>
                      <h3 className="font-semibold">{c.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-fg-subtle">{c.text}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div data-reveal="scale">
            <VoiceDemo />
          </div>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-2">
          <div data-reveal="" className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-6 sm:p-8" data-testid="voice-languages">
            <h3 className="text-lg font-semibold">{VOICE.languagesTitle}</h3>
            <ul className="mt-5 flex flex-wrap gap-2.5">
              {VOICE.languages.map((l) => (
                <li key={l.code} className="inline-flex items-center gap-2 rounded-full border border-white/12 px-3.5 py-2 text-sm">
                  <span className="font-semibold text-orange-400">{l.code}</span>
                  <span lang={l.code.toLowerCase()} className="text-fg-muted">
                    {l.name}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-fg-subtle">{VOICE.languagesNote}</p>
          </div>
          <div data-reveal="" style={{ ["--reveal-delay" as string]: "120ms" }} className="rounded-[1.5rem] border border-orange-400/25 bg-[linear-gradient(135deg,rgb(234_88_12/0.16),transparent_60%)] p-6 sm:p-8" data-testid="safe-ai">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck aria-hidden="true" className="size-5 text-orange-400" />
              {VOICE.safeTitle}
            </h3>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {VOICE.safePoints.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-fg-muted">
                  <BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-orange-400" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

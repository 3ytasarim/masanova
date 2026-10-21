import { Check, MessageCircle } from "lucide-react";
import { CTA, DEMO } from "@/content/marketing/copy";
import { whatsappLink } from "@/lib/marketing/contact";
import { publicEnv } from "@/lib/env.public";
import { DemoRequestForm } from "@/components/marketing/demo-request-form";

/** Demo dönüşümü: mevcut demo talep formu (Zod + bot tuzağı + hız sınırı) — ikinci bir form YOK. */
export function DemoSection() {
  const whatsapp = whatsappLink(publicEnv.NEXT_PUBLIC_CONTACT_WHATSAPP);
  return (
    <section id={DEMO.id} aria-labelledby={`${DEMO.id}-baslik`} className="mk-dark scroll-mt-20 bg-bg text-fg">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.25fr] lg:gap-16 lg:px-8 lg:py-28">
        <div data-reveal="">
          <h2 id={`${DEMO.id}-baslik`} className="text-[clamp(1.875rem,1.4rem+2vw,3rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-balance">
            {DEMO.title}
          </h2>
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-fg-muted">{DEMO.lead}</p>
          <ul className="mt-7 grid gap-3">
            {DEMO.points.map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-fg-muted">
                <Check aria-hidden="true" className="size-4 text-orange-400" />
                {p}
              </li>
            ))}
          </ul>
          {whatsapp ? (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              data-track="MARKETING_WHATSAPP_CTA"
              data-track-placement="demo"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full border border-white/15 px-5 text-sm font-semibold text-white hover:bg-white/10"
            >
              <MessageCircle aria-hidden="true" className="size-4" />
              {CTA.whatsapp}
            </a>
          ) : null}
        </div>
        <div className="mk-light [&_form]:rounded-[1.5rem]">
          <DemoRequestForm />
        </div>
      </div>
    </section>
  );
}

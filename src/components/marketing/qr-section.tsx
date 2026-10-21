import { Mic } from "lucide-react";
import { QR } from "@/content/marketing/copy";
import { QrArt } from "@/components/marketing/art";
import { SectionHeading } from "@/components/marketing/section-heading";

/**
 * Masa QR etiketi vitrini — Sprint 4 etiket şablonlarının görsel dili (masa çadırı + marka şeridi). QR deseni
 * TEMSİLİDİR (gerçek adres kodlamaz); teknik belirteç ayrıntısı gösterilmez.
 */
export function QrSection() {
  return (
    <section id={QR.id} aria-labelledby={`${QR.id}-baslik`} className="scroll-mt-20 bg-bg">
      <div className="mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_minmax(0,520px)] lg:items-center lg:gap-20 lg:px-8 lg:py-28">
        <div>
          <SectionHeading id={QR.id} eyebrow={QR.eyebrow} title={QR.title} lead={QR.lead} />
          <ul className="mt-10 grid gap-6 sm:grid-cols-2">
            {QR.points.map((p, i) => (
              <li key={p.title} data-reveal="" style={{ ["--reveal-delay" as string]: `${i * 90}ms` }}>
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{p.text}</p>
              </li>
            ))}
          </ul>
        </div>
        <div aria-hidden="true" data-reveal="scale" className="relative mx-auto w-full max-w-[460px]" data-testid="qr-label">
          <div className="absolute inset-x-8 bottom-0 top-16 -z-10 rounded-[2rem] bg-surface-2" />
          <div className="mx-auto w-[min(78vw,320px)] -rotate-2 overflow-hidden rounded-[1.5rem] bg-white shadow-[0_40px_70px_-35px_rgb(12_10_9/0.45)] ring-1 ring-black/5">
            <div className="flex items-center justify-between bg-stone-900 px-5 py-3 text-white">
              <span className="text-sm font-semibold">{QR.label.brand}</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">{QR.label.table}</span>
            </div>
            <div className="grid justify-items-center gap-4 px-8 pb-7 pt-6">
              <QrArt className="w-[70%]" seed={42} />
              <div className="text-center">
                <p className="text-lg font-semibold text-stone-900">{QR.label.cta}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-stone-500">
                  <Mic className="size-3.5 text-orange-600" /> {QR.label.hint}
                </p>
              </div>
            </div>
            <div className="h-1.5 bg-[linear-gradient(90deg,#c2410c,#f97316)]" />
          </div>
          <p className="mt-6 text-center text-xs text-fg-subtle">Örnek etiket — QR deseni temsilidir.</p>
        </div>
      </div>
    </section>
  );
}

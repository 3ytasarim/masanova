import { KDS, SERVICE } from "@/content/marketing/copy";
import { KdsDemo, ServiceDemo } from "@/components/marketing/operations-demos";
import { SectionHeading } from "@/components/marketing/section-heading";

/** Restoran tarafı: mutfak ekranı (koyu, mutfak ekranına benzer) + servis talepleri (açık). */
export function OperationsSection() {
  return (
    <>
      <section id={KDS.id} aria-labelledby={`${KDS.id}-baslik`} className="mk-dark scroll-mt-20 bg-bg text-fg">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_minmax(0,600px)] lg:items-center lg:gap-16 lg:px-8 lg:py-28">
          <SectionHeading id={KDS.id} eyebrow={KDS.eyebrow} title={KDS.title} lead={KDS.lead}>
            <p className="mt-6 text-sm text-fg-subtle">Burger → Izgara · Limonata → Bar · Sütlaç → Tatlı. Hazırlanıyor → Hazır.</p>
          </SectionHeading>
          <div data-reveal="scale">
            <KdsDemo />
          </div>
        </div>
      </section>

      <section id={SERVICE.id} aria-labelledby={`${SERVICE.id}-baslik`} className="scroll-mt-20 bg-bg">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,520px)_1fr] lg:items-center lg:gap-20 lg:px-8 lg:py-28">
          <div data-reveal="scale" className="order-2 rounded-[1.75rem] border border-border bg-surface p-4 sm:p-6 lg:order-1">
            <ServiceDemo />
          </div>
          <div className="order-1 lg:order-2">
            <SectionHeading id={SERVICE.id} eyebrow={SERVICE.eyebrow} title={SERVICE.title} lead={SERVICE.lead}>
              <ul className="mt-6 flex flex-wrap gap-2">
                {SERVICE.requests.map((r) => (
                  <li key={r} className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg-muted">
                    {r}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-fg-subtle">{SERVICE.note}</p>
            </SectionHeading>
          </div>
        </div>
      </section>
    </>
  );
}

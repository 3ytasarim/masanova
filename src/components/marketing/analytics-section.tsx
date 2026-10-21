import { TrendingUp } from "lucide-react";
import { ANALYTICS } from "@/content/marketing/copy";
import { SectionHeading } from "@/components/marketing/section-heading";

/**
 * Analitik vitrini — Sprint 12 kavramları; değerler AÇIKÇA örnek (canlı veri değil). Çubuklar bölüm göründüğünde
 * bir kez büyür (CSS, .mk-bar); sayılar sürekli değişmez. Grafik metin olarak da okunur (tablo yerine liste).
 */
export function AnalyticsSection() {
  const max = Math.max(...ANALYTICS.hours.map((h) => h.v));
  return (
    <section id={ANALYTICS.id} aria-labelledby={`${ANALYTICS.id}-baslik`} className="scroll-mt-20 border-t border-border bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <SectionHeading id={ANALYTICS.id} eyebrow={ANALYTICS.eyebrow} title={ANALYTICS.title} lead={ANALYTICS.lead} />
        <div data-reveal="" className="mt-12 rounded-[1.75rem] border border-border bg-bg p-4 shadow-[0_30px_60px_-40px_rgb(12_10_9/0.4)] sm:p-6 lg:p-8" data-testid="analytics-demo">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">Genel bakış · Bugün</p>
            <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning">{ANALYTICS.sampleNote}</span>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {ANALYTICS.kpis.map((k) => (
              <div key={k.label} className="rounded-2xl border border-border p-4">
                <dt className="text-sm text-fg-muted">{k.label}</dt>
                <dd className="mt-2 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[clamp(1.375rem,1.1rem+1vw,1.875rem)] font-semibold tracking-tight tabular-nums">{k.value}</span>
                  <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-success">
                    {k.delta.startsWith("+") ? <TrendingUp aria-hidden="true" className="size-3" /> : null}
                    {k.delta}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <figure className="rounded-2xl border border-border p-4 sm:p-5">
              <figcaption className="text-sm font-semibold">Yoğun saatler (sipariş)</figcaption>
              <div aria-hidden="true" className="mt-5 flex h-44 items-end gap-2 sm:gap-3">
                {ANALYTICS.hours.map((h, i) => (
                  <div key={h.h} className="flex h-full flex-1 flex-col items-center gap-2">
                    <div className="flex w-full flex-1 items-end">
                      <span className={`mk-bar block w-full rounded-t-md ${h.v === max ? "bg-accent" : "bg-surface-3"}`} style={{ height: `${(h.v / max) * 100}%`, ["--bar-delay" as string]: `${i * 60}ms` }} />
                    </div>
                    <span className="text-xs tabular-nums text-fg-subtle">{h.h}:00</span>
                  </div>
                ))}
              </div>
              <p className="sr-only">En yoğun saat 20:00; ardından 19:00 ve 21:00.</p>
            </figure>
            <div className="grid content-start gap-3">
              <div className="rounded-2xl border border-border p-4">
                <p className="text-sm text-fg-muted">Servis yanıt süresi (medyan)</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">1 dk 40 sn</p>
              </div>
              <div className="rounded-2xl border border-border p-4">
                <p className="text-sm text-fg-muted">AI kullanımı</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">42 konuşma</p>
              </div>
              <ul className="flex flex-wrap gap-2 pt-1">
                {ANALYTICS.more.map((m) => (
                  <li key={m} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-muted">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-6 text-xs text-fg-subtle">{ANALYTICS.definition}</p>
        </div>
      </div>
    </section>
  );
}

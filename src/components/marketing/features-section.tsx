import { BarChart3, Bell, CalendarClock, ChefHat, LayoutGrid, Mic, Palette, Printer, QrCode, ShieldCheck, ShoppingBag, Split, Store, type LucideIcon } from "lucide-react";
import { FEATURES, TRUST } from "@/content/marketing/copy";
import { SectionHeading } from "@/components/marketing/section-heading";

const ICONS: Record<(typeof FEATURES.items)[number]["icon"], LucideIcon> = {
  qr: QrCode,
  table: LayoutGrid,
  bag: ShoppingBag,
  chef: ChefHat,
  split: Split,
  bell: Bell,
  mic: Mic,
  chart: BarChart3,
  calendar: CalendarClock,
  printer: Printer,
  store: Store,
  palette: Palette,
};

/** Kompakt özellik ızgarası (12 madde) + ürün güven ifadeleri (uydurma referans / sayı YOK). */
export function FeaturesSection() {
  return (
    <section id={FEATURES.id} aria-labelledby={`${FEATURES.id}-baslik`} className="scroll-mt-20 border-t border-border bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <SectionHeading id={FEATURES.id} eyebrow={FEATURES.eyebrow} title={FEATURES.title} align="center" />
        <ul className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" data-testid="feature-grid">
          {FEATURES.items.map((f, i) => {
            const Icon = ICONS[f.icon];
            return (
              <li key={f.title} data-reveal="" style={{ ["--reveal-delay" as string]: `${(i % 4) * 70}ms` }} className="rounded-2xl border border-border bg-bg p-4 sm:p-5">
                <Icon aria-hidden="true" className="size-5 text-accent-strong" />
                <h3 className="mt-3 font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{f.text}</p>
              </li>
            );
          })}
        </ul>

        <div className="mt-16 rounded-[1.75rem] border border-border bg-bg p-6 sm:p-8 lg:p-10" data-testid="trust">
          <h3 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <ShieldCheck aria-hidden="true" className="size-5 text-accent-strong" />
            {TRUST.title}
          </h3>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.items.map((t) => (
              <li key={t.title}>
                <p className="font-semibold">{t.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{t.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

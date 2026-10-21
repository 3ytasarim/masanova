import { Check, Languages, Plus } from "lucide-react";
import { MENU, ORDER } from "@/content/marketing/copy";
import { cn } from "@/lib/utils/cn";
import { FoodPhoto } from "@/components/marketing/food-photo";
import { OrderScreen, PhoneFrame } from "@/components/marketing/phone";
import { SectionHeading } from "@/components/marketing/section-heading";

/** Menü arayüzünün desteklediği diller (sesli asistandan ayrı; RU menü arayüzünde yok → gösterilmez). */
const MENU_UI_LOCALES = ["TR", "EN", "DE", "AR"];

/** QR menü vitrini + masadan sipariş akışı (ödeme yok — "Masadan sipariş"). */
export function MenuSection() {
  const [featured, ...rest] = MENU.sample.products;
  return (
    <>
      <section id={MENU.id} aria-labelledby={`${MENU.id}-baslik`} className="scroll-mt-20 bg-bg">
        <div className="mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_1fr] lg:items-center lg:gap-20 lg:px-8 lg:py-28">
          <div aria-hidden="true" data-reveal="scale" className="relative order-2 lg:order-1" data-testid="menu-showcase">
            <div className="rounded-[2rem] border border-border bg-[#faf8f5] p-4 shadow-[0_30px_60px_-30px_rgb(12_10_9/0.35)] sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-1.5 overflow-hidden">
                  {MENU.sample.categories.map((c, i) => (
                    <span key={c} className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-medium", i === 0 ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-700")}>
                      {c}
                    </span>
                  ))}
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-1 text-[0.7rem] font-semibold text-stone-600">
                  <Languages className="size-3.5" />
                  {MENU_UI_LOCALES.join(" · ")}
                </span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-[1.2fr_1fr]">
                <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                  <div className="aspect-[4/3]">
                    <FoodPhoto photo={featured.photo} sizes="(min-width: 1024px) 320px, 60vw" />
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-stone-900">{featured.name}</p>
                      <p className="font-semibold text-stone-900">{featured.price}</p>
                    </div>
                    <p className="mt-1 text-sm text-stone-500">{featured.desc}</p>
                    <div className="mt-3 flex gap-1.5">
                      {MENU.sample.variants.map((v, i) => (
                        <span key={v} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", i === 0 ? "bg-stone-900 text-white" : "border border-stone-200 text-stone-700")}>
                          {v}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 flex items-center gap-2 text-xs text-stone-600">
                      <span className="grid size-4 place-items-center rounded bg-stone-900 text-white">
                        <Check className="size-3" />
                      </span>
                      {MENU.sample.modifiers[0]}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.7rem] font-medium text-amber-800">Alerjen: {featured.tags[0]}</span>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[0.7rem] font-medium text-stone-600">~15 dk</span>
                    </div>
                    <span className="mt-4 flex h-10 items-center justify-center gap-1.5 rounded-full bg-stone-900 text-sm font-semibold text-white">
                      <Plus className="size-4" /> Sepete ekle · {featured.price}
                    </span>
                  </div>
                </div>
                <div className="grid content-start gap-3">
                  {rest.map((p) => (
                    <div key={p.name} className="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-sm ring-1 ring-black/5">
                      <span className="h-14 w-16 shrink-0 overflow-hidden rounded-xl">
                        <FoodPhoto photo={p.photo} sizes="64px" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-stone-900">{p.name}</span>
                        <span className="block truncate text-xs text-stone-500">{p.desc}</span>
                        <span className="mt-1 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[0.65rem] font-medium text-emerald-800">{p.tags[0]}</span>
                      </span>
                      <span className="text-sm font-semibold text-stone-900">{p.price}</span>
                    </div>
                  ))}
                  <div className="rounded-2xl border border-dashed border-stone-300 p-3 text-xs leading-relaxed text-stone-500">Tükenen ürün menüde “Tükendi” olarak görünür ve sepete eklenemez.</div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-fg-subtle">{MENU.sampleNote}</p>
          </div>
          <div className="order-1 lg:order-2">
            <SectionHeading id={MENU.id} eyebrow={MENU.eyebrow} title={MENU.title} lead={MENU.lead} />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {MENU.points.map((p) => (
                <li key={p} className="flex items-center gap-2.5 text-[0.9375rem] font-medium">
                  <Check aria-hidden="true" className="size-4 shrink-0 text-accent-strong" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id={ORDER.id} aria-labelledby={`${ORDER.id}-baslik`} className="scroll-mt-20 border-t border-border bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_minmax(0,460px)] lg:items-center lg:gap-16 lg:px-8 lg:py-24">
          <div>
            <SectionHeading id={ORDER.id} eyebrow={ORDER.eyebrow} title={ORDER.title} lead={ORDER.lead} />
            <ol data-reveal="" className="mt-10 grid gap-2.5 sm:grid-cols-2" data-testid="order-steps">
              {ORDER.steps.map((s, i) => (
                <li key={s} className="flex items-center gap-2.5 rounded-2xl border border-border bg-bg px-4 py-3">
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", i < 4 ? "bg-fg text-bg" : "border border-border-strong text-fg-subtle")}>{i + 1}</span>
                  <span className="text-sm font-semibold">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <div aria-hidden="true" data-reveal="scale" className="relative mx-auto w-full max-w-[460px]">
            <PhoneFrame className="mx-auto w-[min(64vw,250px)]">
              <OrderScreen />
            </PhoneFrame>
            <div className="absolute bottom-12 right-0 z-10 w-48 rounded-2xl border border-border bg-bg p-3.5 shadow-xl sm:w-52">
              <p className="text-xs font-semibold text-accent-strong">Panel · Yeni sipariş</p>
              <p className="mt-1 text-sm font-semibold">#1042 · Masa 12</p>
              <p className="mt-0.5 text-xs text-fg-muted">2 ürün · ₺700</p>
              <span className="mt-3 flex h-9 items-center justify-center rounded-full bg-fg text-xs font-semibold text-bg">Onayla</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

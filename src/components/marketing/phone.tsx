import { Bell, Check, ChefHat, Clock3, Flame, Mic, Search, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { HERO_SCENES, MENU } from "@/content/marketing/copy";
import { cn } from "@/lib/utils/cn";
import { QrArt } from "@/components/marketing/art";
import { LogoMark } from "@/components/layout/logo";
import { FoodPhoto } from "@/components/marketing/food-photo";

/**
 * Telefon maketi ve ekranları — MasaNova QR menüsünün görsel dilinin HAFİF kopyası (gerçek QR menü bileşenleri
 * içe aktarılmaz; pazarlama paketine panel / ses kodu girmez). Tamamı süs: aria-hidden; anlatı metin olarak ayrıca var.
 */
export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative rounded-[2.6rem] bg-[#1c1917] p-[7px] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.65)] ring-1 ring-white/10", className)}>
      <div className="relative aspect-[9/19] overflow-hidden rounded-[2.15rem] bg-[#faf8f5] text-stone-900">
        <div className="absolute left-1/2 top-2 z-30 h-5 w-20 -translate-x-1/2 rounded-full bg-[#1c1917]" />
        {children}
      </div>
    </div>
  );
}

/** Ekran katmanı: görünürken opak, değilse soluk + hafif kayık (geçiş CSS ile). */
export function Layer({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("absolute inset-0 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]", show ? "opacity-100 translate-y-0" : "pointer-events-none translate-y-3 opacity-0", className)}>
      {children}
    </div>
  );
}

export function ScanScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#141210] px-6 text-center text-white">
      <div className="relative w-[62%] rounded-2xl bg-white p-3 shadow-lg">
        <QrArt className="w-full" />
        <span className="mk-scanline absolute inset-x-2 top-2 h-0.5 rounded-full bg-orange-500 shadow-[0_0_12px_2px_rgb(249_115_22/0.7)]" style={{ ["--scan-distance" as string]: "calc(100% - 1rem)" }} />
      </div>
      <div>
        <p className="text-[0.8rem] font-semibold">{HERO_SCENES.table}</p>
        <p className="mt-1 text-[0.7rem] text-white/60">QR okutuluyor…</p>
      </div>
    </div>
  );
}

export function MenuScreen({ highlight = false }: { highlight?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative h-[22%] shrink-0 overflow-hidden bg-[linear-gradient(135deg,#7a3f22,#c2410c)]">
        <FoodPhoto photo="ciger" sizes="290px" />
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
        <span className="absolute bottom-2 right-3 rounded-full bg-white/90 px-2 py-0.5 text-[0.6rem] font-semibold text-stone-800">{HERO_SCENES.table}</span>
      </div>
      <div className="relative -mt-5 px-3">
        <div className="flex items-end gap-2">
          <span className="grid size-10 place-items-center overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-black/5">
            <LogoMark className="size-8" />
          </span>
          <div className="pb-0.5">
            <p className="text-[0.85rem] font-semibold leading-tight">MasaNova AI</p>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1.5 text-[0.62rem] text-stone-400">
          <Search className="size-3" /> Menüde ara
        </div>
        <div className="mt-2 flex gap-1 overflow-hidden">
          {MENU.sample.categories.map((c, i) => (
            <span key={c} className={cn("shrink-0 rounded-full px-2.5 py-1 text-[0.58rem] font-medium", i === 0 ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-700")}>
              {c}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2.5 grid gap-2 px-3">
        {MENU.sample.products.map((p, i) => (
          <div key={p.name} className={cn("flex items-center gap-2 rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-black/5 transition-shadow", highlight && i === 0 && "ring-2 ring-orange-400")}>
            <span className="h-11 w-14 shrink-0 overflow-hidden rounded-lg">
              <FoodPhoto photo={p.photo} sizes="64px" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.66rem] font-semibold">{p.name}</span>
              <span className="block truncate text-[0.56rem] text-stone-500">{p.desc}</span>
            </span>
            <span className="pr-1 text-[0.64rem] font-semibold">{p.price}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto flex justify-end p-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-2 text-[0.62rem] font-semibold text-white shadow-lg">
          <Mic className="size-3 text-orange-400" /> AI ile Konuş
        </span>
      </div>
    </div>
  );
}

/** Asistan alt sayfası: dinleme → soru → yanıt + öneri kartları. */
export function AssistantSheet({ phase }: { phase: "listening" | "asked" | "answered" }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex h-[74%] flex-col rounded-t-[1.6rem] bg-[#141210] px-3.5 pb-4 pt-3 text-white shadow-[0_-20px_40px_-10px_rgb(0_0_0/0.4)]">
      <span className="mx-auto h-1 w-9 rounded-full bg-white/20" />
      <div className="mt-3 flex items-center gap-2">
        <Orb state={phase === "listening" ? "listening" : phase === "asked" ? "thinking" : "idle"} size="sm" />
        <div>
          <p className="text-[0.7rem] font-semibold">MasaNova AI</p>
          <p className="text-[0.56rem] text-white/55">{phase === "listening" ? "Dinliyorum…" : phase === "asked" ? "Menüye bakıyorum…" : "Menünüzden öneriler"}</p>
        </div>
        <span className="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[0.52rem] font-semibold">TR</span>
      </div>
      <div className="mt-3 grid gap-2">
        <Bubble role="user" show={phase !== "listening"}>
          {HERO_SCENES.ask}
        </Bubble>
        <Bubble role="assistant" show={phase === "answered"}>
          {HERO_SCENES.answer}
        </Bubble>
        <div className={cn("grid gap-1.5 transition-all duration-700", phase === "answered" ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0")}>
          {HERO_SCENES.cards.map((c, i) => (
            <div key={c.name} className="flex items-center gap-2 rounded-xl bg-white p-1.5 text-stone-900" style={{ transitionDelay: `${i * 120}ms` }}>
              <span className="h-8 w-10 shrink-0 overflow-hidden rounded-md">
                <FoodPhoto photo={c.photo} sizes="48px" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.6rem] font-semibold">{c.name}</span>
              <span className="text-[0.6rem] font-semibold">{c.price}</span>
            </div>
          ))}
          <p className="text-right text-[0.58rem] font-medium text-white/70">{HERO_SCENES.total}</p>
        </div>
      </div>
    </div>
  );
}

export function Bubble({ role, show = true, children }: { role: "user" | "assistant"; show?: boolean; children: ReactNode }) {
  return (
    <p
      className={cn(
        "max-w-[88%] rounded-2xl px-2.5 py-1.5 text-[0.62rem] leading-snug transition-all duration-500",
        role === "user" ? "ml-auto rounded-br-md bg-orange-500 text-white" : "rounded-bl-md bg-white/10 text-white",
        show ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
      )}
    >
      {children}
    </p>
  );
}

export function Orb({ state, size = "md" }: { state: "idle" | "listening" | "thinking"; size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "size-8" : size === "md" ? "size-14" : "size-24";
  return (
    <span className={cn("mk-orb relative grid shrink-0 place-items-center", dim)} data-state={state}>
      <span className="mk-orb-ring absolute inset-0 rounded-full border border-orange-400/60" />
      <span className="mk-orb-ring absolute inset-0 rounded-full border border-orange-400/60" />
      <span className="mk-orb-ring absolute inset-0 rounded-full border border-orange-400/60" />
      <span className="mk-orb-core relative grid size-full place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#fdba74,#ea580c_55%,#7c2d12)] shadow-[0_0_30px_-4px_rgb(249_115_22/0.7)]">
        <Mic className={cn("text-white", size === "lg" ? "size-8" : size === "md" ? "size-5" : "size-3.5")} />
      </span>
    </span>
  );
}

/** Mutfak fişi (KDS). */
export function KdsTicket({ state, compact = false, className }: { state: 0 | 1 | 2; compact?: boolean; className?: string }) {
  const label = HERO_SCENES.ticketStates[state];
  const tone = state === 0 ? "bg-sky-100 text-sky-800" : state === 1 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
  return (
    <div className={cn("rounded-2xl bg-white p-3 text-stone-900 shadow-xl ring-1 ring-black/5", compact ? "w-44" : "w-56", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[0.65rem] font-semibold text-stone-500">
          <ChefHat className="size-3.5" /> {HERO_SCENES.ticket.station}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-[0.6rem] font-semibold transition-colors duration-500", tone)}>{label}</span>
      </div>
      <p className="mt-1.5 text-[0.8rem] font-semibold">
        {HERO_SCENES.ticket.number} · {HERO_SCENES.ticket.table}
      </p>
      <ul className="mt-1 grid gap-0.5 text-[0.65rem] text-stone-600">
        {HERO_SCENES.ticket.items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-100">
        <span className={cn("block h-full rounded-full bg-orange-500 transition-all duration-1000", state === 0 ? "w-[15%]" : state === 1 ? "w-[60%]" : "w-full bg-emerald-500")} />
      </div>
    </div>
  );
}

export function ServiceToast({ show, className }: { show: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl bg-[#141210] px-3 py-2.5 text-[0.68rem] font-medium text-white shadow-xl ring-1 ring-white/10 transition-all duration-700",
        show ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        className,
      )}
    >
      <span className="grid size-6 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
        <Bell className="size-3.5" />
      </span>
      {HERO_SCENES.service}
    </div>
  );
}

export function OrderScreen() {
  return (
    <div className="flex h-full flex-col gap-3 px-3.5 pt-10">
      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-stone-500">Siparişiniz</p>
      <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
        <p className="text-[0.8rem] font-semibold">#1042 · {HERO_SCENES.table}</p>
        <ul className="mt-2 grid gap-1 text-[0.64rem] text-stone-600">
          {HERO_SCENES.ticket.items.map((i) => (
            <li key={i} className="flex justify-between">
              {i}
            </li>
          ))}
        </ul>
        <p className="mt-2 border-t border-stone-100 pt-2 text-right text-[0.66rem] font-semibold">{HERO_SCENES.total}</p>
      </div>
      <ol className="grid gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
        {["Gönderildi", "Restoran onayladı", "Hazırlanıyor", "Servis edildi"].map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-[0.64rem]">
            <span className={cn("grid size-4 place-items-center rounded-full", i < 3 ? "bg-emerald-500 text-white" : "border border-stone-300")}>{i < 3 ? <Check className="size-2.5" /> : null}</span>
            <span className={cn(i < 3 ? "font-medium" : "text-stone-400")}>{s}</span>
            {i === 2 ? <Clock3 className="ml-auto size-3 text-amber-600" /> : null}
          </li>
        ))}
      </ol>
      <p className="text-center text-[0.58rem] text-stone-500">Ödeme masada, alışık olduğunuz şekilde.</p>
    </div>
  );
}

export function KdsScreen() {
  return (
    <div className="flex h-full flex-col gap-2 bg-[#141210] px-3 pt-10 text-white">
      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-white/50">Mutfak · Izgara</p>
      {[
        { n: "#1042", t: "Masa 12", s: "Hazırlanıyor", c: "bg-amber-400/15 text-amber-300", items: ["Adana Kebap", "Çoban Salata"] },
        { n: "#1043", t: "Masa 4", s: "Yeni", c: "bg-sky-400/15 text-sky-300", items: ["Tavuk Şiş ×2"] },
        { n: "#1039", t: "Masa 9", s: "Hazır", c: "bg-emerald-400/15 text-emerald-300", items: ["Urfa Dürüm"] },
      ].map((t) => (
        <div key={t.n} className="rounded-xl bg-white/[0.06] p-2.5 ring-1 ring-white/10">
          <div className="flex items-center justify-between">
            <span className="text-[0.7rem] font-semibold">
              {t.n} · {t.t}
            </span>
            <span className={cn("rounded-full px-1.5 py-0.5 text-[0.52rem] font-semibold", t.c)}>{t.s}</span>
          </div>
          <p className="mt-1 text-[0.6rem] text-white/60">{t.items.join(" · ")}</p>
        </div>
      ))}
      <p className="mt-auto pb-4 text-center text-[0.56rem] text-white/45">
        <Flame className="mr-1 inline size-3" /> Fişler istasyonlara otomatik ayrılır
      </p>
    </div>
  );
}

export function AnalyticsScreen() {
  const bars = [30, 55, 40, 70, 100, 82, 46];
  return (
    <div className="flex h-full flex-col gap-2.5 px-3 pt-10">
      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-stone-500">Bugün · örnek</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Sipariş Tutarı", "₺48.250"],
          ["Sipariş", "186"],
          ["Ortalama", "₺259"],
          ["Hazırlama", "14 dk"],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-white p-2 shadow-sm ring-1 ring-black/5">
            <p className="text-[0.52rem] text-stone-500">{l}</p>
            <p className="text-[0.8rem] font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-black/5">
        <p className="text-[0.56rem] font-medium text-stone-500">Yoğun saatler</p>
        <div className="mt-2 flex h-20 items-end gap-1.5">
          {bars.map((b, i) => (
            <span key={i} className={cn("flex-1 rounded-t-sm", b === 100 ? "bg-orange-500" : "bg-stone-300")} style={{ height: `${b}%` }} />
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-white p-2.5 text-[0.6rem] shadow-sm ring-1 ring-black/5">
        <p className="flex items-center gap-1 font-medium">
          <Sparkles className="size-3 text-orange-500" /> En çok satan: Adana Kebap
        </p>
      </div>
    </div>
  );
}

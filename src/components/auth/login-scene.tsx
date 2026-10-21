import { ChefHat, Mic, QrCode, ScanLine, Sparkles } from "lucide-react";
import { FloatingIcons } from "@/components/brand/floating-icons";
import { FoodPhoto, type FoodPhotoKey } from "@/components/marketing/food-photo";
import { cn } from "@/lib/utils/cn";

/**
 * Giriş ekranının dekoratif restoran sahnesi (sunucu bileşeni, JS yok): sıcak ışık lekeleri, masadan mutfağa akan
 * sipariş kartları (gerçek ürün fotoğrafları), dinleyen sesli garson dalgası ve QR tarama çerçevesi. Tamamı aria-hidden;
 * hareketler yalnızca CSS (globals.css › ln-*), prefers-reduced-motion'da durur.
 */
const ORDERS: { photo: FoodPhotoKey; table: string; item: string; status: string; tone: "kitchen" | "voice" | "ready"; className: string; delay: string }[] = [
  { photo: "adana", table: "Masa 4", item: "Adana Kebap", status: "Mutfağa iletildi", tone: "kitchen", className: "left-[6%] top-[16%]", delay: "0s" },
  { photo: "ayran", table: "Masa 2", item: "2 × Büyük Ayran", status: "Sesle eklendi", tone: "voice", className: "right-[8%] top-[34%]", delay: "-2.4s" },
  { photo: "coban", table: "Masa 7", item: "Çoban Salata", status: "Hazır", tone: "ready", className: "left-[10%] top-[44%]", delay: "-4.1s" },
];

const TONE = {
  kitchen: { icon: ChefHat, className: "bg-orange-500/15 text-orange-200" },
  voice: { icon: Mic, className: "bg-rose-500/15 text-rose-200" },
  ready: { icon: Sparkles, className: "bg-emerald-500/15 text-emerald-200" },
} as const;

export function LoginScene({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div aria-hidden="true" className={cn("isolate overflow-hidden bg-[#120a08]", className ?? "relative")}>
      {/* Işık lekeleri */}
      <div className="ln-blob absolute -left-[20%] -top-[25%] size-[70%] rounded-full bg-[radial-gradient(circle,rgb(234_88_12/0.55),transparent_65%)] blur-2xl" />
      <div className="ln-blob absolute -bottom-[30%] -right-[15%] size-[75%] rounded-full bg-[radial-gradient(circle,rgb(220_38_38/0.45),transparent_65%)] blur-2xl [animation-delay:-6s]" />
      <div className="ln-blob absolute left-[30%] top-[40%] size-[45%] rounded-full bg-[radial-gradient(circle,rgb(245_158_11/0.25),transparent_70%)] blur-3xl [animation-delay:-11s]" />
      {/* Süzülen restoran simgeleri (alttan yukarı, sonsuz) */}
      <FloatingIcons tone="dark" count={compact ? 12 : 16} className="absolute inset-0" />
      {/* Masa düzeni noktaları */}
      <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      {compact ? null : (
        <>
          {ORDERS.map((o) => {
            const tone = TONE[o.tone];
            return (
              <div key={o.item} className={cn("ln-float absolute w-60 rounded-2xl border border-white/10 bg-white/[0.07] p-2.5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)] backdrop-blur-xl", o.className)} style={{ animationDelay: o.delay }}>
                <div className="flex items-center gap-3">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-xl">
                    <FoodPhoto photo={o.photo} sizes="56px" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-white/50">{o.table}</p>
                    <p className="truncate text-sm font-semibold text-white">{o.item}</p>
                    <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium", tone.className)}>
                      <tone.icon className="size-3" /> {o.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Sesli garson */}
          <div className="ln-float absolute top-[58%] right-[10%] flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.08] py-2 pl-2 pr-4 backdrop-blur-xl [animation-delay:-1.2s]">
            <span className="grid size-9 place-items-center rounded-full bg-[linear-gradient(135deg,#ea580c,#dc2626)] text-white shadow-[0_8px_24px_-6px_rgb(234_88_12/0.8)]">
              <Mic className="size-4" />
            </span>
            <span className="flex h-6 items-end gap-[3px]">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} className="ln-bar w-[3px] rounded-full bg-orange-300/90" style={{ height: `${[40, 75, 100, 60, 90, 50, 70][i]}%`, animationDelay: `${i * -0.13}s` }} />
              ))}
            </span>
            <span className="text-xs font-medium text-white/80">Sesli garson dinliyor</span>
          </div>

          {/* QR tarama */}
          <div className="absolute right-[10%] top-[9%] grid size-24 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl">
            <QrCode className="size-12 text-white/70" strokeWidth={1.4} />
            <span className="ln-scan absolute inset-x-3 h-0.5 rounded-full bg-orange-400 shadow-[0_0_12px_2px_rgb(251_146_60/0.7)]" />
            <ScanLine className="absolute -bottom-2.5 -right-2.5 size-6 rounded-full bg-[#120a08] p-1 text-orange-300" />
          </div>
        </>
      )}
    </div>
  );
}

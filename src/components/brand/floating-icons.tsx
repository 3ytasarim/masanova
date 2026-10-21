import type { CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Arka plan katmanı: restoran simgeleri alttan çıkar, hafifçe salınarak yukarı süzülür, üstte kaybolur ve yeniden
 * alttan gelir (sonsuz döngü). Simgeler public/brand/icons altındaki çizgi PNG'lerdir; renk MASKE ile sitenin
 * turuncu → kırmızı geçişinden gelir (görsel boyanmaz, tema değişse de aynı kalır). Konum / süre / gecikme
 * deterministiktir (sunucu ve istemci aynı çıktıyı üretir). Tamamı dekoratif: aria-hidden, tıklanamaz.
 * Hareket azaltmada simgeler yerinde, soluk durur (globals.css › fi-*).
 */
const ICONS = [
  "chef", "menu-2", "cutlery-1", "fish", "dinner", "tray", "5-stars", "fast-food", "menu", "restaurant-2", "food",
  "chef-1", "dinner-table", "menu-1", "food-delivery", "cutlery", "iftar", "restaurant", "menu-3", "store", "food-delivery-1", "restaurant-1",
] as const;

const TONES = {
  /** Koyu zemin (giriş sahnesi): açık şeftali → mercan, belirgin. */
  dark: { gradient: "linear-gradient(135deg,#fdba74,#f87171)", opacity: 0.32 },
  /** Açık zemin (panel / giriş kartının arkası): marka turuncusu → kırmızı, içeriği bozmayacak kadar soluk. */
  light: { gradient: "linear-gradient(135deg,#ea580c,#dc2626)", opacity: 0.11 },
} as const;

export function FloatingIcons({ tone = "light", count = 16, className }: { tone?: keyof typeof TONES; count?: number; className?: string }) {
  const t = TONES[tone];
  const items = Array.from({ length: count }, (_, i) => {
    const duration = 18 + ((i * 11) % 16); // 18–33 sn
    return {
      icon: ICONS[(i * 7) % ICONS.length]!,
      left: 3 + ((i * 37) % 90), // %
      size: 26 + ((i * 13) % 30), // px
      duration,
      delay: -((i * 3.7) % duration), // negatif: sayfa açılır açılmaz ekran dolu
      rotate: ((i % 2 ? 1 : -1) * (8 + ((i * 5) % 18))),
      top: 6 + ((i * 53) % 86), // hareket azaltmada sabit konum (%)
      sway: 5 + ((i * 3) % 5),
    };
  });

  return (
    <div aria-hidden="true" className={cn("pointer-events-none overflow-hidden", className)}>
      {items.map((it, i) => (
        <span
          key={i}
          className="fi-rise absolute"
          style={{ left: `${it.left}%`, "--fi-d": `${it.duration}s`, "--fi-delay": `${it.delay}s`, "--fi-r": `${it.rotate}deg`, "--fi-o": t.opacity, "--fi-top": `${it.top}%` } as CSSProperties}
        >
          <span className="fi-sway block" style={{ "--fi-s": `${it.sway}s` } as CSSProperties}>
            <span
              className="block"
              style={{
                width: it.size,
                height: it.size,
                background: t.gradient,
                maskImage: `url(/brand/icons/${it.icon}.png)`,
                WebkitMaskImage: `url(/brand/icons/${it.icon}.png)`,
                maskSize: "contain",
                WebkitMaskSize: "contain",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
                maskPosition: "center",
                WebkitMaskPosition: "center",
              }}
            />
          </span>
        </span>
      ))}
    </div>
  );
}

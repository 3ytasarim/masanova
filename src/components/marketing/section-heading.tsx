import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Bölüm başlığı: üst etiket + H2 + giriş. Sayfada TEK H1 (hero); bölümler H2, kartlar H3. */
export function SectionHeading({ id, eyebrow, title, lead, align = "left", className, children }: { id: string; eyebrow: string; title: string; lead?: string; align?: "left" | "center"; className?: string; children?: ReactNode }) {
  return (
    <div data-reveal="" className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      <p className="text-sm font-semibold tracking-wide text-accent-strong">{eyebrow}</p>
      <h2 id={`${id}-baslik`} className="mt-3 text-[clamp(1.875rem,1.4rem+2vw,3rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-balance text-fg">
        {title}
      </h2>
      {lead ? <p className="mt-4 text-[1.0625rem] leading-relaxed text-pretty text-fg-muted">{lead}</p> : null}
      {children}
    </div>
  );
}

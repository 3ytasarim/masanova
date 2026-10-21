import Image from "next/image";
import { cn } from "@/lib/utils/cn";
import emblem from "@/assets/brand/masanova-emblem.png";
import logoDark from "@/assets/brand/masanova-logo-dark.png";
import logoLight from "@/assets/brand/masanova-logo-light.png";

/**
 * MasaNova AI marka varlıkları (işletmenin verdiği logo; şeffaf zemin, kenar yumuşaklığı korunarak hazırlandı):
 *   BrandLogo  — çatal · tabak (ses dalgası amblemi) · bıçak + "MasaNova AI" yazısı. light: açık zemin, dark: koyu zemin
 *                (siyahlar beyaz, kırmızı aynı).
 *   LogoMark   — yalnızca amblem (beyaz daire üzerinde; sekme ikonu ile aynı) — küçük imzalar için.
 */
export function BrandLogo({ variant = "light", className, priority = false }: { variant?: "light" | "dark"; className?: string; priority?: boolean }) {
  return <Image src={variant === "dark" ? logoDark : logoLight} alt="MasaNova AI" priority={priority} sizes="200px" className={cn("h-7 w-auto shrink-0", className)} />;
}

export function LogoMark({ className }: { className?: string }) {
  return <Image src={emblem} alt="" aria-hidden="true" sizes="32px" className={cn("size-7 shrink-0 rounded-full", className)} />;
}

export function Logo({ className, suffix }: { className?: string; suffix?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandLogo />
      {suffix ? (
        <span className="rounded-sm border border-border px-1.5 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

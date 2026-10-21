import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";
import { Spinner } from "@/components/ui/spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "accent" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out-expo) " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 " +
  "[&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  // Site renkleri: turuncu → kırmızı geçiş (giriş ekranı ve panel cam tasarımıyla aynı)
  primary:
    "bg-[linear-gradient(135deg,#ea580c,#dc2626)] text-white shadow-[0_8px_18px_-10px_rgb(220_38_38/0.7)] hover:brightness-105 hover:shadow-[0_12px_24px_-10px_rgb(220_38_38/0.75)]",
  secondary: "border border-stone-900/10 bg-white/80 text-stone-800 shadow-xs backdrop-blur hover:border-stone-900/20 hover:bg-white",
  ghost: "text-fg-muted hover:bg-white/70 hover:text-fg",
  accent: "bg-accent text-white shadow-xs hover:bg-accent-strong",
  danger: "bg-danger text-white shadow-xs hover:bg-danger/90",
};

/* Dokunma hedefi: md ve lg 44–48px; sm yalnızca yoğun masaüstü araç çubukları için. */
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-[0.9375rem]",
  icon: "size-11",
};

/** Link'leri buton gibi göstermek için sınıf üretici: <Link className={buttonVariants({ variant: "secondary" })}> */
export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function Button({ variant, size, loading = false, className, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonVariants({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

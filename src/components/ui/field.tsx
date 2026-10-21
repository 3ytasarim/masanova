import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Form alanı çerçevesi: etiket + yardım metni + hata. Kontrol bileşenine aynı `id` verilmeli;
 * yardım/hata metinleri `${id}-hint` / `${id}-error` id'leriyle aria-describedby'a bağlanır.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[0.8125rem] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Field ile kullanılan kontrollerin aria-describedby değeri. */
export function describedBy(id: string, { hint, error }: { hint?: unknown; error?: unknown }): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export const controlBase =
  "w-full rounded-md border border-border-strong bg-bg text-[0.9375rem] text-fg shadow-xs placeholder:text-fg-subtle " +
  "transition-[border-color,box-shadow] duration-(--duration-fast) " +
  "hover:border-fg-subtle/50 focus-visible:border-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-fg/10 " +
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-subtle " +
  "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/15";

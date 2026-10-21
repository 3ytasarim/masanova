import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> & { label: ReactNode; description?: ReactNode };

/**
 * Yerel checkbox + role="switch": form gönderiminde değer taşır, klavye/ekran okuyucu desteği tarayıcıdan gelir.
 * Görsel durum tamamen CSS (peer) ile — istemci JavaScript'i gerekmez.
 */
export function Switch({ id, label, description, className, ...props }: SwitchProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="grid gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium leading-5 text-fg">
          {label}
        </label>
        {description ? (
          <p id={`${id}-description`} className="text-[0.8125rem] text-fg-subtle">
            {description}
          </p>
        ) : null}
      </div>
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-describedby={description ? `${id}-description` : undefined}
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "h-6 w-10 rounded-full bg-surface-3 transition-colors duration-(--duration-fast)",
            "peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
            "peer-disabled:opacity-50",
            "after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm",
            "after:transition-transform after:duration-(--duration-base) after:ease-(--ease-out-expo) peer-checked:after:translate-x-4",
          )}
        />
      </span>
    </div>
  );
}

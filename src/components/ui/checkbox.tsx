import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; description?: ReactNode };

export function Checkbox({ id, label, description, className, ...props }: CheckboxProps) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded-xs border-border-strong accent-primary disabled:cursor-not-allowed"
        aria-describedby={description ? `${id}-description` : undefined}
        {...props}
      />
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
    </div>
  );
}

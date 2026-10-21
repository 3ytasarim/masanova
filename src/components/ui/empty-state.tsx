import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-4 inline-flex size-11 items-center justify-center rounded-lg border border-border bg-bg shadow-xs">
          <Icon aria-hidden="true" className="size-5 text-fg-muted" />
        </span>
      ) : null}
      <h2 className="text-[0.9375rem] font-semibold tracking-tight text-fg">{title}</h2>
      {description ? <p className="mt-1.5 max-w-md text-sm text-fg-subtle">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

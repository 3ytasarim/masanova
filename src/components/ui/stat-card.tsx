import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("mn-glass flex flex-col gap-3 rounded-2xl p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg-subtle">{label}</span>
        {Icon ? (
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-[linear-gradient(135deg,rgb(234_88_12/0.14),rgb(220_38_38/0.10))] text-orange-600">
            <Icon className="size-[1.125rem]" />
          </span>
        ) : null}
      </div>
      <div className="text-[1.75rem] font-semibold leading-none tracking-tight text-fg tabular-nums">{value}</div>
      {hint ? <div className="text-[0.8125rem] text-fg-subtle">{hint}</div> : null}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div aria-hidden="true" className="mn-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
      <div className="h-7 w-16 animate-pulse rounded bg-surface-2" />
      <div className="h-3.5 w-32 animate-pulse rounded bg-surface-2" />
    </div>
  );
}

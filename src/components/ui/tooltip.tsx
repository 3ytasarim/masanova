"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Hover ve klavye odağında görünen ipucu. Tetikleyiciye aria-describedby otomatik eklenir.
 * Yalnızca ek bilgi içindir — kritik bilgi asla sadece tooltip'te olmamalı (dokunmatik cihazlarda hover yok).
 */
export function Tooltip({
  content,
  side = "top",
  children,
}: {
  content: ReactNode;
  side?: "top" | "bottom";
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const trigger = isValidElement(children) ? cloneElement(children, { "aria-describedby": id }) : children;

  return (
    <span className="group/tooltip relative inline-flex">
      {trigger}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-md bg-primary px-2.5 py-1.5",
          "text-xs font-medium text-primary-fg opacity-0 shadow-md transition-opacity duration-(--duration-fast)",
          "group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
        )}
      >
        {content}
      </span>
    </span>
  );
}

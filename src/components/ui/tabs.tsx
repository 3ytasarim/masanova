"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type TabItem = { id: string; label: ReactNode; content: ReactNode };

/** WAI-ARIA tabs: ←/→/Home/End ile gezinme, otomatik etkinleştirme, roving tabindex. */
export function Tabs({
  items,
  defaultTab,
  label,
  className,
  onChange,
}: {
  items: TabItem[];
  defaultTab?: string;
  label: string;
  className?: string;
  onChange?: (id: string) => void;
}) {
  const [active, setActiveState] = useState(defaultTab ?? items[0]?.id);
  const setActive = (id: string) => {
    setActiveState(id);
    onChange?.(id);
  };
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const target = items[next];
    if (!target) return;
    setActive(target.id);
    tabRefs.current[target.id]?.focus();
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
        {items.map((item, index) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                tabRefs.current[item.id] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "-mb-px h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors duration-(--duration-fast)",
                selected ? "border-fg text-fg" : "border-transparent text-fg-subtle hover:text-fg",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${baseId}-panel-${item.id}`}
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== active}
          tabIndex={0}
          className="pt-4 focus-visible:outline-offset-4"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

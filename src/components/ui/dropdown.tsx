"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Erişilebilir menü düğmesi (WAI-ARIA menu button deseni):
 * Enter/Space/↓ ile açılır, ↑/↓/Home/End ile gezinilir, Esc ile kapanır ve odak tetikleyiciye döner,
 * dışarı tıklama kapatır. Öğeler <DropdownItem> (button) ya da form içinde type="submit" olabilir.
 */
export function Dropdown({
  trigger,
  triggerLabel,
  align = "end",
  triggerClassName,
  children,
}: {
  trigger: ReactNode;
  /** Tetikleyicinin erişilebilir adı (tetikleyici yalnızca ikon/avatar ise zorunlu). */
  triggerLabel?: string;
  align?: "start" | "end";
  triggerClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function closeAndFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); focusAt(index + 1); break;
      case "ArrowUp": event.preventDefault(); focusAt(index - 1); break;
      case "Home": event.preventDefault(); focusAt(0); break;
      case "End": event.preventDefault(); focusAt(list.length - 1); break;
      case "Escape": event.preventDefault(); closeAndFocus(); break;
      case "Tab": setOpen(false); break;
    }
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {/* Menü her zaman DOM'da kalır (yalnızca gizlenir): içindeki <form> öğeleri tıklamayla menü kapanırken
          DOM'dan sökülürse tarayıcı gönderimi iptal eder (ör. "Çıkış yap"). */}
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        hidden={!open}
        onKeyDown={onMenuKeyDown}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false);
        }}
        className={cn(
          "absolute top-[calc(100%+6px)] z-50 min-w-56 animate-rise-in rounded-lg border border-border bg-bg p-1 shadow-lg",
          align === "end" ? "right-0" : "left-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DropdownItem({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      role="menuitem"
      tabIndex={-1}
      type={type}
      className={cn(
        "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-fg-muted outline-none",
        "hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2 focus-visible:text-fg [&_svg]:size-4 [&_svg]:text-fg-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1.5 pt-2 text-xs text-fg-subtle">{children}</div>;
}

export function DropdownSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

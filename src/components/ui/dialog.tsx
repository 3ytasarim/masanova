"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Yerel <dialog> + showModal(): odak hapsi, arka planın inert olması ve Esc ile kapanma tarayıcıdan gelir.
 * `variant="sheet"` mobil gezinme çekmecesi için soldan açılan tam yükseklikte panel üretir.
 */
export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  variant?: "modal" | "sheet";
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function Dialog({ open, onOpenChange, title, description, variant = "modal", footer, className, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={close}
      onClick={(event) => {
        // Yalnızca arka plana (dialog öğesinin kendisine) tıklanınca kapat.
        if (event.target === event.currentTarget) close();
      }}
      className={cn(
        "m-0 max-h-none max-w-none bg-transparent p-0 text-fg backdrop:animate-fade-in",
        variant === "modal" && "fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-lg",
        variant === "sheet" && "fixed inset-y-0 left-0 h-dvh w-[min(20rem,calc(100%-3rem))]",
      )}
    >
      <div
        className={cn(
          "flex flex-col bg-bg shadow-lg",
          variant === "modal" && "max-h-[85dvh] animate-rise-in rounded-xl border border-border",
          variant === "sheet" && "h-full animate-sheet-in border-r border-border",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="grid gap-1">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-fg-subtle">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={close}
            className="-mr-2 -mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Kapat</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
      </div>
    </dialog>
  );
}

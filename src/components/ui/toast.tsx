"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Bildirimler (toast). Ekran okuyucular için iki canlı bölge: bilgi/başarı "polite", hata "assertive".
 * Yönlendirme sonrası bildirimler `mn_flash` çerezinden okunur (lib/flash.ts).
 */
export type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; message: string; tone: ToastTone };

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast yalnızca <ToastProvider> içinde kullanılabilir.");
  return ctx;
}

const FLASH_COOKIE = "mn_flash";

function readFlash(): { message: string; tone: ToastTone } | null {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${FLASH_COOKIE}=`));
  if (!raw) return null;
  document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw.slice(FLASH_COOKIE.length + 1)));
    if (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") {
      const tone = "tone" in parsed && (parsed.tone === "error" || parsed.tone === "info") ? parsed.tone : "success";
      return { message: parsed.message, tone };
    }
  } catch {
    // bozuk çerez: yok say
  }
  return null;
}

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const pathname = usePathname();

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 8000 : 5000);
    },
    [dismiss],
  );

  useEffect(() => {
    const flash = readFlash();
    if (flash) push(flash.message, flash.tone);
  }, [pathname, push]);

  const value = useMemo(() => push, [push]);
  const polite = items.filter((t) => t.tone !== "error");
  const assertive = items.filter((t) => t.tone === "error");

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
        <div role="status" aria-live="polite" className="contents">
          {polite.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="contents">
          {assertive.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = ICONS[item.tone];
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-sm animate-rise-in items-start gap-3 rounded-lg border bg-bg p-3.5 shadow-lg",
        item.tone === "error" ? "border-danger/30" : "border-border",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", item.tone === "success" && "text-success", item.tone === "error" && "text-danger", item.tone === "info" && "text-info")}
      />
      <p className="flex-1 text-sm text-fg">{item.message}</p>
      <button type="button" onClick={() => onDismiss(item.id)} className="-m-1 inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg">
        <X aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Bildirimi kapat</span>
      </button>
    </div>
  );
}

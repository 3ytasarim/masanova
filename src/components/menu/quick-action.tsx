"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils/cn";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

/**
 * Tek tıklık sunucu eylemi (aç/kapat, sırala, arşivle…). Gizli alanlarla küçük bir form;
 * sonuç toast ile bildirilir, hata durumunda "assertive" bölgeye düşer.
 */
export function QuickAction({
  action,
  fields,
  label,
  children,
  className,
  disabled,
  title,
}: {
  action: FormAction;
  fields: Record<string, string>;
  /** Ekran okuyucu etiketi (görünür içerik ikon ise zorunlu). */
  label: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const toast = useToast();
  const [, formAction, pending] = useActionState(async (prev: ActionResult | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result) {
      if (!result.ok) toast(result.error, "error");
      else if (result.message) toast(result.message, "success");
    }
    return result;
  }, null);

  return (
    <form action={formAction} className="inline-flex">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        aria-label={label}
        title={title ?? label}
        disabled={disabled || pending}
        className={cn(
          "inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-md px-2 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
          className,
        )}
      >
        {pending ? <Spinner /> : children}
      </button>
    </form>
  );
}

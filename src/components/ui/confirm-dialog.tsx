"use client";

import { useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { useFormAction } from "@/components/ui/use-form-action";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

/**
 * Onaylı işlem: tetikleyici düğme → açıklamalı onay penceresi → form gönderimi (Server Action).
 * Durum değiştiren / yıkıcı tüm işlemler bununla yapılır. Sonuç toast ile bildirilir; hata pencerede kalır.
 */
export function ConfirmDialog({
  action,
  hidden,
  triggerLabel,
  triggerVariant = "secondary",
  triggerSize = "sm",
  title,
  description,
  confirmLabel,
  destructive = false,
  children,
}: {
  action: FormAction;
  hidden?: Record<string, string>;
  triggerLabel: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Ek form alanları (ör. gerekçe). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result?.ok) {
      setOpen(false);
      if (result.message) toast(result.message, "success");
    }
    return result;
  }, null);

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={description}>
        <form onSubmit={onSubmit} className="grid gap-4">
          {Object.entries(hidden ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {children}
          {state && !state.ok ? (
            <p role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger">
              {state.error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Vazgeç
            </Button>
            <Button type="submit" variant={destructive ? "danger" : "primary"} loading={pending}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

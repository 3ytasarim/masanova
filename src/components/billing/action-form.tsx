"use client";

import type { ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

/** Küçük Server Action formu (Super Admin abonelik kontrolleri): sonuç toast + hata kutusu; girdiler korunur. */
export function ActionForm({ action, submitLabel, children, testId, variant = "secondary", inline = false }: { action: FormAction; submitLabel: string; children?: ReactNode; testId?: string; variant?: ButtonVariant; inline?: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  return (
    <form onSubmit={onSubmit} noValidate className={inline ? "flex flex-wrap items-end gap-3" : "grid gap-3"} data-testid={testId}>
      {state && !state.ok ? (
        <div className={inline ? "w-full" : undefined}>
          <FormAlert state={state} />
        </div>
      ) : null}
      {children}
      <div>
        <Button type="submit" size="sm" variant={variant} loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

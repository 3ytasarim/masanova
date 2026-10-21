"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/components/ui/use-form-action";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

/** "Doğrulamayı kontrol et": gerçek DNS sorgusu sunucuda yapılır; sonuç toast + satır içi hata. */
export function VerifyDomainButton({ action, domainId }: { action: FormAction; domainId: string }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <input type="hidden" name="domainId" value={domainId} />
      <input type="hidden" name="op" value="verify" />
      <div>
        <Button type="submit" size="sm" loading={pending}>
          {!pending ? <RefreshCw aria-hidden="true" /> : null}
          Doğrulamayı kontrol et
        </Button>
      </div>
      {state && !state.ok ? (
        <p role="alert" className="text-[0.8125rem] text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function DomainOpConfirm({
  action,
  domainId,
  op,
  label,
  title,
  description,
  destructive,
}: {
  action: FormAction;
  domainId: string;
  op: "primary" | "remove" | "regenerate";
  label: string;
  title: string;
  description: string;
  destructive?: boolean;
}) {
  return (
    <ConfirmDialog
      action={action}
      hidden={{ domainId, op }}
      triggerLabel={label}
      triggerVariant="ghost"
      title={title}
      description={description}
      confirmLabel={label}
      destructive={destructive}
    />
  );
}

export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg">{value}</code>
      <Button
        variant="secondary"
        size="sm"
        className="h-auto"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span className="sr-only">{copied ? `${label} kopyalandı` : `${label} kopyala`}</span>
      </Button>
    </div>
  );
}

export function AddCustomDomainForm({ action }: { action: FormAction }) {
  const { state, pending, onSubmit, formRef } = useFormAction(action, null, { resetOnSuccess: (s) => !!s?.ok });
  useResultToast(state);
  const error = fieldError(state, "hostname");
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormAlert state={state && !state.ok && !error ? state : null} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field id="new-domain" label="Özel alan adı" error={error} hint="Örn. menu.restoran.com" className="flex-1">
          <Input id="new-domain" name="hostname" placeholder="menu.restoran.com" className="font-mono" autoCapitalize="none" spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={describedBy("new-domain", { hint: true, error })} />
        </Field>
        <Button type="submit" loading={pending} className="sm:mb-[1.625rem]">
          Ekle
        </Button>
      </div>
    </form>
  );
}

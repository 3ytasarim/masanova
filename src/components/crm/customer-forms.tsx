"use client";

import Link from "next/link";
import { useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { revokeConsentAction } from "@/server/actions/crm.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { describedBy, Field } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/components/ui/use-form-action";
import { useToast } from "@/components/ui/toast";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;
export type CustomerDefaults = { firstName: string; lastName: string; phone: string; email: string; staffNote: string };

/**
 * Personel müşteri formu (ekle / düzenle). Bu formda HİÇBİR onay alanı yoktur: personel müşteri adına pazarlama
 * izni veremez. İletişim değişirse o kanalın doğrulaması sunucuda düşer.
 */
export function CustomerForm({ action, defaults, mode, cancelHref }: { action: FormAction; defaults: CustomerDefaults; mode: "create" | "edit"; cancelHref?: string }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" data-testid={`customer-form-${mode}`}>
      <FormAlert state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="c-first" label="Ad" error={err("firstName")}>
          <Input id="c-first" name="firstName" defaultValue={defaults.firstName} autoComplete="off" aria-describedby={describedBy("c-first", { error: err("firstName") })} aria-invalid={!!err("firstName")} />
        </Field>
        <Field id="c-last" label="Soyad" error={err("lastName")}>
          <Input id="c-last" name="lastName" defaultValue={defaults.lastName} autoComplete="off" aria-describedby={describedBy("c-last", { error: err("lastName") })} aria-invalid={!!err("lastName")} />
        </Field>
        <Field id="c-phone" label="Telefon" hint="Ör. 0532 123 45 67" error={err("phone")}>
          <Input id="c-phone" name="phone" type="tel" inputMode="tel" defaultValue={defaults.phone} autoComplete="off" aria-describedby={describedBy("c-phone", { hint: true, error: err("phone") })} aria-invalid={!!err("phone")} />
        </Field>
        <Field id="c-email" label="E-posta" error={err("email")}>
          <Input id="c-email" name="email" type="email" defaultValue={defaults.email} autoComplete="off" aria-describedby={describedBy("c-email", { error: err("email") })} aria-invalid={!!err("email")} />
        </Field>
      </div>
      <Field id="c-note" label="Personel notu" hint="Yalnızca sahip / müdür görür; müşteriye gösterilmez. Sağlık, din, siyasi görüş gibi hassas bilgiler YAZMAYIN. En fazla 500 karakter." error={err("staffNote")}>
        <Textarea id="c-note" name="staffNote" rows={3} maxLength={500} defaultValue={defaults.staffNote} aria-describedby={describedBy("c-note", { hint: true, error: err("staffNote") })} />
      </Field>
      {mode === "create" ? <p className="text-sm text-fg-subtle">Personel tarafından eklenen müşteriye pazarlama izni verilemez; izinleri yalnızca müşteri kendisi verir.</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {cancelHref ? (
          <Link href={cancelHref} className={buttonVariants({ variant: "secondary" })}>
            Vazgeç
          </Link>
        ) : null}
        <Button type="submit" loading={pending}>
          {mode === "create" ? "Müşteriyi ekle" : "Bilgileri kaydet"}
        </Button>
      </div>
    </form>
  );
}

export function AdjustPointsForm({ action }: { action: FormAction }) {
  const { state, pending, onSubmit, formRef } = useFormAction(action, null, { resetOnSuccess: (s) => !!s?.ok });
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4" data-testid="adjust-form">
      <FormAlert state={state} />
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field id="adj-points" label="Puan (±)" error={err("points")}>
          <Input id="adj-points" name="points" inputMode="numeric" placeholder="Ör. 50 ya da -20" aria-invalid={!!err("points")} aria-describedby={describedBy("adj-points", { error: err("points") })} />
        </Field>
        <Field id="adj-reason" label="Gerekçe" error={err("reason")}>
          <Input id="adj-reason" name="reason" maxLength={200} placeholder="Ör. hatalı sipariş telafisi" aria-invalid={!!err("reason")} aria-describedby={describedBy("adj-reason", { error: err("reason") })} />
        </Field>
      </div>
      <div>
        <Button type="submit" variant="secondary" loading={pending}>
          Düzeltmeyi kaydet
        </Button>
      </div>
    </form>
  );
}

export function RevokeConsentButton({ customerId, type, label }: { customerId: string; type: "MARKETING_EMAIL" | "MARKETING_SMS" | "MARKETING_WHATSAPP"; label: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={pending}
      data-testid={`revoke-${type}`}
      onClick={() => {
        if (!window.confirm(`${label} izni müşterinin talebiyle geri alınsın mı? Bu işlem kayıt altına alınır.`)) return;
        start(async () => {
          const r = await revokeConsentAction(customerId, type);
          toast(r.ok ? (r.message ?? "Geri alındı.") : r.error, r.ok ? "success" : "error");
        });
      }}
    >
      Geri al
    </Button>
  );
}

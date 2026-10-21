"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { fieldError } from "@/components/ui/form-alert";
import { useFormAction } from "@/components/ui/use-form-action";
import { submitDemoRequestAction } from "@/server/actions/demo-request.actions";
import { trackMarketing } from "@/lib/marketing/events";
import { Button } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Public demo talep formu. Sunucu: Zod + bot tuzağı + hız sınırı. Başarıda form yerine onay mesajı
 * gösterilir ve odak ona taşınır (ekran okuyucu duyurur).
 */
export function DemoRequestForm() {
  const { state, pending, onSubmit } = useFormAction(submitDemoRequestAction, null);
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state?.ok) return;
    successRef.current?.focus();
    trackMarketing(window, "MARKETING_DEMO_SUBMITTED", "demo-form");
  }, [state]);

  if (state?.ok) {
    return (
      <div ref={successRef} tabIndex={-1} role="status" className="flex flex-col items-start gap-3 rounded-lg bg-white/10 p-6 outline-none">
        <CircleCheck aria-hidden="true" className="size-6 text-white" />
        <p className="text-lg font-semibold">Teşekkürler!</p>
        <p className="text-white/80">{state.message}</p>
      </div>
    );
  }

  const err = (k: string) => fieldError(state, k);
  const control = (id: string) => ({
    "aria-invalid": err(id) ? true : undefined,
    "aria-describedby": describedBy(`demo-${id}`, { error: err(id) }),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="relative grid gap-4 rounded-lg bg-bg p-5 text-fg shadow-lg sm:grid-cols-2 sm:p-6">
      {state && !state.ok ? (
        <p role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger sm:col-span-2">
          {state.error}
        </p>
      ) : null}
      <Field id="demo-name" label="Adınız soyadınız" required error={err("name")}>
        <Input id="demo-name" name="name" autoComplete="name" required maxLength={80} {...control("name")} />
      </Field>
      <Field id="demo-businessName" label="İşletme adı" required error={err("businessName")}>
        <Input id="demo-businessName" name="businessName" autoComplete="organization" required maxLength={120} {...control("businessName")} />
      </Field>
      <Field id="demo-phone" label="Telefon" required error={err("phone")}>
        <Input id="demo-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" required maxLength={24} {...control("phone")} />
      </Field>
      <Field id="demo-email" label="E-posta" required error={err("email")}>
        <Input id="demo-email" name="email" type="email" autoComplete="email" required maxLength={254} {...control("email")} />
      </Field>
      <Field id="demo-city" label="Şehir" error={err("city")}>
        <Input id="demo-city" name="city" autoComplete="address-level2" maxLength={80} {...control("city")} />
      </Field>
      <Field id="demo-tableCount" label="Tahmini masa sayısı" error={err("tableCount")}>
        <Input id="demo-tableCount" name="tableCount" type="number" inputMode="numeric" min={1} max={5000} {...control("tableCount")} />
      </Field>
      <Field id="demo-message" label="Mesajınız" error={err("message")} className="sm:col-span-2">
        <Textarea id="demo-message" name="message" rows={3} maxLength={2000} {...control("message")} />
      </Field>
      {/* Bot tuzağı: insanlar görmez/doldurmaz. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="demo-website">Web siteniz</label>
        <input id="demo-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-fg-subtle">Bilgileriniz yalnızca demo talebinizle ilgili iletişim için kullanılır.</p>
        <Button type="submit" size="lg" loading={pending}>
          Demo Talep Et
        </Button>
      </div>
    </form>
  );
}

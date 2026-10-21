"use client";

import type { ActionResult } from "@/lib/action-result";
import { LOCALES, type LocaleOptions } from "@/lib/validation/intl";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/components/ui/use-form-action";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

export function TenantGeneralForm({
  action,
  defaults,
  options,
}: {
  action: FormAction;
  options: LocaleOptions;
  defaults: { name: string; defaultLocale: string; defaultCurrency: string; timezone: string };
}) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormAlert state={state} />
      <Field id="tg-name" label="İşletme adı" required error={err("name")}>
        <Input id="tg-name" name="name" defaultValue={defaults.name} maxLength={120} aria-invalid={err("name") ? true : undefined} aria-describedby={describedBy("tg-name", { error: err("name") })} />
      </Field>
      <div className="grid gap-5 md:grid-cols-3">
        <Field id="tg-locale" label="Varsayılan dil" error={err("defaultLocale")}>
          <Select id="tg-locale" name="defaultLocale" defaultValue={defaults.defaultLocale}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="tg-currency" label="Para birimi" error={err("defaultCurrency")}>
          <Select id="tg-currency" name="defaultCurrency" defaultValue={defaults.defaultCurrency}>
            {options.currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="tg-tz" label="Saat dilimi" error={err("timezone")}>
          <Select id="tg-tz" name="timezone" defaultValue={defaults.timezone}>
            {options.timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <Button type="submit" loading={pending}>
          Kaydet
        </Button>
      </div>
    </form>
  );
}

function Color({ id, name, label, defaultValue, error }: { id: string; name: string; label: string; defaultValue: string; error?: string }) {
  return (
    <Field id={id} label={label} error={error} hint="#RRGGBB">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-11 shrink-0 rounded-md border border-border-strong" style={{ background: /^#[0-9a-f]{6}$/i.test(defaultValue) ? defaultValue : "transparent" }} />
        <Input id={id} name={name} defaultValue={defaultValue} maxLength={7} placeholder="#18181b" className="font-mono" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { hint: true, error })} />
      </div>
    </Field>
  );
}

export function TenantBrandingForm({
  action,
  defaults,
}: {
  action: FormAction;
  defaults: { logoUrl: string; primaryColor: string; secondaryColor: string; accentColor: string };
}) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormAlert state={state} />
      <Field id="tb-logo" label="Logo adresi (URL)" error={err("logoUrl")} hint="https:// ile başlamalı. İşletme logoyu Tema & Tasarım sayfasından da yükleyebilir; yüklenen logo önceliklidir.">
        <Input id="tb-logo" name="logoUrl" type="url" defaultValue={defaults.logoUrl} aria-invalid={err("logoUrl") ? true : undefined} aria-describedby={describedBy("tb-logo", { hint: true, error: err("logoUrl") })} />
      </Field>
      <div className="grid gap-5 md:grid-cols-3">
        <Color id="tb-primary" name="primaryColor" label="Ana renk" defaultValue={defaults.primaryColor} error={err("primaryColor")} />
        <Color id="tb-secondary" name="secondaryColor" label="İkincil renk" defaultValue={defaults.secondaryColor} error={err("secondaryColor")} />
        <Color id="tb-accent" name="accentColor" label="Vurgu rengi" defaultValue={defaults.accentColor} error={err("accentColor")} />
      </div>
      <div>
        <Button type="submit" loading={pending}>
          Marka ayarlarını kaydet
        </Button>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import type { ActionResult } from "@/lib/action-result";
import type { LocaleOptions } from "@/lib/validation/intl";
import { BranchFields, type BranchDefaults } from "@/components/dashboard/branch-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { useFormAction } from "@/components/ui/use-form-action";
import { FormAlert } from "@/components/ui/form-alert";
import { Switch } from "@/components/ui/switch";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

export function BranchForm({
  action,
  defaults,
  cancelHref,
  mode,
  options,
}: {
  action: FormAction;
  defaults: BranchDefaults & { active?: boolean };
  cancelHref: string;
  mode: "create" | "edit";
  options: LocaleOptions;
}) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      <FormAlert state={state} />
      <BranchFields idPrefix="branch" defaults={defaults} options={options} errors={errors} />
      {mode === "edit" ? (
        <div className="max-w-md rounded-lg border border-border p-4">
          <Switch id="branch-active" name="active" label="Şube aktif" description="Pasif şubeler QR menüde ve siparişte görünmez. Veri silinmez." defaultChecked={defaults.active} />
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Link href={cancelHref} className={buttonVariants({ variant: "secondary" })}>
          Vazgeç
        </Link>
        <Button type="submit" loading={pending}>
          {mode === "create" ? "Şubeyi oluştur" : "Değişiklikleri kaydet"}
        </Button>
      </div>
    </form>
  );
}

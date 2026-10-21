"use client";

import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { describedBy, Field } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

/**
 * Sadakat ayarları. Puan politikası UYDURULMAZ: işletme "1 puan için gereken tutar"ı girene kadar program açılamaz.
 * Kupon / ödül / puan kullanımı bu sürümde yoktur.
 */
export function LoyaltySettingsForm({ action, defaults, currencySymbol, disabled }: { action: FormAction; defaults: { enabled: boolean; amountPerPoint: string; earnOn: "SERVED" | "ACCEPTED" }; currencySymbol: string; disabled: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6" data-testid="loyalty-settings-form">
      <FormAlert state={state} />
      <fieldset disabled={disabled} className="grid gap-6">
        <Switch id="loyalty-enabled" name="enabled" label="Sadakat programı açık" description="Açıkken katılan müşteriler QR menüde puan bakiyesini görür ve siparişlerinden puan kazanır." defaultChecked={defaults.enabled} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="loyalty-amount" label={`1 puan için gereken tutar (${currencySymbol})`} hint="Ör. 10 → her 10 birimlik sipariş tutarı 1 puan (aşağı yuvarlanır)." error={err("amountPerPoint")}>
            <Input id="loyalty-amount" name="amountPerPoint" inputMode="decimal" defaultValue={defaults.amountPerPoint} aria-invalid={!!err("amountPerPoint")} aria-describedby={describedBy("loyalty-amount", { hint: true, error: err("amountPerPoint") })} />
          </Field>
          <Field id="loyalty-earn" label="Puan ne zaman kazanılır?" hint="Önerilen: servis edildiğinde. Reddedilen / iptal edilen siparişler puan kazanmaz.">
            <Select id="loyalty-earn" name="earnOn" defaultValue={defaults.earnOn} aria-describedby="loyalty-earn-hint">
              <option value="SERVED">Sipariş servis edildiğinde (önerilen)</option>
              <option value="ACCEPTED">Sipariş kabul edildiğinde</option>
            </Select>
          </Field>
        </div>
        <div>
          <Button type="submit" loading={pending}>
            Ayarları kaydet
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

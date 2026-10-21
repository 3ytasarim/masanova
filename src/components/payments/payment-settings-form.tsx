"use client";

import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { describedBy, Field } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;
export type PaymentSettingsDefaults = { enabled: boolean; allowOnline: boolean; allowCash: boolean; allowCardTerminal: boolean; reservationMinutes: number };

/** Ödeme ayarları. Sağlayıcı anahtarları burada GİRİLMEZ (sunucu ortam değişkenleri); panel yalnızca durumu gösterir. */
export function PaymentSettingsForm({ action, defaults, disabled, providerConfigured }: { action: FormAction; defaults: PaymentSettingsDefaults; disabled: boolean; providerConfigured: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = fieldError(state, "reservationMinutes");
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6" data-testid="payment-settings-form">
      <FormAlert state={state} />
      <fieldset disabled={disabled} className="grid gap-6">
        <Switch id="pay-enabled" name="enabled" label="Ödemeler açık" description="Kapalıyken müşteriye “Ödeme Yap” gösterilmez ve kasada ödeme kaydı alınmaz. Sipariş verme etkilenmez." defaultChecked={defaults.enabled} />
        <Switch
          id="pay-online"
          name="allowOnline"
          label="QR üzerinden online ödeme"
          description={providerConfigured ? "Müşteri sipariş sayfasından tamamını, bir tutarı, eşit payını ya da kendi ürünlerini öder." : "Ödeme sağlayıcısı yapılandırılmadığı için müşteriye gösterilmez."}
          defaultChecked={defaults.allowOnline}
        />
        <Switch id="pay-cash" name="allowCash" label="Kasada nakit kaydı" defaultChecked={defaults.allowCash} />
        <Switch id="pay-terminal" name="allowCardTerminal" label="Kasada kart (POS cihazı) kaydı" defaultChecked={defaults.allowCardTerminal} />
        <Field id="pay-reserve" label="Ödeme ayırma süresi (dakika)" hint="Müşteri ödeme sayfasındayken tutar bu süre boyunca başkasına açılmaz; süre dolunca serbest kalır." error={err}>
          <Input id="pay-reserve" name="reservationMinutes" inputMode="numeric" defaultValue={String(defaults.reservationMinutes)} aria-invalid={!!err} aria-describedby={describedBy("pay-reserve", { hint: true, error: err })} className="max-w-32" />
        </Field>
        <div>
          <Button type="submit" loading={pending}>
            Ayarları kaydet
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

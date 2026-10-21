"use client";

import type { ActionResult } from "@/lib/action-result";
import { AI_LANGUAGE_LABELS, AI_LANGUAGES } from "@/lib/ai/language";
import { saveAiSettingsAction } from "@/server/actions/ai.actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useResultToast } from "@/components/ui/use-result-toast";
import { useFormAction } from "@/components/ui/use-form-action";

export type AiSettingsView = {
  enabled: boolean;
  assistantName: string;
  welcomeMessage: string;
  tone: "WARM" | "FORMAL" | "CASUAL";
  customInstructions: string;
  allowRecommendations: boolean;
  allowCartActions: boolean;
  allowServiceActions: boolean;
  voiceEnabled: boolean;
  defaultVoiceLanguage: string;
};

/** AI asistan ayar formu. Paket uygun değilse "AI'yi etkinleştir" kilitli; diğer tercihler yine kaydedilebilir (kapalı). */
export function AiSettingsForm({ settings, readOnly, featureAvailable }: { settings: AiSettingsView; readOnly: boolean; featureAvailable: boolean }) {
  const { state, pending, onSubmit } = useFormAction(saveAiSettingsAction, null as ActionResult | null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate data-testid="ai-settings-form">
      <FormAlert state={state} />
      <fieldset disabled={readOnly || pending} className="grid gap-5">
        <Checkbox
          id="ai-enabled"
          name="enabled"
          label="Sesli AI asistanı etkinleştir"
          description={featureAvailable ? "QR menüde “AI ile Konuş” düğmesi görünür." : "Voice AI mevcut paketinizde aktif değil."}
          defaultChecked={settings.enabled && featureAvailable}
          disabled={!featureAvailable}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ai-name" label="Asistan adı" error={err("assistantName")}>
            <Input id="ai-name" name="assistantName" maxLength={40} defaultValue={settings.assistantName} />
          </Field>
          <Field id="ai-tone" label="Ton" error={err("tone")}>
            <Select id="ai-tone" name="tone" defaultValue={settings.tone}>
              <option value="WARM">Sıcak ve samimi</option>
              <option value="FORMAL">Resmi ve kibar</option>
              <option value="CASUAL">Rahat ve güler yüzlü</option>
            </Select>
          </Field>
        </div>
        <Field id="ai-welcome" label="Karşılama mesajı" hint="Boşsa varsayılan karşılama (işletmenin varsayılan dilinde) kullanılır." error={err("welcomeMessage")}>
          <Input id="ai-welcome" name="welcomeMessage" maxLength={200} defaultValue={settings.welcomeMessage} placeholder="Merhaba, hoş geldiniz! Size nasıl yardımcı olabilirim?" />
        </Field>
        <Field id="ai-voice-lang" label="Başlangıç konuşma dili" hint="Boşsa işletmenin varsayılan dili. Müşteri konuşurken dil değiştirebilir." error={err("defaultVoiceLanguage")}>
          <Select id="ai-voice-lang" name="defaultVoiceLanguage" defaultValue={settings.defaultVoiceLanguage}>
            <option value="">İşletme varsayılanı</option>
            {AI_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {AI_LANGUAGE_LABELS[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="ai-custom"
          label="İşletme notu (isteğe bağlı)"
          hint="Ör. “Tatlıları yemek sonrası önermeye çalış.” En fazla 300 karakter. Bu not bir tercihtir: güvenlik kurallarını (alerjen güvencesi vermeme, sipariş göndermeme vb.) değiştiremez."
          error={err("customInstructions")}
        >
          <Textarea id="ai-custom" name="customInstructions" rows={3} maxLength={300} defaultValue={settings.customInstructions} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox id="ai-rec" name="allowRecommendations" label="Öneriler" description="Bütçe / kişi sayısına göre deterministik öneriler." defaultChecked={settings.allowRecommendations} />
          <Checkbox id="ai-cart" name="allowCartActions" label="Sepet önerileri" description="Asistan sepete ekleme önerir; müşteri düğmeyle onaylar." defaultChecked={settings.allowCartActions} />
          <Checkbox id="ai-service" name="allowServiceActions" label="Servis talepleri" description="Garson / su / peçete / hesap önerisi; müşteri onaylar." defaultChecked={settings.allowServiceActions} />
          <Checkbox id="ai-voice" name="voiceEnabled" label="Sesli yanıt" description="Kapalıysa asistan yalnızca yazılı yanıt verir." defaultChecked={settings.voiceEnabled} />
        </div>
      </fieldset>
      {!readOnly ? (
        <div>
          <Button type="submit" loading={pending}>
            Kaydet
          </Button>
        </div>
      ) : null}
    </form>
  );
}

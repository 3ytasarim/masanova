"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { SLOT_INTERVALS, type ReservationPolicy } from "@/lib/reservations/rules";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { describedBy, Field } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

export function StaffReservationForm({ action, branchId, date, areas, canOverride }: { action: FormAction; branchId: string; date: string; areas: { id: string; name: string }[]; canOverride: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" data-testid="staff-reservation-form">
      <FormAlert state={state} />
      <input type="hidden" name="branchId" value={branchId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="sr-date" label="Tarih" required error={err("date")}>
          <Input id="sr-date" name="date" type="date" defaultValue={date} aria-describedby={describedBy("sr-date", { error: err("date") })} />
        </Field>
        <Field id="sr-time" label="Saat" required error={err("time")} hint="SS:DD (şube saati)">
          <Input id="sr-time" name="time" type="time" step={300} defaultValue="19:00" aria-describedby={describedBy("sr-time", { hint: true, error: err("time") })} />
        </Field>
        <Field id="sr-party" label="Kişi" required error={err("party")}>
          <Input id="sr-party" name="party" inputMode="numeric" defaultValue="2" aria-describedby={describedBy("sr-party", { error: err("party") })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="sr-name" label="Misafir adı" required error={err("name")}>
          <Input id="sr-name" name="name" maxLength={80} autoComplete="off" aria-describedby={describedBy("sr-name", { error: err("name") })} />
        </Field>
        <Field id="sr-phone" label="Telefon" error={err("phone")} hint="Operasyonel iletişim; pazarlama izni değildir.">
          <Input id="sr-phone" name="phone" type="tel" autoComplete="off" aria-describedby={describedBy("sr-phone", { hint: true, error: err("phone") })} />
        </Field>
        <Field id="sr-email" label="E-posta" error={err("email")}>
          <Input id="sr-email" name="email" type="email" autoComplete="off" aria-describedby={describedBy("sr-email", { error: err("email") })} />
        </Field>
        <Field id="sr-source" label="Kaynak">
          <Select id="sr-source" name="source" defaultValue="PHONE">
            <option value="PHONE">Telefon</option>
            <option value="STAFF">Personel (yerinde)</option>
            <option value="OTHER">Diğer</option>
          </Select>
        </Field>
        {areas.length > 1 ? (
          <Field id="sr-area" label="Bölge tercihi">
            <Select id="sr-area" name="area" defaultValue="">
              <option value="">Fark etmez</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id="sr-duration" label="Süre (dk)" error={err("duration")} hint="Boş = varsayılan süre">
          <Input id="sr-duration" name="duration" inputMode="numeric" aria-describedby={describedBy("sr-duration", { hint: true, error: err("duration") })} />
        </Field>
      </div>
      <Field id="sr-request" label="Misafirin özel isteği" error={err("request")}>
        <Textarea id="sr-request" name="request" rows={2} maxLength={300} />
      </Field>
      <Field id="sr-note" label="İç not" error={err("note")} hint="Yalnızca personel görür.">
        <Textarea id="sr-note" name="note" rows={2} maxLength={500} aria-describedby="sr-note-hint" />
      </Field>
      {canOverride ? (
        <Checkbox id="sr-override" name="override" label="Kuralları aş (yönetici)" description="Açılış saati, kapalı dönem, ileri tarih ve kişi sınırlarını aşar. Masa çakışmasını ASLA aşmaz. Denetim kaydına yazılır." />
      ) : null}
      <div>
        <Button type="submit" loading={pending} data-testid="staff-reservation-submit">
          Rezervasyonu oluştur
        </Button>
      </div>
    </form>
  );
}

export function PolicyForm({ action, policy, disabled }: { action: FormAction; policy: ReservationPolicy; disabled: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  const num = (name: keyof ReservationPolicy, label: string, hint?: string) => (
    <Field id={`rp-${name}`} label={label} hint={hint} error={err(name)}>
      <Input id={`rp-${name}`} name={name} inputMode="numeric" defaultValue={String(policy[name])} aria-describedby={describedBy(`rp-${name}`, { hint, error: err(name) })} />
    </Field>
  );
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6" data-testid="reservation-policy-form">
      <FormAlert state={state && !state.ok ? state : null} />
      <fieldset disabled={disabled} className="grid gap-6">
        <div className="grid gap-4">
          <Switch id="rp-enabled" name="enabled" label="Rezervasyonlar açık" description="Panelde rezervasyon, walk-in ve masa planı." defaultChecked={policy.enabled} />
          <Switch id="rp-publicBookingEnabled" name="publicBookingEnabled" label="Online rezervasyon (müşteri sayfası)" description="Restoranın alan adında /rezervasyon sayfası açılır." defaultChecked={policy.publicBookingEnabled} />
          <Switch id="rp-autoConfirm" name="autoConfirm" label="Otomatik onay" description="Uygun masa bulunduğunda online rezervasyon hemen onaylanır; kapalıysa personel onaylar (masa yine ayrılır)." defaultChecked={policy.autoConfirm} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {num("defaultDurationMinutes", "Varsayılan süre (dk)")}
          <Field id="rp-slotIntervalMinutes" label="Saat aralığı (dk)">
            <Select id="rp-slotIntervalMinutes" name="slotIntervalMinutes" defaultValue={String(policy.slotIntervalMinutes)}>
              {SLOT_INTERVALS.map((v) => (
                <option key={v} value={v}>
                  {v} dk
                </option>
              ))}
            </Select>
          </Field>
          {num("bufferMinutes", "Masa hazırlık payı (dk)", "Rezervasyon sonrası temizlik süresi")}
          {num("minAdvanceMinutes", "En erken (dk önceden)")}
          {num("maxAdvanceDays", "En ileri (gün)")}
          {num("minPartySize", "En az kişi")}
          {num("maxPartySize", "Online en çok kişi", "Üstü için restoranı arama mesajı")}
          {num("cancellationCutoffMinutes", "Müşteri iptal sınırı (dk önce)", "0 = rezervasyon saatine kadar")}
          {num("noShowGraceMinutes", "“Gelmedi” bekleme payı (dk)")}
        </div>
        <div>
          <Button type="submit" loading={pending} data-testid="reservation-policy-submit">
            Ayarları kaydet
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

const DAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

export function HoursForm({ action, defaults, disabled }: { action: FormAction; defaults: string[]; disabled: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4" data-testid="hours-form">
      <FormAlert state={state && !state.ok ? state : null} />
      <fieldset disabled={disabled} className="grid gap-3">
        {DAY_NAMES.map((name, i) => (
          <Field key={name} id={`h-day${i + 1}`} label={name} error={fieldError(state, `day${i + 1}`)} className="sm:grid sm:grid-cols-[8rem_1fr] sm:items-center sm:gap-3">
            <Input id={`h-day${i + 1}`} name={`day${i + 1}`} defaultValue={defaults[i]} placeholder="Kapalı" aria-describedby={describedBy(`h-day${i + 1}`, { error: fieldError(state, `day${i + 1}`) })} />
          </Field>
        ))}
        <p className="text-xs text-fg-subtle">Biçim: 12:00-23:00 · iki aralık: 12:00-15:00,18:00-23:30 · boş = kapalı. Rezervasyon kapanıştan önce bitmelidir.</p>
        <div>
          <Button type="submit" variant="secondary" loading={pending} data-testid="hours-submit">
            Saatleri kaydet
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

export function BlackoutForm({ action, disabled }: { action: FormAction; disabled: boolean }) {
  const { state, pending, onSubmit, formRef } = useFormAction(action, null, { resetOnSuccess: (s) => !!s?.ok });
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4" data-testid="blackout-form">
      <FormAlert state={state && !state.ok ? state : null} />
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field id="bo-date" label="Başlangıç günü" error={err("date")}>
          <Input id="bo-date" name="date" type="date" />
        </Field>
        <Field id="bo-from" label="Saat">
          <Input id="bo-from" name="from" type="time" defaultValue="00:00" />
        </Field>
        <Field id="bo-end" label="Bitiş günü" error={err("endDate")} hint="Boş = aynı gün">
          <Input id="bo-end" name="endDate" type="date" />
        </Field>
        <Field id="bo-to" label="Saat" hint="Boş = gün sonu">
          <Input id="bo-to" name="to" type="time" />
        </Field>
        <Field id="bo-reason" label="Neden">
          <Input id="bo-reason" name="reason" maxLength={120} placeholder="Ör. özel etkinlik" />
        </Field>
      </fieldset>
      <div>
        <Button type="submit" variant="secondary" loading={pending} disabled={disabled}>
          Kapalı dönem ekle
        </Button>
      </div>
    </form>
  );
}

export function CombinationForm({ action, tables, disabled }: { action: FormAction; tables: { id: string; name: string; capacity: number | null; area: string | null }[]; disabled: boolean }) {
  const { state, pending, onSubmit, formRef } = useFormAction(action, null, { resetOnSuccess: (s) => !!s?.ok });
  useResultToast(state);
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4" data-testid="combination-form">
      <FormAlert state={state && !state.ok ? state : null} />
      <fieldset disabled={disabled} className="grid gap-4">
        <Field id="cb-name" label="Birleşim adı" error={fieldError(state, "name")}>
          <Input id="cb-name" name="name" maxLength={60} placeholder="Ör. Masa 4 + Masa 5" />
        </Field>
        <div>
          <p className="text-sm font-medium text-fg">Masalar (2–6)</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {tables.map((t) => (
              <label key={t.id} className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
                <input type="checkbox" name="tables" value={t.id} className="size-4 accent-current" />
                <span>
                  {t.name}
                  <span className="text-fg-subtle"> · {t.capacity ?? "?"} kişi</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <Button type="submit" variant="secondary" loading={pending}>
            Birleşim ekle
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

export function DeleteButton({ action, label, confirmText }: { action: () => Promise<ActionResult>; label: string; confirmText: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={pending}
      aria-label={label}
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        start(async () => {
          const r = await action();
          toast(r.ok ? (r.message ?? "Kaldırıldı.") : r.error, r.ok ? "success" : "error");
          if (r.ok) router.refresh();
        });
      }}
    >
      <Trash2 aria-hidden="true" />
    </Button>
  );
}

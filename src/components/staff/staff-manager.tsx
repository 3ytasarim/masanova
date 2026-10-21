"use client";

import { Check, Copy, KeyRound, Pencil, UserPlus } from "lucide-react";
import { useState } from "react";
import type { UserRole } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { ROLE_LABELS } from "@/lib/permissions/roles";
import { ROLE_HINTS, type StaffRole } from "@/lib/validation/staff";
import type { TempPasswordState } from "@/server/actions/staff.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, describedBy } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;
type TempAction = (state: TempPasswordState, formData: FormData) => Promise<TempPasswordState>;
/** Ortak form yardımcıları veri yükünü kullanmaz; yalnızca ok / hata / alan hataları okunur. */
const plain = (s: TempPasswordState) => s as unknown as ActionResult | null;

export type StaffView = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  active: boolean;
  lastSeen: string | null;
  isSelf: boolean;
  manageable: boolean;
};

/** Geçici parola: yalnızca bir kez gösterilir; sunucu saklamaz. */
function TempPassword({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft p-4" data-testid="temp-password">
      <p className="flex items-center gap-2 text-sm font-semibold text-warning">
        <KeyRound aria-hidden="true" className="size-4" /> Geçici parola — yalnızca şimdi gösteriliyor
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 select-all rounded-md border border-border bg-bg px-3 py-2.5 font-mono text-base tracking-wide text-fg">{value}</code>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Kopyalandı" : "Kopyala"}
        </Button>
      </div>
      <p className="mt-3 text-[0.8125rem] text-warning">Bu parola daha sonra görüntülenemez. Personele güvenli bir kanaldan iletin; ilk girişten sonra değiştirmesini isteyin.</p>
      <span className="sr-only" aria-live="polite">
        {copied ? "Parola panoya kopyalandı." : ""}
      </span>
    </div>
  );
}

function RoleSelect({ id, roles, defaultValue, error }: { id: string; roles: readonly StaffRole[]; defaultValue?: string; error?: string }) {
  const [role, setRole] = useState<StaffRole>((defaultValue as StaffRole) ?? (roles.includes("WAITER") ? "WAITER" : roles[0]!));
  return (
    <Field id={id} label="Rol" required error={error} hint={ROLE_HINTS[role]}>
      <Select id={id} name="role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} aria-describedby={describedBy(id, { hint: true, error })}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function AddStaffButton({ action, roles, disabledReason }: { action: TempAction; roles: readonly StaffRole[]; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [formKey, setFormKey] = useState(0);
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(plain(state));
  const err = (k: string) => fieldError(plain(state), k);
  const temp = state?.ok ? state.data.temporaryPassword : null;
  const done = !!state?.ok;

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!!disabledReason} title={disabledReason} data-testid="staff-add">
        <UserPlus aria-hidden="true" /> Personel ekle
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Kapanınca bir sonraki ekleme temiz formla başlar (geçici parola tekrar gösterilmez).
          if (!next && done) setFormKey((k) => k + 1);
        }}
        title="Personel ekle"
        description="Personel kendi e-postası ve parolasıyla /giris adresinden panele girer; yalnızca rolünün izin verdiği bölümleri görür."
      >
        {done ? (
          <div className="grid gap-4">
            <p className="text-sm text-fg">Personel hesabı oluşturuldu.</p>
            {temp ? <TempPassword value={temp} /> : null}
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setOpen(false);
                  setFormKey((k) => k + 1);
                }}
              >
                Tamam
              </Button>
            </div>
          </div>
        ) : (
          <form key={formKey} onSubmit={onSubmit} noValidate className="grid gap-4" data-testid="staff-add-form">
            <FormAlert state={plain(state)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="st-first" label="Ad" required error={err("firstName")}>
                <Input id="st-first" name="firstName" maxLength={80} autoComplete="off" aria-invalid={err("firstName") ? true : undefined} aria-describedby={describedBy("st-first", { error: err("firstName") })} />
              </Field>
              <Field id="st-last" label="Soyad" required error={err("lastName")}>
                <Input id="st-last" name="lastName" maxLength={80} autoComplete="off" aria-invalid={err("lastName") ? true : undefined} aria-describedby={describedBy("st-last", { error: err("lastName") })} />
              </Field>
            </div>
            <Field id="st-email" label="E-posta" required error={err("email")}>
              <Input id="st-email" name="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="off" aria-invalid={err("email") ? true : undefined} aria-describedby={describedBy("st-email", { error: err("email") })} />
            </Field>
            <RoleSelect id="st-role" roles={roles} error={err("role")} />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-fg">Parola</legend>
              {(
                [
                  ["generate", "Geçici parola oluştur (önerilen)"],
                  ["manual", "Parolayı ben belirleyeceğim"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm has-[:checked]:border-fg">
                  <input type="radio" name="passwordMode" value={value} checked={mode === value} onChange={() => setMode(value)} className="size-4 accent-primary" />
                  {label}
                </label>
              ))}
            </fieldset>
            {mode === "manual" ? (
              <Field id="st-pass" label="Parola" required error={err("password")} hint="En az 12 karakter.">
                <Input id="st-pass" name="password" type="password" autoComplete="new-password" aria-invalid={err("password") ? true : undefined} aria-describedby={describedBy("st-pass", { hint: true, error: err("password") })} />
              </Field>
            ) : null}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Vazgeç
              </Button>
              <Button type="submit" loading={pending}>
                Personeli ekle
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function EditStaffButton({ staff, action, roles }: { staff: StaffView; action: FormAction; roles: readonly StaffRole[] }) {
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok) setOpen(false);
    return result;
  }, null);
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  const id = `se-${staff.id}`;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="staff-edit">
        <Pencil aria-hidden="true" /> Düzenle<span className="sr-only">: {`${staff.firstName} ${staff.lastName}`}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Personeli düzenle" description={staff.email}>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormAlert state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-first`} label="Ad" required error={err("firstName")}>
              <Input id={`${id}-first`} name="firstName" defaultValue={staff.firstName} maxLength={80} />
            </Field>
            <Field id={`${id}-last`} label="Soyad" required error={err("lastName")}>
              <Input id={`${id}-last`} name="lastName" defaultValue={staff.lastName} maxLength={80} />
            </Field>
          </div>
          <RoleSelect id={`${id}-role`} roles={roles} defaultValue={staff.role} error={err("role")} />
          <div className="rounded-lg border border-border p-4">
            <Switch id={`${id}-active`} name="active" label="Hesap aktif" description="Pasif hesap giriş yapamaz ve açık oturumları hemen kapanır. Geçmiş kayıtlar silinmez." defaultChecked={staff.active} />
          </div>
          <p className="text-[0.8125rem] text-fg-subtle">Rol değişikliğinde personelin oturumu kapanır; yeni yetkileriyle yeniden giriş yapar.</p>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" loading={pending}>
              Kaydet
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function ResetPasswordButton({ staff, action }: { staff: StaffView; action: TempAction }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="staff-reset">
        <KeyRound aria-hidden="true" /> Parola<span className="sr-only">yı sıfırla: {`${staff.firstName} ${staff.lastName}`}</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setRound((r) => r + 1);
        }}
        title="Parolayı sıfırla"
        description={`${staff.firstName} ${staff.lastName} için yeni bir geçici parola oluşturulur; eski parola ve açık oturumlar hemen geçersiz olur.`}
      >
        <ResetBody key={round} action={action} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function ResetBody({ action, onClose }: { action: TempAction; onClose: () => void }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  if (state?.ok && state.data.temporaryPassword) {
    return (
      <div className="grid gap-4">
        <TempPassword value={state.data.temporaryPassword} />
        <div className="flex justify-end">
          <Button onClick={onClose}>Tamam</Button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormAlert state={plain(state)} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="submit" variant="danger" loading={pending}>
          Parolayı sıfırla
        </Button>
      </div>
    </form>
  );
}

export function OwnPasswordForm({ action }: { action: FormAction }) {
  const { state, pending, onSubmit } = useFormAction(action, null, { resetOnSuccess: (s) => !!s?.ok });
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4" data-testid="own-password-form">
      <FormAlert state={state} />
      <Field id="pw-current" label="Mevcut parola" required error={err("current")}>
        <Input id="pw-current" name="current" type="password" autoComplete="current-password" aria-invalid={err("current") ? true : undefined} />
      </Field>
      <Field id="pw-next" label="Yeni parola" required error={err("next")} hint="En az 12 karakter.">
        <Input id="pw-next" name="next" type="password" autoComplete="new-password" aria-invalid={err("next") ? true : undefined} aria-describedby={describedBy("pw-next", { hint: true, error: err("next") })} />
      </Field>
      <Field id="pw-confirm" label="Yeni parola (tekrar)" required error={err("confirm")}>
        <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" aria-invalid={err("confirm") ? true : undefined} />
      </Field>
      <div>
        <Button type="submit" loading={pending}>
          Parolayı değiştir
        </Button>
      </div>
    </form>
  );
}

export function StaffStatus({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="success" dot>
      Aktif
    </Badge>
  ) : (
    <Badge dot>Pasif</Badge>
  );
}

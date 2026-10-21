"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { RESERVATION_TRANSITIONS, TRANSITION_ACTION_LABELS, type ReservationStatusName } from "@/lib/reservations/status";
import { reservationStatusAction, walkInAction } from "@/server/actions/reservation.actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { describedBy, Field } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

const CONFIRM_TEXT: Partial<Record<ReservationStatusName, string>> = {
  CANCELLED: "Rezervasyon iptal edilsin mi? Masa serbest kalır.",
  NO_SHOW: "Misafir gelmedi olarak işaretlensin mi? Masa serbest kalır.",
  COMPLETED: "Rezervasyon tamamlansın mı? Masa serbest kalır.",
};

/** Durum makinesinin izin verdiği eylemler (tek kaynak: RESERVATION_TRANSITIONS). Sunucu yine doğrular. */
export function StatusButtons({ id, status, noShowAllowed, compact = false }: { id: string; status: ReservationStatusName; noShowAllowed: boolean; compact?: boolean }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const targets = RESERVATION_TRANSITIONS[status].filter((t) => t !== "NO_SHOW" || noShowAllowed);
  if (!targets.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="status-buttons">
      {targets.map((to) => (
        <Button
          key={to}
          size="sm"
          variant={to === "SEATED" || to === "CONFIRMED" ? "primary" : to === "CANCELLED" || to === "NO_SHOW" ? "ghost" : "secondary"}
          className={compact ? "h-9" : undefined}
          disabled={pending}
          data-action={to}
          onClick={() => {
            const confirmText = CONFIRM_TEXT[to];
            if (confirmText && !window.confirm(confirmText)) return;
            start(async () => {
              const r = await reservationStatusAction(id, to);
              toast(r.ok ? (r.message ?? "Güncellendi.") : r.error, r.ok ? "success" : "error");
              if (r.ok) router.refresh();
            });
          }}
        >
          {TRANSITION_ACTION_LABELS[to]}
        </Button>
      ))}
    </div>
  );
}

export function WalkInButton({ branchId, areas }: { branchId: string; areas: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { state, pending, onSubmit, formRef } = useFormAction(
    async (prev: ActionResult | null, fd: FormData) => {
      const r = await walkInAction(prev, fd);
      if (r?.ok) {
        setOpen(false);
        router.refresh();
      }
      return r;
    },
    null,
    { resetOnSuccess: (s) => !!s?.ok },
  );
  useResultToast(state);
  const err = (k: string) => fieldError(state, k);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="walkin-open">
        <UserPlus aria-hidden="true" /> Walk-in Ekle
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Walk-in Ekle" description="Şu an gelen misafir için uygun boş masa otomatik bulunur ve misafir masaya alınır.">
        <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4" data-testid="walkin-form">
          <FormAlert state={state && !state.ok ? state : null} />
          <input type="hidden" name="branchId" value={branchId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="wi-party" label="Kişi sayısı" required error={err("party")}>
              <Input id="wi-party" name="party" inputMode="numeric" defaultValue="2" aria-describedby={describedBy("wi-party", { error: err("party") })} />
            </Field>
            <Field id="wi-name" label="Ad (isteğe bağlı)">
              <Input id="wi-name" name="name" maxLength={80} autoComplete="off" />
            </Field>
          </div>
          {areas.length > 1 ? (
            <Field id="wi-area" label="Bölge tercihi">
              <Select id="wi-area" name="area" defaultValue="">
                <option value="">Fark etmez</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" loading={pending} data-testid="walkin-submit">
              Masa bul ve oturt
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function NoteForm({ action, defaultValue, disabled }: { action: FormAction; defaultValue: string; disabled: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3">
      <FormAlert state={state && !state.ok ? state : null} />
      <Field id="res-note" label="İç not" hint="Yalnızca personel görür; müşteriye gösterilmez. Sağlık / din gibi hassas bilgi yazmayın. En fazla 500 karakter.">
        <Textarea id="res-note" name="note" rows={3} maxLength={500} defaultValue={defaultValue} disabled={disabled} aria-describedby="res-note-hint" />
      </Field>
      {disabled ? null : (
        <div>
          <Button type="submit" variant="secondary" loading={pending}>
            Notu kaydet
          </Button>
        </div>
      )}
    </form>
  );
}

export function ReassignForm({ action, options, canOverride, tables }: { action: FormAction; options: { tableIds: string[]; label: string; capacity: number }[]; canOverride: boolean; tables: { id: string; name: string; capacity: number | null }[] }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const [mode, setMode] = useState<"suggested" | "manual">("suggested");
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3" data-testid="reassign-form">
      <FormAlert state={state && !state.ok ? state : null} />
      {mode === "suggested" ? (
        <Field id="reassign-option" label="Uygun masa seçenekleri" hint={options.length ? "Bu saatte boş ve kişi sayısına uygun olanlar." : "Bu saatte başka uygun masa yok."}>
          <Select id="reassign-option" name="tables" defaultValue={options[0]?.tableIds.join(",") ?? ""} disabled={!options.length}>
            {options.map((o) => (
              <option key={o.tableIds.join(",")} value={o.tableIds.join(",")}>
                {o.label} · {o.capacity} kişilik
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field id="reassign-manual" label="Masa (kural aşma)" hint="Kapasite / kullanım kuralını aşar; çakışmayı ASLA aşmaz. Denetim kaydına yazılır.">
          <Select id="reassign-manual" name="tables" defaultValue="">
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.capacity ? ` · ${t.capacity} kişilik` : ""}
              </option>
            ))}
          </Select>
          <input type="hidden" name="override" value="on" />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" loading={pending} disabled={mode === "suggested" && !options.length} data-testid="reassign-submit">
          Masayı ata
        </Button>
        {canOverride ? (
          <Button type="button" variant="ghost" onClick={() => setMode(mode === "suggested" ? "manual" : "suggested")}>
            {mode === "suggested" ? "Elle seç (kural aşma)" : "Önerilere dön"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

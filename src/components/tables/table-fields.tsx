"use client";

import type { ActionResult } from "@/lib/action-result";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, describedBy } from "@/components/ui/field";
import { fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type TableFieldDefaults = { name: string; number: number | null; code: string | null; capacity: number | null; capacityMin?: number | null; reservable?: boolean; areaId: string | null; active: boolean };

/** Masa formu alanları (yeni masa penceresi ve masa düzenleme sayfası ortak). */
export function TableFields({
  idPrefix,
  state,
  areas,
  defaults,
  onChange,
}: {
  idPrefix: string;
  state: ActionResult | null;
  areas: { id: string; name: string; active: boolean }[];
  defaults: TableFieldDefaults;
  onChange?: () => void;
}) {
  const err = (k: string) => fieldError(state, k);
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="grid gap-4" onChange={onChange}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("name")} label="Masa adı" required error={err("name")} hint="Müşterinin göreceği ad (ör. Masa 12, Teras 3).">
          <Input id={id("name")} name="name" required maxLength={40} defaultValue={defaults.name} aria-invalid={err("name") ? true : undefined} aria-describedby={describedBy(id("name"), { hint: true, error: err("name") })} />
        </Field>
        <Field id={id("area")} label="Bölge" error={err("diningAreaId")}>
          <Select id={id("area")} name="diningAreaId" defaultValue={defaults.areaId ?? ""} aria-describedby={describedBy(id("area"), { error: err("diningAreaId") })}>
            <option value="">— Bölgesiz —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.active ? a.name : `${a.name} (pasif)`}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field id={id("number")} label="Numara" error={err("number")} hint="Görüntü için">
          <Input id={id("number")} name="number" inputMode="numeric" defaultValue={defaults.number ?? ""} aria-describedby={describedBy(id("number"), { hint: true, error: err("number") })} />
        </Field>
        <Field id={id("code")} label="İç kod" error={err("code")} hint="Ör. S-12">
          <Input id={id("code")} name="code" maxLength={20} defaultValue={defaults.code ?? ""} aria-describedby={describedBy(id("code"), { hint: true, error: err("code") })} />
        </Field>
        <Field id={id("capacity")} label="Kapasite" error={err("capacity")} hint="Kişi">
          <Input id={id("capacity")} name="capacity" inputMode="numeric" defaultValue={defaults.capacity ?? ""} aria-describedby={describedBy(id("capacity"), { hint: true, error: err("capacity") })} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field id={id("capacityMin")} label="En az kişi" error={err("capacityMin")} hint="Rezervasyon (isteğe bağlı)">
          <Input id={id("capacityMin")} name="capacityMin" inputMode="numeric" defaultValue={defaults.capacityMin ?? ""} aria-describedby={describedBy(id("capacityMin"), { hint: true, error: err("capacityMin") })} />
        </Field>
      </div>
      <input type="hidden" name="reservablePresent" value="1" />
      <Checkbox id={id("reservable")} name="reservable" label="Rezervasyona açık" description="Kapasitesi girilmiş ve açık masalar rezervasyonda otomatik atanır." defaultChecked={defaults.reservable ?? true} />
      <Checkbox id={id("active")} name="active" label="Aktif" description="Pasif masanın QR kodu çalışmaz (QR silinmez; tekrar aktifleşince çalışır)." defaultChecked={defaults.active} />
    </div>
  );
}

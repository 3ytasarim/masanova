"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Star } from "lucide-react";
import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { STATION_TYPE_LABELS, STATION_TYPES, type StationTypeKey } from "@/lib/validation/stations";
import { saveStationAction, stationQuickAction } from "@/server/actions/station.actions";
import { QuickAction } from "@/components/menu/quick-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert, fieldError } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/ui/use-form-action";

export type StationView = { id: string; name: string; type: StationTypeKey; active: boolean; productCount: number };
export type BranchStationsView = { id: string; name: string; active: boolean; defaultStationId: string | null; stations: StationView[] };

type DialogState = { branch: BranchStationsView; station: StationView | null } | null;

/**
 * Şube başına istasyon listesi. Varsayılan istasyon: ataması olmayan ürünlerin düştüğü yer (şube başına en fazla bir).
 * Varsayılanı olmayan şubede yönlendirilmemiş ürün içeren sipariş kabul edilemez — bu ekran bunu açıkça uyarır.
 */
export function StationsManager({ branches, canManage }: { branches: BranchStationsView[]; canManage: boolean }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  return (
    <div className="grid gap-6">
      {branches.map((branch) => {
        const defaultStation = branch.stations.find((s) => s.id === branch.defaultStationId && s.active) ?? null;
        return (
          <Card key={branch.id} data-testid="station-branch">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{branch.name}</CardTitle>
                <p className="mt-1 text-sm text-fg-subtle">{defaultStation ? `Varsayılan istasyon: ${defaultStation.name}` : null}</p>
              </div>
              {canManage ? (
                <Button size="sm" onClick={() => setDialog({ branch, station: null })}>
                  <Plus aria-hidden="true" /> İstasyon ekle
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-3">
              {!defaultStation ? (
                <p role="status" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning" data-testid="no-default-station">
                  Bu şubede varsayılan istasyon yok. İstasyon ataması olmayan ürün içeren siparişler kabul edilemez.
                </p>
              ) : null}
              {branch.stations.length ? (
                <ul className="divide-y divide-border rounded-lg ring-1 ring-border">
                  {branch.stations.map((s, i) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="station-row">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {s.name}
                          <Badge tone="neutral">{STATION_TYPE_LABELS[s.type]}</Badge>
                          {s.id === branch.defaultStationId && s.active ? (
                            <Badge tone="accent" dot>
                              Varsayılan
                            </Badge>
                          ) : null}
                          {!s.active ? <Badge tone="warning">Pasif</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-sm text-fg-subtle">{s.productCount ? `${s.productCount} ürün atanmış` : "Atanmış ürün yok"}</p>
                      </div>
                      {canManage ? (
                        <div className="flex items-center gap-1">
                          {s.active && s.id !== branch.defaultStationId ? (
                            <QuickAction action={stationQuickAction} fields={{ id: s.id, op: "default" }} label={`${s.name}: varsayılan yap`}>
                              <Star aria-hidden="true" />
                            </QuickAction>
                          ) : null}
                          <QuickAction action={stationQuickAction} fields={{ id: s.id, op: "up" }} label={`${s.name}: yukarı taşı`} disabled={i === 0}>
                            <ArrowUp aria-hidden="true" />
                          </QuickAction>
                          <QuickAction action={stationQuickAction} fields={{ id: s.id, op: "down" }} label={`${s.name}: aşağı taşı`} disabled={i === branch.stations.length - 1}>
                            <ArrowDown aria-hidden="true" />
                          </QuickAction>
                          <QuickAction action={stationQuickAction} fields={{ id: s.id, op: "active", value: String(!s.active) }} label={s.active ? `${s.name}: pasifleştir` : `${s.name}: aktifleştir`}>
                            {s.active ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                          </QuickAction>
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ branch, station: s })} aria-label={`${s.name}: düzenle`}>
                            <Pencil aria-hidden="true" />
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-fg-subtle">Henüz istasyon yok. Örn. “Mutfak” (varsayılan) ve “Bar”.</p>
              )}
            </CardContent>
          </Card>
        );
      })}
      {dialog ? <StationDialog branch={dialog.branch} station={dialog.station} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}


function StationDialog({ branch, station, onClose }: { branch: BranchStationsView; station: StationView | null; onClose: () => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await saveStationAction(branch.id, station?.id ?? null, prev, fd);
    if (result?.ok) {
      toast(result.message ?? "Kaydedildi.", "success");
      onClose();
    }
    return result;
  }, null);
  const err = (k: string) => fieldError(state, k);
  const isDefault = station ? station.id === branch.defaultStationId : !branch.stations.some((s) => s.active && s.id === branch.defaultStationId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={station ? `İstasyon: ${station.name}` : "Yeni istasyon"} description={branch.name}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <FormAlert state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="station-name" label="Ad" error={err("name")} required>
            <Input id="station-name" name="name" maxLength={40} defaultValue={station?.name ?? ""} autoComplete="off" required />
          </Field>
          <Field id="station-type" label="Tip" error={err("type")}>
            <Select id="station-type" name="type" defaultValue={station?.type ?? "KITCHEN"}>
              {STATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STATION_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Checkbox id="station-default" name="isDefault" label="Varsayılan istasyon" description="İstasyon ataması olmayan ürünler bu istasyona düşer. Şubede yalnızca bir varsayılan olabilir." defaultChecked={isDefault} />
        <Checkbox id="station-active" name="active" label="Aktif" description="Pasif istasyona yeni fiş gönderilmez; geçmiş fişler korunur." defaultChecked={station?.active ?? true} />
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" loading={pending}>
            {station ? "Kaydet" : "İstasyonu oluştur"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

"use client";

import { QrCode } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { useUnsavedChanges } from "@/components/menu/use-unsaved-changes";
import { TableFields, type TableFieldDefaults } from "@/components/tables/table-fields";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/ui/use-form-action";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

export function TableEditForm({ action, areas, defaults }: { action: FormAction; areas: { id: string; name: string; active: boolean }[]; defaults: TableFieldDefaults }) {
  const { markDirty, markClean } = useUnsavedChanges();
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok) markClean();
    return result;
  }, null);
  useResultToast(state);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormAlert state={state} />
      <TableFields idPrefix="table" state={state} areas={areas} defaults={defaults} onChange={markDirty} />
      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          Kaydet
        </Button>
      </div>
    </form>
  );
}

/**
 * Onay gerektirmeyen QR işlemi (yalnızca "oluştur"; yenile/iptal onay penceresiyle). Başarıda düğme yerini
 * QR paneline bıraktığından (bileşen kaldırılır) bildirim efektle değil doğrudan eylem sonucunda verilir.
 */
export function QrActionButton({ action, op, label }: { action: FormAction; op: "create"; label: string }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok && result.message) toast(result.message, "success");
    return result;
  }, null);
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <input type="hidden" name="op" value={op} />
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" loading={pending}>
          {!pending ? <QrCode aria-hidden="true" /> : null}
          {label}
        </Button>
      </div>
    </form>
  );
}

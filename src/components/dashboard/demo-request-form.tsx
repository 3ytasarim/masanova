"use client";

import type { DemoRequestStatus } from "@prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { DEMO_STATUS } from "@/components/dashboard/demo-request-badge";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/components/ui/use-form-action";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

/** Super Admin: demo talebi durum + iç notlar. */
export function DemoRequestUpdateForm({ action, status, notes }: { action: FormAction; status: DemoRequestStatus; notes: string }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormAlert state={state} />
      <Field id="dr-status" label="Durum">
        <Select id="dr-status" name="status" defaultValue={status}>
          {Object.entries(DEMO_STATUS).map(([value, s]) => (
            <option key={value} value={value}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="dr-notes" label="İç notlar" hint="Yalnızca 3Y ekibi görür.">
        <Textarea id="dr-notes" name="notes" rows={6} maxLength={5000} defaultValue={notes} aria-describedby="dr-notes-hint" />
      </Field>
      <div>
        <Button type="submit" loading={pending}>
          Kaydet
        </Button>
      </div>
    </form>
  );
}

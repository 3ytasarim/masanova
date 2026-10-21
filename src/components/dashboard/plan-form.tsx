"use client";

import type { TenantPlan } from "@prisma/client";
import { Check, Minus } from "lucide-react";
import { useState } from "react";
import { FEATURE_LABELS, FEATURES, PLANS, PLAN_ORDER } from "@/config/plans";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/components/ui/use-form-action";
import { FormAlert } from "@/components/ui/form-alert";
import { useResultToast } from "@/components/ui/use-result-toast";

type FormAction = (state: ActionResult | null, formData: FormData) => Promise<ActionResult | null>;

export function PlanForm({ action, current }: { action: FormAction; current: TenantPlan }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  const [selected, setSelected] = useState<TenantPlan>(current);
  useResultToast(state);

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormAlert state={state} />
      <fieldset>
        <legend className="sr-only">Paket</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {PLAN_ORDER.map((key) => (
            <label key={key} className={cn("flex cursor-pointer flex-col rounded-lg border p-4", selected === key ? "border-fg bg-surface" : "border-border hover:border-border-strong")}>
              <span className="flex items-center gap-2">
                <input type="radio" name="plan" value={key} checked={selected === key} onChange={() => setSelected(key)} className="size-4 accent-primary" />
                <span className="font-semibold">{PLANS[key].label}</span>
                {current === key ? <span className="ml-auto text-xs text-fg-subtle">Mevcut</span> : null}
              </span>
              <span className="mt-1.5 text-[0.8125rem] text-fg-subtle">{PLANS[key].description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Paket özellikleri karşılaştırması</caption>
          <thead className="bg-surface">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">Özellik</th>
              {PLAN_ORDER.map((p) => (
                <th key={p} scope="col" className="px-2 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-fg-subtle">{PLANS[p].label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f} className="border-t border-border">
                <th scope="row" className="px-4 py-2.5 text-left font-normal text-fg-muted">{FEATURE_LABELS[f]}</th>
                {PLAN_ORDER.map((p) => (
                  <td key={p} className="px-2 py-2.5 text-center">
                    {PLANS[p].features.includes(f) ? <Check aria-label="Dahil" className="mx-auto size-4 text-success" /> : <Minus aria-label="Dahil değil" className="mx-auto size-4 text-fg-subtle" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button type="submit" loading={pending} disabled={selected === current}>
          Paketi güncelle
        </Button>
      </div>
    </form>
  );
}

"use client";

import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { useResultToast } from "@/components/ui/use-result-toast";
import { useFormAction } from "@/components/ui/use-form-action";

export type ProductStationsBranch = {
  branchId: string;
  branchName: string;
  defaultStationName: string | null;
  stations: { id: string; name: string; active: boolean }[];
  selected: string[];
};

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult | null>;

/**
 * Ürün → istasyon yönlendirmesi (şube başına). Hiçbiri seçilmezse ürün şubenin varsayılan istasyonuna düşer.
 * Birden fazla istasyon seçilirse kalem her birine ayrı fiş olarak gider (ör. hem Izgara hem Soğuk mutfak).
 */
export function ProductStationsPanel({ action, branches, readOnly }: { action: Action; branches: ProductStationsBranch[]; readOnly: boolean }) {
  if (!branches.length) return <p className="text-sm text-fg-subtle">Şube yok.</p>;
  return (
    <div className="grid gap-6">
      <p className="text-sm text-fg-subtle">Ürün siparişte kabul edildiğinde seçilen istasyonların mutfak ekranına fiş olarak düşer. Seçim yoksa şubenin varsayılan istasyonu kullanılır.</p>
      {branches.map((b) => (
        <BranchForm key={b.branchId} action={action} branch={b} readOnly={readOnly} />
      ))}
    </div>
  );
}

function BranchForm({ action, branch, readOnly }: { action: Action; branch: ProductStationsBranch; readOnly: boolean }) {
  const { state, pending, onSubmit } = useFormAction(action, null);
  useResultToast(state);
  const visible = branch.stations.filter((s) => s.active || branch.selected.includes(s.id));
  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-lg p-4 ring-1 ring-border" data-testid="product-stations-branch">
      <input type="hidden" name="branchId" value={branch.branchId} />
      <fieldset disabled={readOnly || pending} className="grid gap-3">
        <legend className="font-medium">{branch.branchName}</legend>
        <FormAlert state={state} />
        {visible.length ? (
          <div className="flex flex-wrap gap-2">
            {visible.map((s) => (
              <label key={s.id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 ring-1 ring-border has-[:checked]:bg-accent-soft has-[:checked]:ring-accent">
                <input type="checkbox" name="stationIds" value={s.id} defaultChecked={branch.selected.includes(s.id)} className="size-4 accent-[var(--color-accent)]" />
                {s.name}
                {!s.active ? <span className="text-xs text-fg-subtle">(pasif)</span> : null}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">Bu şubede istasyon yok.</p>
        )}
        <p className="text-sm text-fg-subtle">{branch.defaultStationName ? `Seçim yoksa: ${branch.defaultStationName} (varsayılan)` : "Bu şubenin varsayılan istasyonu yok — seçim yapılmazsa sipariş kabul edilemez."}</p>
        {!readOnly ? (
          <div>
            <Button type="submit" size="sm" loading={pending}>
              Kaydet
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

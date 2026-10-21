import type { ActionResult } from "@/lib/action-result";

/** Form düzeyi hata özeti (role=alert ile ekran okuyucuya hemen duyurulur). */
export function FormAlert({ state }: { state: ActionResult | null | undefined }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger">
      {state.error}
    </p>
  );
}

export function fieldError(state: ActionResult | null | undefined, key: string): string | undefined {
  return state && !state.ok ? state.fieldErrors?.[key] : undefined;
}

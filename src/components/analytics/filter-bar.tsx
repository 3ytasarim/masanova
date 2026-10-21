"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FilterLabels } from "@/lib/analytics/labels";
import { RANGE_KEYS, type RangeKey } from "@/lib/analytics/range";

/**
 * Dönem + şube seçimi. Değerler URL'de (paylaşılabilir / geri tuşu çalışır); sunucu her şeyi yeniden doğrular
 * (şube bu kiracıya ait mi, aralık ≤ 366 gün mü). Tarayıcı kiracı kimliği göndermez.
 */
export function AnalyticsFilterBar({
  labels,
  range,
  from,
  to,
  branch,
  branches,
  tab,
}: {
  labels: FilterLabels;
  range: RangeKey;
  from: string;
  to: string;
  branch: string;
  branches: { id: string; name: string }[];
  tab: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState({ range, from, to, branch });

  const navigate = (next: typeof state) => {
    const params = new URLSearchParams();
    params.set("aralik", next.range);
    if (next.range === "custom") {
      params.set("bas", next.from);
      params.set("bit", next.to);
    }
    if (next.branch) params.set("sube", next.branch);
    if (tab !== "overview") params.set("sekme", tab);
    startTransition(() => router.push(`/panel/analitik?${params.toString()}`));
  };

  const update = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    setState(next);
    if (next.range !== "custom") navigate(next);
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        navigate(state);
      }}
      data-testid="analytics-filters"
    >
      <label className="grid gap-1 text-sm">
        <span className="text-xs font-medium text-fg-subtle">{labels.period}</span>
        <select
          className="h-11 min-w-[10rem] rounded-md border border-border bg-bg px-3 text-sm text-fg"
          value={state.range}
          onChange={(e) => update({ range: e.target.value as RangeKey })}
          data-testid="analytics-range"
        >
          {RANGE_KEYS.map((k) => (
            <option key={k} value={k}>
              {labels.ranges[k]}
            </option>
          ))}
        </select>
      </label>
      {state.range === "custom" ? (
        <>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-fg-subtle">{labels.from}</span>
            <input type="date" required className="h-11 rounded-md border border-border bg-bg px-3 text-sm" value={state.from} onChange={(e) => setState({ ...state, from: e.target.value })} data-testid="analytics-from" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-fg-subtle">{labels.to}</span>
            <input type="date" required className="h-11 rounded-md border border-border bg-bg px-3 text-sm" value={state.to} onChange={(e) => setState({ ...state, to: e.target.value })} data-testid="analytics-to" />
          </label>
          <button type="submit" className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover">
            {labels.apply}
          </button>
        </>
      ) : null}
      {branches.length > 1 ? (
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium text-fg-subtle">{labels.branch}</span>
          <select className="h-11 min-w-[10rem] rounded-md border border-border bg-bg px-3 text-sm text-fg" value={state.branch} onChange={(e) => update({ branch: e.target.value })} data-testid="analytics-branch">
            <option value="">{labels.allBranches}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-fg hover:bg-surface"
        data-testid="analytics-refresh"
      >
        <RefreshCw aria-hidden="true" className={pending ? "size-4 animate-spin" : "size-4"} />
        {labels.refresh}
      </button>
    </form>
  );
}

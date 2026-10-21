import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import type { Comparison } from "@/lib/analytics/metrics";
import { cn } from "@/lib/utils/cn";

/**
 * Analitik görselleri — kütüphanesiz, SUNUCUDA çizilen SVG / HTML (sıfır istemci JS; QR menü paketi etkilenmez).
 * Erişilebilirlik: her grafik role="img" + aria-label özetiyle, her çubukta <title> ipucu ve "Tablo olarak göster"
 * alternatif tablosu. Renk tek ayırt edici değildir: değerler her zaman metin olarak da yazılır.
 */

export function Panel({ title, description, children, actions, className, testId }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-bg p-5 shadow-xs", className)} data-testid={testId}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {description ? <p className="mt-1 text-[0.8125rem] text-fg-subtle">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-surface px-4 py-6 text-center text-sm text-fg-subtle" data-testid="analytics-empty">
      {children}
    </p>
  );
}

export function KpiCard({ label, value, comparison, previous, lowDataText, testId, hint }: { label: string; value: ReactNode; comparison?: Comparison | null; previous?: ReactNode; lowDataText: string; testId?: string; hint?: ReactNode }) {
  let chip: ReactNode = null;
  if (comparison) {
    if (comparison.lowData || comparison.pct === null) {
      chip = <span className="text-[0.75rem] text-fg-subtle">{lowDataText}</span>;
    } else {
      const up = comparison.trend === "up";
      const flat = comparison.trend === "flat";
      const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
      chip = (
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.75rem] font-medium tabular-nums", flat ? "bg-surface-2 text-fg-muted" : up ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
          <Icon aria-hidden="true" className="size-3.5" />
          {comparison.pct > 0 ? "+" : ""}
          {comparison.pct.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%
        </span>
      );
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-bg p-4 shadow-xs" data-testid={testId}>
      <span className="text-[0.8125rem] font-medium text-fg-subtle">{label}</span>
      <span className="truncate text-[1.5rem] font-semibold leading-none tracking-tight text-fg tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </span>
      <div className="flex min-h-5 flex-wrap items-center gap-2">
        {chip}
        {previous !== undefined && previous !== null ? <span className="text-[0.75rem] text-fg-subtle tabular-nums">{previous}</span> : null}
      </div>
      {hint ? <span className="text-[0.75rem] text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

export type BarDatum = { key: string; label: string; value: number; display: string; secondary?: string };

/** Dikey çubuk grafik (zaman serisi). Uzun serilerde etiketler seyreltilir. */
export function ColumnChart({ data, ariaLabel, tableLabel, valueHeader, testId }: { data: BarDatum[]; ariaLabel: string; tableLabel: string; valueHeader: string; testId?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = Math.max(320, data.length * 22);
  const height = 180;
  const barW = width / data.length;
  const step = Math.ceil(data.length / 12);
  return (
    <div data-testid={testId}>
      <div className="overflow-x-auto">
        <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height + 24}`} className="h-auto w-full min-w-[320px]" preserveAspectRatio="none">
          {[0.25, 0.5, 0.75, 1].map((g) => (
            <line key={g} x1={0} x2={width} y1={height - height * g} y2={height - height * g} className="stroke-border" strokeWidth={0.5} />
          ))}
          {data.map((d, i) => {
            const h = Math.round((d.value / max) * (height - 4));
            return (
              <g key={d.key} data-bucket={d.key} data-value={d.value}>
                <rect x={i * barW + barW * 0.15} y={height - h} width={barW * 0.7} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={2} className="fill-accent">
                  <title>{`${d.label}: ${d.display}${d.secondary ? ` · ${d.secondary}` : ""}`}</title>
                </rect>
                {i % step === 0 ? (
                  <text x={i * barW + barW / 2} y={height + 16} textAnchor="middle" className="fill-fg-subtle text-[9px]">
                    {d.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-fg-subtle">{tableLabel}</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-[0.8125rem]">
            <thead>
              <tr>
                <th className="py-1 pr-3 font-medium text-fg-subtle"> </th>
                <th className="py-1 font-medium text-fg-subtle">{valueHeader}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key}>
                  <td className="py-0.5 pr-3 tabular-nums">{d.label}</td>
                  <td className="py-0.5 tabular-nums">
                    {d.display}
                    {d.secondary ? ` · ${d.secondary}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Yatay çubuk listesi (sıralamalar). */
export function BarList({ items, testId, emptyText }: { items: { key: string; label: ReactNode; value: number; display: ReactNode; extra?: ReactNode }[]; testId?: string; emptyText: string }) {
  if (!items.length) return <EmptyNote>{emptyText}</EmptyNote>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="grid gap-2.5" data-testid={testId}>
      {items.map((i) => (
        <li key={i.key} className="grid gap-1" data-testid={testId ? `${testId}-row` : undefined}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-fg">{i.label}</span>
            <span className="shrink-0 tabular-nums text-fg-muted">{i.display}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.round((i.value / max) * 100))}%` }} />
          </div>
          {i.extra ? <div className="text-[0.75rem] text-fg-subtle">{i.extra}</div> : null}
        </li>
      ))}
    </ol>
  );
}

/** Gün × saat ısı haritası (değerler hücrede metin olarak da ipucunda). */
export function Heatmap({ cells, weekdays, ariaLabel, formatValue, testId }: { cells: { weekday: number; hour: number; value: number }[]; weekdays: string[]; ariaLabel: string; formatValue: (v: number) => string; testId?: string }) {
  const max = Math.max(1, ...cells.map((c) => c.value));
  const at = (d: number, h: number) => cells.find((c) => c.weekday === d && c.hour === h)?.value ?? 0;
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table role="img" aria-label={ariaLabel} className="min-w-[640px] border-separate border-spacing-[2px] text-[0.6875rem]">
        <thead>
          <tr>
            <th className="w-10" />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="font-normal text-fg-subtle tabular-nums">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekdays.map((name, i) => (
            <tr key={name}>
              <th scope="row" className="pr-2 text-right font-normal text-fg-subtle">
                {name}
              </th>
              {Array.from({ length: 24 }, (_, h) => {
                const v = at(i + 1, h);
                return (
                  <td key={h} className="h-6 min-w-5 rounded-sm" style={{ background: v ? `color-mix(in srgb, var(--accent) ${Math.round(15 + (v / max) * 85)}%, transparent)` : "var(--surface-2, #f4f4f5)" }} title={`${name} ${String(h).padStart(2, "0")}:00 — ${formatValue(v)}`}>
                    <span className="sr-only">{`${name} ${h}: ${formatValue(v)}`}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatGrid({ items }: { items: { label: string; value: ReactNode; testId?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-md bg-surface px-3 py-2.5" data-testid={i.testId}>
          <dt className="text-[0.75rem] text-fg-subtle">{i.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

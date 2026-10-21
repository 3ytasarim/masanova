import { ArrowUpRight, BarChart3, Sparkles } from "lucide-react";
import Link from "next/link";
import { CATEGORY_LABELS, CONFIDENCE_LABELS, SEVERITY_LABELS } from "@/lib/advisor/templates";
import { cn } from "@/lib/utils/cn";
import type { AdvisorCard } from "@/server/services/advisor/advisor.service";
import { InsightActions } from "@/components/advisor/advisor-controls";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const SEVERITY_TONE: Record<AdvisorCard["severity"], BadgeTone> = { INFO: "info", OPPORTUNITY: "success", ATTENTION: "warning" };
const CONFIDENCE_DOTS: Record<AdvisorCard["confidence"], number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * İçgörü kartı — sakin, açıklanabilir: bulgu → karşılaştırma → neden önemli → değerlendirilebilecek eylem.
 * "Bu nasıl hesaplandı?" yerel <details> (JS gerekmez) ile ham girdileri gösterir. AI açıklaması açıkça işaretlenir.
 */
export function InsightCard({ card, period, canManage }: { card: AdvisorCard; period: { current: string; previous: string }; canManage: boolean }) {
  const hasPrevious = card.metrics.some((m) => m.previous !== null);
  return (
    <article
      className="flex min-w-0 flex-col rounded-lg border border-border bg-bg p-5 shadow-xs"
      data-testid="insight-card"
      data-type={card.type}
      data-subject={card.subject ?? ""}
      data-source={card.explanation.source}
      aria-labelledby={`insight-${card.type}-${card.subjectKey}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[card.severity]} data-testid="insight-severity">
          {SEVERITY_LABELS[card.severity]}
        </Badge>
        <span className="text-xs font-medium text-fg-subtle">{CATEGORY_LABELS[card.category]}</span>
        {card.isNew ? <Badge tone="accent">Yeni</Badge> : null}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-fg-subtle" data-testid="insight-confidence" data-confidence={card.confidence}>
          <span aria-hidden="true" className="inline-flex gap-0.5">
            {[1, 2, 3].map((i) => (
              <span key={i} className={cn("size-1.5 rounded-full", i <= CONFIDENCE_DOTS[card.confidence] ? "bg-fg-muted" : "bg-border-strong")} />
            ))}
          </span>
          {CONFIDENCE_LABELS[card.confidence]}
        </span>
      </div>
      <h3 id={`insight-${card.type}-${card.subjectKey}`} className="mt-3 text-[1.0625rem] font-semibold leading-snug text-fg" data-testid="insight-title">
        {card.rendered.title}
      </h3>
      {card.rendered.comparison ? (
        <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums text-fg" data-testid="insight-comparison">
          {card.rendered.comparison}
        </p>
      ) : null}
      <p className="mt-2 text-sm leading-relaxed text-fg-muted" data-testid="insight-summary">
        {card.explanation.summary}
      </p>
      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="font-medium text-fg">Neden önemli</dt>
          <dd className="mt-0.5 leading-relaxed text-fg-muted">{card.explanation.whyItMatters}</dd>
        </div>
        <div className="rounded-md bg-surface px-3 py-2.5">
          <dt className="font-medium text-fg">Değerlendirilebilecek eylem</dt>
          <dd className="mt-0.5 leading-relaxed text-fg-muted" data-testid="insight-action">
            {card.explanation.suggestedAction}
          </dd>
        </div>
      </dl>
      {card.explanation.source === "ai" ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-fg-subtle" data-testid="insight-ai-label">
          <Sparkles aria-hidden="true" className="size-3.5" /> Açıklama AI tarafından yazıldı; rakamlar hesaplanan verilerden doğrulandı.
        </p>
      ) : null}

      <details className="group mt-4 rounded-md border border-border" data-testid="insight-how">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-fg-muted hover:text-fg">
          Bu nasıl hesaplandı?
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-border px-3 py-3 text-sm">
          <p className="text-xs text-fg-subtle">
            Bu dönem: {period.current}
            {hasPrevious ? ` · Önceki eşdeğer dönem: ${period.previous}` : ""}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[18rem] text-left">
              <thead>
                <tr className="text-xs text-fg-subtle">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Ölçüm
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Bu dönem
                  </th>
                  {hasPrevious ? (
                    <th scope="col" className="py-1 font-medium">
                      Önceki dönem
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody data-testid="insight-metrics">
                {card.metrics.map((m) => (
                  <tr key={m.label} className="border-t border-border/70 align-top">
                    <th scope="row" className="py-1.5 pr-3 font-normal text-fg-muted">
                      {m.label}
                      {m.note ? <span className="block text-xs text-fg-subtle">{m.note}</span> : null}
                    </th>
                    <td className="py-1.5 pr-3 font-medium tabular-nums">{m.current}</td>
                    {hasPrevious ? <td className="py-1.5 tabular-nums text-fg-muted">{m.previous ?? "—"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-fg-subtle">Yalnızca toplu sipariş, mutfak, servis ve AI kullanım verileri kullanılır. Süreler medyan; sipariş tutarı kabul edilmiş siparişlerdir.</p>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <Link href={card.deepLink} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-fg hover:underline" data-testid="insight-deeplink">
          <BarChart3 aria-hidden="true" className="size-4" /> Analitikte aç <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
        {canManage && card.id ? <InsightActions id={card.id} feedback={card.feedback} /> : null}
      </div>
    </article>
  );
}

"use client";

import { RefreshCw, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils/cn";
import { dismissInsightAction, insightFeedbackAction, refreshAdvisorAction } from "@/server/actions/advisor.actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** "Analizi Yenile" — hız sınırlı; AI açıklaması yalnızca olgular değiştiyse istenir (aynı olgular → yeniden kullanım). */
export function RefreshButton({ range, branch }: { range: string; branch: string }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      data-testid="advisor-refresh"
      onClick={() =>
        start(async () => {
          const r = await refreshAdvisorAction(range, branch);
          toast(r.ok ? (r.message ?? "Analiz yenilendi.") : r.error, r.ok ? "success" : "error");
          router.refresh();
        })
      }
    >
      <RefreshCw aria-hidden="true" /> Analizi Yenile
    </Button>
  );
}

/** Kart eylemleri: kapat + faydalı / faydalı değil. Analitik verisine dokunmaz. */
export function InsightActions({ id, feedback }: { id: string; feedback: "USEFUL" | "NOT_USEFUL" | null }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState(feedback);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) after?.();
      toast(r.ok ? (r.message ?? "Kaydedildi.") : (r.error ?? "İşlem başarısız."), r.ok ? "success" : "error");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-fg-subtle">Faydalı mı?</span>
      {(["USEFUL", "NOT_USEFUL"] as const).map((v) => (
        <button
          key={v}
          type="button"
          disabled={pending}
          aria-pressed={current === v}
          aria-label={v === "USEFUL" ? "Faydalı" : "Faydalı değil"}
          data-testid={`insight-feedback-${v.toLowerCase()}`}
          onClick={() => run(() => insightFeedbackAction(id, v), () => setCurrent(v))}
          className={cn("inline-flex size-11 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50", current === v && "bg-surface-2 text-fg")}
        >
          {v === "USEFUL" ? <ThumbsUp aria-hidden="true" className="size-4" /> : <ThumbsDown aria-hidden="true" className="size-4" />}
        </button>
      ))}
      <Button variant="ghost" size="sm" disabled={pending} data-testid="insight-dismiss" onClick={() => run(() => dismissInsightAction(id))}>
        <X aria-hidden="true" /> Kapat
      </Button>
    </div>
  );
}

"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TranslateStepActionResult } from "@/server/actions/menu-translate.actions";
import { Button } from "@/components/ui/button";

/**
 * Menüyü yapay zekâyla çevir: adım eylemini kalan 0 olana dek ardışık çağırır (her adım ≈20 sn, proxy zaman aşımına
 * takılmaz). Yalnızca eksik çeviriler yazılır; elle girilmiş çeviriler korunur.
 */
export function AutoTranslateCard({ missing, locales, step, readOnly }: { missing: number; locales: string[]; step: () => Promise<TranslateStepActionResult>; readOnly: boolean }) {
  const router = useRouter();
  const [running, start] = useTransition();
  const [progress, setProgress] = useState<{ done: number; remaining: number } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const run = () =>
    start(async () => {
      setMessage(null);
      let done = 0;
      let remaining = missing;
      setProgress({ done, remaining });
      for (let i = 0; i < 60 && remaining > 0; i++) {
        const r = await step();
        if (!r.ok) {
          setMessage({ tone: "error", text: r.error });
          break;
        }
        done += r.data.translated;
        remaining = r.data.remaining;
        setProgress({ done, remaining });
        if (r.data.translated === 0) break;
      }
      if (remaining === 0) setMessage({ tone: "ok", text: `Menü çevrildi (${done} kayıt). QR menüde dil değiştirince ürün adları ve açıklamalar artık o dilde görünür.` });
      router.refresh();
    });

  const total = progress ? progress.done + progress.remaining : missing;
  const percent = progress && total > 0 ? Math.round((progress.done / total) * 100) : 0;

  return (
    <section aria-label="Otomatik çeviri" data-testid="auto-translate" className="mt-8 rounded-2xl border border-orange-200/70 bg-[linear-gradient(135deg,rgb(255_247_237/0.9),rgb(254_242_242/0.7))] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/80 text-orange-600 shadow-sm">
            <Languages aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-stone-900">Menüyü yapay zekâyla çevir</p>
            <p className="mt-0.5 text-[0.8125rem] text-stone-600">
              {missing > 0
                ? `${missing} çeviri eksik (${locales.map((l) => l.toUpperCase()).join(", ")}). Ürün adları, açıklamalar, kategoriler ve seçenekler çevrilir; elle girdiğiniz çeviriler değişmez.`
                : `Menünüzün tamamı çevrili (${locales.map((l) => l.toUpperCase()).join(", ")}). Yeni eklediğiniz ürünler birkaç dakika içinde otomatik çevrilir.`}
            </p>
          </div>
        </div>
        {missing > 0 ? (
          <Button type="button" onClick={run} loading={running} disabled={readOnly || running} data-testid="auto-translate-run" className="shrink-0">
            Eksik çevirileri tamamla
          </Button>
        ) : null}
      </div>
      {progress && running ? (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-white/70" aria-hidden="true">
            <div className="h-full rounded-full bg-orange-500 transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-stone-600">
            Çevriliyor… {progress.done} / {total}
          </p>
        </div>
      ) : null}
      {message ? (
        <p role="status" data-testid="auto-translate-message" className={message.tone === "ok" ? "mt-3 text-sm text-emerald-700" : "mt-3 text-sm text-danger"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

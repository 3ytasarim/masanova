"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { MENU_QA } from "@/content/marketing/copy";
import { cn } from "@/lib/utils/cn";

/**
 * "Menünüzü bilen garson" etkileşimi: soru seçilir → yanıt yazılarak gelir (hareket azaltmada anında). Yanıt alanı
 * aria-live ile duyurulur; yanıt metni her zaman DOM'da tam hâliyle bulunur (ekran okuyucu ve JS kapalı için).
 */
export function MenuQa() {
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<number>(Infinity);
  const answer = MENU_QA.questions[active]!.a;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 3;
      setShown(i);
      if (i >= answer.length) window.clearInterval(id);
    }, 18);
    return () => window.clearInterval(id);
  }, [answer]);

  const typing = shown < answer.length;
  return (
    <div>
      <p className="text-[0.9375rem] font-semibold text-fg">{MENU_QA.prompt}</p>
      <div role="radiogroup" aria-label={MENU_QA.prompt} className="mt-3 flex flex-wrap gap-2" data-testid="menu-qa-questions">
        {MENU_QA.questions.map((item, i) => (
          <button
            key={item.q}
            type="button"
            role="radio"
            aria-checked={i === active}
            onClick={() => {
              setShown(0);
              setActive(i);
            }}
            className={cn(
              "min-h-11 rounded-full border px-4 text-[0.9375rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
              i === active ? "border-fg bg-fg text-bg" : "border-border-strong bg-bg text-fg hover:bg-surface-2",
            )}
          >
            {item.q}
          </button>
        ))}
      </div>
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-border bg-bg p-5 shadow-[0_20px_50px_-30px_rgb(12_10_9/0.45)] sm:p-6" data-testid="menu-qa-answer">
        <span aria-hidden="true" className="absolute inset-y-0 start-0 w-1 bg-[linear-gradient(to_bottom,#ea580c,#dc2626)]" />
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent-strong">
          <Sparkles aria-hidden="true" className="size-3.5" /> {MENU_QA.answerLabel}
        </p>
        <p aria-live="polite" className="mt-3 min-h-[5.5rem] text-[1.0625rem] leading-relaxed text-fg">
          <span className="sr-only">{answer}</span>
          <span aria-hidden="true">
            {answer.slice(0, Math.min(shown, answer.length))}
            {typing ? <span className="ms-0.5 inline-block h-5 w-0.5 translate-y-1 animate-pulse bg-accent" /> : null}
          </span>
        </p>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">{MENU_QA.note}</p>
    </div>
  );
}

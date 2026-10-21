"use client";

import { Hand, Keyboard, PhoneOff } from "lucide-react";
import type { LiveStrings } from "@/lib/ai/i18n";
import type { LiveMachine } from "@/lib/voice/live-session";
import { cn } from "@/lib/utils/cn";

/**
 * Canlı konuşma denetimleri (mobil öncelikli): ses küresi + dalga, durum, "Sözü Kes", "Konuşmayı Bitir".
 * Küre mikrofon seviyesini CSS değişkeniyle (--level) izler — React yeniden çizimi yok. Azaltılmış hareket tercihinde
 * ölçek / dalga animasyonu kapanır; durum metinle ve renkle yine anlaşılır.
 */
export function LiveControls({
  machine,
  status,
  ls,
  levelRef,
  typing,
  onToggleTyping,
  onInterrupt,
  onEnd,
  typeLabel,
  captureMode,
}: {
  machine: LiveMachine;
  status: string;
  ls: LiveStrings;
  levelRef: (el: HTMLElement | null) => void;
  typing: boolean;
  onToggleTyping: () => void;
  onInterrupt: () => void;
  onEnd: () => void;
  typeLabel: string;
  captureMode?: string | null;
}) {
  const st = machine.state;
  const hearing = st === "LISTENING" || st === "USER_SPEAKING";
  const busy = st === "THINKING" || st === "RECONNECTING" || st === "CONNECTING";
  const speaking = st === "ASSISTANT_SPEAKING";
  const canInterrupt = speaking || st === "THINKING";
  return (
    <div data-testid="ai-live" data-state={st} data-capture={captureMode ?? ""}>
      <p role="status" aria-live="polite" className="min-h-6 text-center text-[0.9375rem] font-semibold text-stone-800" data-testid="ai-live-state" data-state={st}>
        <span className="me-2 inline-flex items-center rounded-full bg-emerald-600/10 px-2 py-0.5 align-middle text-[0.6875rem] font-bold uppercase tracking-wide text-emerald-800">{ls.liveBadge}</span>
        {status}
      </p>
      <div className="mt-3 flex items-center justify-center gap-4">
        <button type="button" onClick={onToggleTyping} aria-pressed={typing} data-testid="ai-text-toggle" className="inline-flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-stone-900/10">
          <Keyboard aria-hidden="true" className="size-5" />
          <span className="sr-only">{typeLabel}</span>
        </button>
        <div ref={levelRef} className="relative flex size-24 items-center justify-center" style={{ ["--level" as string]: 0 }} aria-hidden="true" data-testid="ai-orb">
          <span
            className={cn(
              "absolute inset-0 rounded-full opacity-30 transition-transform duration-75 motion-reduce:transition-none",
              hearing ? "bg-emerald-500" : speaking ? "bg-stone-900" : "bg-amber-500",
              busy && "motion-safe:animate-pulse",
            )}
            style={{ transform: hearing ? "scale(calc(0.8 + var(--level) * 0.45))" : "scale(0.85)" }}
          />
          <span className={cn("relative inline-flex size-[4.5rem] items-center justify-center gap-[3px] rounded-full text-white shadow-lg", hearing ? "bg-emerald-600" : speaking ? "bg-stone-900" : "bg-amber-600")}>
            {[0.55, 0.85, 1, 0.85, 0.55].map((k, i) => (
              <span
                key={i}
                className={cn("w-[3px] rounded-full bg-white/90 motion-reduce:!h-3", speaking && "motion-safe:animate-[pm-wave_900ms_ease-in-out_infinite]")}
                style={{ height: hearing ? `calc(6px + var(--level) * ${Math.round(22 * k)}px)` : speaking ? `${Math.round(8 + 10 * k)}px` : "6px", animationDelay: `${i * 110}ms` }}
              />
            ))}
          </span>
        </div>
        <button type="button" onClick={onEnd} data-testid="ai-live-end" className="inline-flex size-12 items-center justify-center rounded-full bg-red-600 text-white shadow">
          <PhoneOff aria-hidden="true" className="size-5" />
          <span className="sr-only">{ls.end}</span>
        </button>
      </div>
      <div className="mt-2 flex min-h-12 items-center justify-center gap-2">
        {canInterrupt ? (
          <button type="button" onClick={onInterrupt} data-testid="ai-live-interrupt" className="inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold ring-1 ring-stone-900/15">
            <Hand aria-hidden="true" className="size-4" />
            {ls.interrupt}
          </button>
        ) : (
          <p className="max-w-xs text-center text-xs text-stone-600">{ls.hint}</p>
        )}
      </div>
      <p className="sr-only">{ls.end}</p>
    </div>
  );
}

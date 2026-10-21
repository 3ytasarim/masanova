"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { VOICE, VOICE_SCRIPT } from "@/content/marketing/copy";
import { activeLocale, finalVoiceState, INITIAL_VOICE_STATE, nextVoiceState, PHASE_DURATION_MS, visibleMessages, type VoiceDemoState } from "@/lib/marketing/voice-demo";
import { cn } from "@/lib/utils/cn";
import { FoodPhoto, FOOD_PHOTOS, type FoodPhotoKey } from "@/components/marketing/food-photo";
import { Orb } from "@/components/marketing/phone";
import { useMotionAllowed } from "@/components/marketing/use-demo-loop";

/**
 * Sessiz, görsel sesli AI demosu (saf durum makinesi `lib/marketing/voice-demo.ts`). Mikrofon / ses / AI sağlayıcısı
 * BAŞLATILMAZ; ses çalınmaz. Görünür olunca BİR KEZ oynar (dil değişimi dahil) ve son karede durur; "yeniden oynat"
 * ile tekrar. Görünmüyorken durur; hareket azaltmada doğrudan son kare.
 */
export function VoiceDemo() {
  const motion = useMotionAllowed();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<VoiceDemoState>(INITIAL_VOICE_STATE);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!motion || !visible || state.phase === "done") return;
    const t = window.setTimeout(() => setState((s) => nextVoiceState(s, VOICE_SCRIPT)), PHASE_DURATION_MS[state.phase]);
    return () => window.clearTimeout(t);
  }, [motion, visible, state]);

  const shown = motion ? state : finalVoiceState(VOICE_SCRIPT);
  const messages = visibleMessages(shown, VOICE_SCRIPT);
  const locale = activeLocale(shown, VOICE_SCRIPT);
  const orbState = shown.phase === "listening" ? "listening" : shown.phase === "thinking" ? "thinking" : "idle";
  const status = shown.phase === "listening" ? (locale === "en" ? "Listening…" : "Dinliyorum…") : shown.phase === "thinking" ? (locale === "en" ? "Thinking…" : "Menüye bakıyorum…") : locale === "en" ? "Ready" : "Hazır";

  return (
    <div
      ref={ref}
      data-testid="voice-demo"
      data-phase={shown.phase}
      data-locale={locale}
      data-paused={!visible ? "" : undefined}
      className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,#1c1917,#0f0d0c)] p-5 shadow-2xl sm:p-7"
    >
      <p className="sr-only">{VOICE.demoLabel}</p>
      <div aria-hidden="true">
        <div className="flex items-center gap-3">
          <Orb state={orbState} size="md" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">MasaNova AI</p>
            <p className="text-xs text-fg-subtle" data-testid="voice-status">
              {status}
            </p>
          </div>
          <span data-testid="voice-locale" className="ml-auto rounded-full border border-white/15 px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors">
            {locale.toUpperCase()}
          </span>
        </div>
        <div className="mt-6 grid min-h-[300px] content-start gap-3 sm:min-h-[320px]">
          {messages.map((m, i) => (
            <div key={`${i}-${m.role}`} className={cn("grid gap-2 animate-rise-in", m.role === "user" ? "justify-items-end" : "justify-items-start")} lang={m.locale}>
              <p
                data-testid={m.role === "user" ? "voice-user" : "voice-reply"}
                className={cn("max-w-[86%] rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-snug", m.role === "user" ? "rounded-br-md bg-[#c2410c] text-white" : "rounded-bl-md bg-white/[0.08] text-fg")}
              >
                {m.text}
              </p>
              {m.cards ? (
                <div className="grid w-full gap-2 sm:grid-cols-2" data-testid="voice-cards">
                  {m.cards.map((c, ci) => (
                    <div key={c.name} className="flex items-center gap-3 rounded-2xl bg-white p-2.5 text-stone-900 animate-rise-in" style={{ animationDelay: `${ci * 140}ms` }}>
                      <span className="h-12 w-14 shrink-0 overflow-hidden rounded-xl">
                        <FoodPhoto photo={c.photo && c.photo in FOOD_PHOTOS ? (c.photo as FoodPhotoKey) : ci === 0 ? "adana" : "coban"} sizes="64px" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[0.8rem] font-semibold leading-tight">{c.name}</span>
                        <span className="mt-0.5 block text-xs text-stone-500">
                          {c.note} · <span className="font-semibold text-stone-900">{c.price}</span>
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {shown.phase === "thinking" ? (
            <span className="mk-typing inline-flex gap-1 rounded-2xl bg-white/[0.08] px-4 py-3">
              <span className="size-1.5 rounded-full bg-white" />
              <span className="size-1.5 rounded-full bg-white" />
              <span className="size-1.5 rounded-full bg-white" />
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
        <p className="text-xs text-fg-subtle">{VOICE.demoLabel}</p>
        {motion ? (
          <button
            type="button"
            onClick={() => setState(INITIAL_VOICE_STATE)}
            disabled={state.phase !== "done"}
            data-track="MARKETING_VOICE_DEMO"
            data-track-placement="replay"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-fg-muted hover:bg-white/10 hover:text-fg disabled:opacity-40"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {VOICE.replay}
          </button>
        ) : null}
      </div>
    </div>
  );
}

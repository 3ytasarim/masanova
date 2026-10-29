"use client";

import { Check, MicOff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CartLinePayload } from "@/lib/ai/types";
import { addLine, setQuantity, toSelections, type Cart } from "@/lib/orders/cart";
import { formatOrderNumber } from "@/lib/orders/status";
import { trackMenuEvent } from "@/lib/public-menu/events";
import { cn } from "@/lib/utils/cn";
import { RealtimeVoiceClient, type RealtimeState, type RealtimeTurnStats } from "@/lib/voice/realtime-webrtc";
import { AI_LANGUAGES, detectLanguage, type AiLanguage } from "@/lib/voice/language-detection";
import { submitOrderAction } from "@/server/actions/order.actions";
import { submitServiceRequestAction } from "@/server/actions/service-request.actions";
import type { CustomerServiceRequestView } from "@/server/services/service-requests/customer-request.service";

/**
 * Sesli garson — MENÜNÜN ÜZERİNDE, sürekli dinleme modunda (tam ekran / düğme / yazı yok).
 *
 * QR menü açılınca (AI paketi + ayar açıksa) kendiliğinden bağlanır: mikrofon izni (ilk seferde tarayıcı bir kez sorar)
 * → kısa ömürlü anahtar → WebRTC. Garson restoran adıyla karşılar ve müşteri menüye bakarken eller serbest konuşur.
 * Tarayıcı sayfada hiç etkileşim yokken ses çalmayı engellerse karşılama, müşterinin sayfaya İLK dokunuşunda / tuşunda
 * kendiliğinden başlar (özel bir düğme gerekmez). Ekranda yalnızca küçük bir durum göstergesi ve mikrofon kapatma vardır
 * (mikrofon açıkken bunun görünür olması gizlilik gereğidir).
 *
 * Sepet / sipariş / servis: model araç çağırır → sunucu doğrular → MEVCUT iş mantığı uygulanır (aynı sepet, aynı sipariş
 * eylemi → sipariş anında Sipariş Paneli / mutfağa düşer). Sipariş yalnızca özet okunup müşteri SESLİ onay verdikten sonra.
 * Maliyet: konuşma olmadan IDLE_MS geçerse bağlantı kapanır; müşteri göstergeye dokununca kaldığı yerden sürer.
 */
export type VoiceConciergeProps = {
  token: string;
  scope: string;
  uiLocale: string;
  restaurantName: string;
  brand: string;
  readCart: () => Cart | null;
  update: (fn: (current: Cart) => Cart | null) => void;
  recentOrders: string[];
  remember: (order: { publicId: string; number: string; at: number }) => void;
  onServiceResult: (request: CustomerServiceRequestView) => void;
  /** Gerçek zamanlı ses yoksa klasik asistana düş. */
  onFallback: () => void;
  /** Müşteri başka dilde konuşmaya başladı → menü o dile geçer (bağlantı kesilmeden). */
  onLanguage?: (language: AiLanguage) => void;
};

const PROOF_PREFIX = "mn_ai:";
/** Konuşmasız bu süre geçince bağlantı kapanır (ücretli oturum açık kalmaz). */
const IDLE_MS = 5 * 60 * 1000;

const STRINGS = {
  tr: {
    connecting: "Garson bağlanıyor…",
    listening: "Dinliyorum",
    user_speaking: "Dinliyorum…",
    thinking: "Bir saniye…",
    speaking: "Konuşuyor",
    closed: "Sesli garson beklemede",
    error: "Bağlantı kesildi",
    tapToHear: "Garsonu duymak için ekrana dokunun",
    resume: "Konuşmak için dokunun",
    mute: "Mikrofonu kapat",
    unmute: "Mikrofonu aç",
    micDenied: "Sesli garson için mikrofon izni verin",
    unavailable: "Sesli garson şu an kullanılamıyor",
    orderSent: (n: string) => `Sipariş ${n} mutfağa iletildi`,
    waiter: "Sesli garson",
  },
  en: {
    connecting: "Connecting your waiter…",
    listening: "Listening",
    user_speaking: "Listening…",
    thinking: "One moment…",
    speaking: "Speaking",
    closed: "Voice waiter paused",
    error: "Connection lost",
    tapToHear: "Tap anywhere to hear your waiter",
    resume: "Tap to talk",
    mute: "Mute microphone",
    unmute: "Unmute microphone",
    micDenied: "Allow microphone access for the voice waiter",
    unavailable: "Voice waiter unavailable right now",
    orderSent: (n: string) => `Order ${n} sent to the kitchen`,
    waiter: "Voice waiter",
  },
};

type Phase = "starting" | "live" | "await_gesture" | "paused" | "failed";

const newKey = (n = 16) => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const readProof = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeProof = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* gizli mod */
  }
};
const cartSignature = (cart: Cart | null) => JSON.stringify((cart?.lines ?? []).map((l) => [l.key, l.quantity]));
const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

export default function VoiceConcierge(props: VoiceConciergeProps) {
  const { token, scope } = props;
  const s = props.uiLocale === "tr" ? STRINGS.tr : STRINGS.en;
  // Bağlantı kodu metinleri ref üzerinden okur: menü dili değişince (tr → en) oturum yeniden başlamasın.
  const sRef = useRef(s);

  const [phase, setPhase] = useState<Phase>("starting");
  const [state, setState] = useState<RealtimeState>("connecting");
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [orderBanner, setOrderBanner] = useState<string | null>(null);
  const client = useRef<RealtimeVoiceClient | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const proofKey = `${PROOF_PREFIX}${scope}`;
  const reviewed = useRef<string | null>(null);
  const orderKey = useRef<string | null>(null);
  const greeted = useRef(false);
  /** Son konuşmalar (yeniden bağlanınca modele hatırlatılır). */
  const recentTurns = useRef<string[]>([]);
  const phaseRef = useRef<Phase>("starting");
  const activeWhenHidden = useRef(false);
  const greeting = useRef("");
  const idleTimer = useRef(0);
  const starting = useRef(false);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
    sRef.current = props.uiLocale === "tr" ? STRINGS.tr : STRINGS.en;
  });

  const headers = useCallback(() => {
    const proof = readProof(proofKey);
    return { "Content-Type": "application/json", ...(proof ? { "x-mn-ai-proof": proof } : {}) };
  }, [proofKey]);

  const stop = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    client.current?.close();
    client.current = null;
  }, []);

  const armIdle = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      stop();
      setPhase("paused");
    }, IDLE_MS);
  }, [stop]);

  // ── Araçların etkisi (mevcut sepet / sipariş / servis mantığı) ──
  // Konuşma dili → menü dili. Açık geçiş ("speak English", "Sprichst du Deutsch?") ya da güvenli algılama; kararsızsa
  // değiştirilmez (menü titremesin). Araç çağrısındaki lang alanı modelin bildirdiği dildir.
  const followLanguage = useCallback((language: AiLanguage | null) => {
    const p = propsRef.current;
    if (language && language !== p.uiLocale) p.onLanguage?.(language);
  }, []);
  const followText = useCallback(
    (text: string) => {
      const current = ((AI_LANGUAGES as readonly string[]).includes(propsRef.current.uiLocale) ? propsRef.current.uiLocale : "tr") as AiLanguage;
      const d = detectLanguage(text, current);
      if (d.explicitSwitch || (!d.uncertain && d.confidence >= 0.75)) followLanguage(d.language);
    },
    [followLanguage],
  );

  const applyTool = useCallback(
    async (name: string, args: unknown): Promise<Record<string, unknown>> => {
      const p = propsRef.current;
      const lang = args && typeof args === "object" ? (args as { lang?: unknown }).lang : undefined;
      if (typeof lang === "string" && (AI_LANGUAGES as readonly string[]).includes(lang)) followLanguage(lang as AiLanguage);
      const cart = p.readCart();
      const heard = name === "addToCart" ? await client.current?.heard() : undefined;
      const res = await fetch(`/t/${token}/asistan/arac`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          name,
          args,
          cart: (cart?.lines ?? []).map((l) => ({ key: l.key, selection: { product: l.product, variant: l.variant, modifiers: l.modifiers, quantity: l.quantity, note: l.note } })),
          recentOrders: p.recentOrders,
          heard: heard ? heard.slice(0, 1500) : undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok: boolean; output?: Record<string, unknown>; effect?: { kind: string; line?: CartLinePayload; product?: string; quantity?: number; type?: "WAITER" | "WATER" | "NAPKIN" | "BILL" } | null } | null;
      if (!data?.ok || !data.output) return { ok: false, error: "unavailable" };
      const effect = data.effect;
      if (!effect) return data.output;
      switch (effect.kind) {
        case "add": {
          const line = effect.line!;
          p.update((c) => addLine(c, line));
          trackMenuEvent({ type: "add_to_cart", product: line.product, quantity: line.quantity });
          reviewed.current = null;
          return data.output;
        }
        case "change": {
          const key = cart?.lines.find((l) => l.product === effect.product)?.key;
          if (key) p.update((c) => setQuantity(c, key, effect.quantity ?? 0));
          reviewed.current = null;
          return data.output;
        }
        case "review": {
          reviewed.current = cartSignature(p.readCart());
          orderKey.current = newKey();
          return data.output;
        }
        case "place": {
          const current = p.readCart();
          if (!current?.lines.length) return { ok: false, reason: "cart_empty" };
          // Özet okunduktan sonra sepet değiştiyse gönderme: önce yeni özet + onay.
          if (!reviewed.current || reviewed.current !== cartSignature(current)) return { ok: false, reason: "review_required", hint: "Önce reviewOrder çağır, özeti oku ve onay al." };
          orderKey.current ??= newKey();
          const r = await submitOrderAction(token, { items: toSelections(current), note: current.note || null, idempotencyKey: orderKey.current, locale: p.uiLocale, promotion: null });
          if (r.kind === "created" || r.kind === "duplicate") {
            const number = formatOrderNumber(r.order.orderNumber);
            p.remember({ publicId: r.order.publicId, number, at: Date.now() });
            p.update(() => null);
            reviewed.current = null;
            orderKey.current = null;
            trackMenuEvent({ type: "order_submitted", items: r.order.itemCount, duplicate: r.kind === "duplicate" });
            setOrderBanner(sRef.current.orderSent(number));
            window.setTimeout(() => setOrderBanner(null), 6000);
            return { ok: true, orderNumber: number, itemCount: r.order.itemCount, table: r.order.tableName, status: "sent_to_kitchen" };
          }
          if (r.kind === "reconcile") return { ok: false, reason: "prices_or_availability_changed", hint: "reviewOrder ile güncel özeti oku." };
          return { ok: false, reason: r.kind === "rejected" ? r.reason : "failed" };
        }
        case "service": {
          const r = await submitServiceRequestAction(token, { type: effect.type!, note: null, recentOrders: p.recentOrders });
          if (r.kind === "created" || r.kind === "duplicate") {
            p.onServiceResult(r.request);
            return { ok: true, type: effect.type, alreadyRequested: r.kind === "duplicate" };
          }
          return { ok: false, reason: "failed" };
        }
      }
      return data.output;
    },
    [token, headers, followLanguage],
  );

  const recordTurn = useCallback(
    (stats: RealtimeTurnStats) => {
      armIdle();
      if (!stats.userText && !stats.reply) return;
      // Garson müşterinin dilinde yanıt verir → yanıtın dili de sinyaldir.
      if (stats.reply) followText(stats.reply);
      recentTurns.current = [...recentTurns.current, `Müşteri: ${stats.userText || "…"}\nGarson: ${stats.reply || "…"}`].slice(-6);
      void fetch(`/t/${token}/asistan/kayit`, { method: "POST", headers: headers(), body: JSON.stringify({ turnKey: newKey(), ...stats, userText: stats.userText.slice(0, 2000), reply: stats.reply.slice(0, 4000) }), keepalive: true }).catch(() => undefined);
    },
    [token, headers, armIdle, followText],
  );

  /** Ses çalınabiliyorsa karşıla; tarayıcı engellediyse ilk dokunuşu bekle (özel düğme yok — sayfanın herhangi bir yeri). */
  const playAndGreet = useCallback(() => {
    const el = audioEl.current;
    if (!el) return;
    const greet = () => {
      setPhase("live");
      if (greeted.current) return;
      greeted.current = true;
      client.current?.greet(greeting.current);
    };
    el.play()
      .then(greet)
      .catch(() => {
        setPhase("await_gesture");
        const unlock = () => {
          GESTURES.forEach((g) => document.removeEventListener(g, unlock, true));
          el.play().then(greet).catch(() => setPhase("await_gesture"));
        };
        GESTURES.forEach((g) => document.addEventListener(g, unlock, { capture: true, passive: true }));
      });
  }, []);

  const start = useCallback(async () => {
    if (starting.current || client.current) return;
    starting.current = true;
    let mic: MediaStream | null = null;
    try {
      mic = await RealtimeVoiceClient.requestMicrophone();
      const res = await fetch(`/t/${token}/asistan/ses-oturum`, { method: "POST", headers: headers(), body: JSON.stringify({ uiLocale: propsRef.current.uiLocale }) });
      const data = (await res.json().catch(() => null)) as { ok: boolean; error?: string; clientSecret?: string; greeting?: string; proof?: string | null } | null;
      if (!data?.ok || !data.clientSecret) {
        mic.getTracks().forEach((t) => t.stop());
        if (data?.error === "provider_unavailable") return propsRef.current.onFallback();
        setNotice(sRef.current.unavailable);
        setPhase("failed");
        return;
      }
      if (data.proof) writeProof(proofKey, data.proof);
      greeting.current = data.greeting ?? "";
      const c = new RealtimeVoiceClient({
        onState: (next) => {
          setState(next);
          if (next === "user_speaking") armIdle();
        },
        onToolCall: applyTool,
        onTurn: recordTurn,
        onTranscript: followText,
        onError: (code) => {
          if (code === "connection_lost") {
            stop();
            setNotice(sRef.current.error);
            setPhase("paused");
          }
        },
      });
      client.current = c;
      c.attachAudio(audioEl.current!);
      await c.connect({ clientSecret: data.clientSecret, mic });
      // Veri kanalı açık: ses çalınabiliyorsa hemen karşıla, değilse ilk dokunuşta.
      // Kilit / arka plan sonrası yeniden bağlanma: karşılama yok, model kaldığı yerden sürdürür.
      if (greeted.current) c.restoreContext(recentTurns.current.join("\n"));
      playAndGreet();
      armIdle();
    } catch (error) {
      mic?.getTracks().forEach((t) => t.stop());
      stop();
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setNotice(denied ? sRef.current.micDenied : sRef.current.unavailable);
      setPhase("failed");
    } finally {
      starting.current = false;
    }
  }, [token, headers, proofKey, applyTool, recordTurn, followText, playAndGreet, armIdle, stop]);

  // Menü açılınca kendiliğinden başla; sayfadan çıkınca mikrofon ve bağlantı kapanır.
  useEffect(() => {
    const boot = window.setTimeout(() => void start(), 0);
    const onHide = () => stop();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearTimeout(boot);
      window.removeEventListener("pagehide", onHide);
      stop();
    };
  }, [start, stop]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Konuşma sürerken ekran kendiliğinden kararıp kilitlenmesin (Screen Wake Lock; desteklemeyen tarayıcıda sessizce yok).
  useEffect(() => {
    if (phase !== "live" || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible" || lock) return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (cancelled) return void l.release().catch(() => undefined);
          lock = l;
          l.addEventListener("release", () => {
            if (lock === l) lock = null;
          });
        })
        .catch(() => undefined);
    };
    acquire();
    // Kilit sayfa gizlenince tarayıcı tarafından bırakılır → geri gelince yeniden al.
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => undefined);
      lock = null;
    };
  }, [phase]);

  const resume = () => {
    greeted.current = true; // kaldığı yerden: yeniden karşılama yok
    setNotice(null);
    setPhase("starting");
    setState("connecting");
    void start();
  };

  // Telefon kilitlenip açıldı / uygulamadan dönüldü: bağlantı ya da mikrofon düştüyse sessizce yeniden bağlan
  // (baştan konuşmak gerekmez; önceki konuşma modele hatırlatılır).
  const resumeRef = useRef(resume);
  useEffect(() => {
    resumeRef.current = resume;
  });
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        activeWhenHidden.current = phaseRef.current === "live";
        return;
      }
      if (!activeWhenHidden.current) return;
      activeWhenHidden.current = false;
      const current = phaseRef.current;
      const broken = current === "paused" || current === "failed" || (current === "live" && !(client.current?.healthy ?? false));
      if (!broken) return;
      stop();
      resumeRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stop]);

  const live = phase === "live";
  const label =
    phase === "await_gesture" ? s.tapToHear : phase === "paused" ? (notice ?? s.resume) : phase === "failed" ? (notice ?? s.unavailable) : phase === "starting" ? s.connecting : muted ? s.unmute : s[state];
  const short = SHORT[props.uiLocale === "tr" ? "tr" : "en"];
  const shortLabel =
    phase === "await_gesture" ? short.tap : phase === "paused" ? short.start : phase === "failed" ? short.retry : phase === "starting" ? short.connecting : muted ? short.muted : state === "speaking" ? short.speaking : state === "thinking" ? short.thinking : short.listening;
  const speaking = live && state === "speaking";
  const hearing = live && state === "user_speaking";
  const onTap = () => {
    if (phase === "paused" || phase === "failed") return resume();
    if (!live) return;
    const next = !muted;
    client.current?.setMuted(next);
    setMuted(next);
  };

  return (
    <>
      <style>{`
        @keyframes vc-bar { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
        @keyframes vc-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--vc-brand) 55%, transparent) } 100% { box-shadow: 0 0 0 14px transparent } }
        @media (prefers-reduced-motion: reduce) { .vc-anim { animation: none !important } }
      `}</style>
      {orderBanner ? (
        <p role="status" data-testid="voice-order-sent" className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-fit items-center gap-2 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
          <Check aria-hidden="true" className="size-4" /> {orderBanner}
        </p>
      ) : null}
      {/* Alt sekme çubuğunun ortasındaki yükseltilmiş düğme: durum (dinliyor / konuşuyor) + dokununca mikrofon aç / kapat. */}
      <button
        type="button"
        onClick={onTap}
        aria-label={`${props.restaurantName} · ${s.waiter}: ${label}`}
        aria-pressed={live ? !muted : undefined}
        data-testid="voice-concierge"
        className="group relative flex min-h-[3.75rem] flex-1 flex-col items-center justify-end gap-1 pb-1 text-[0.6875rem] font-semibold focus-visible:outline-none"
        style={{ ["--vc-brand" as string]: props.brand }}
      >
        <span
          aria-hidden="true"
          className={cn(
            "vc-anim -mt-7 grid size-14 place-items-center rounded-full text-white shadow-[0_10px_24px_-8px_rgb(0_0_0/0.45)] ring-4 ring-white transition-colors group-focus-visible:ring-[var(--pm-accent)]",
            muted || phase === "failed" || phase === "paused" ? "bg-stone-500" : "bg-[var(--vc-brand)]",
            (hearing || phase === "await_gesture") && "[animation:vc-pulse_1.4s_ease-out_infinite]",
          )}
        >
          {phase === "paused" || phase === "failed" ? (
            <RotateCcw className="size-5" />
          ) : muted ? (
            <MicOff className="size-5" />
          ) : (
            <span className="flex h-5 items-center gap-[3px]">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn("vc-anim block h-full w-[3px] origin-center rounded-full bg-white", speaking || hearing ? "[animation:vc-bar_0.9s_ease-in-out_infinite]" : state === "thinking" && live ? "[animation:vc-bar_1.6s_ease-in-out_infinite] opacity-80" : "scale-y-[0.35] opacity-80")}
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </span>
          )}
        </span>
        <span data-testid="voice-concierge-status" className={cn("max-w-full truncate", muted || !live ? "text-stone-500" : "text-[var(--pm-accent)]")}>
          {shortLabel}
        </span>
        <span className="sr-only">{label}</span>
      </button>
      {/* Model sesi (WebRTC uzak iz) */}
      <audio ref={audioEl} playsInline className="hidden" />
    </>
  );
}

const SHORT = {
  tr: { connecting: "Bağlanıyor", listening: "Dinliyor", thinking: "Düşünüyor", speaking: "Konuşuyor", muted: "Sessiz", tap: "Dokunun", start: "Garson", retry: "Tekrar dene" },
  en: { connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Speaking", muted: "Muted", tap: "Tap", start: "Waiter", retry: "Retry" },
};

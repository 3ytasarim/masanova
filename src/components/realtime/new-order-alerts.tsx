"use client";

import { BellRing, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RealtimeEnvelope } from "@/lib/realtime/events";
import { formatOrderNumber } from "@/lib/orders/status";
import { cn } from "@/lib/utils/cn";
import { useRealtimeStream } from "@/hooks/use-realtime-stream";
import { PANEL_EVENTS_URL } from "@/components/realtime/live-refresh";

/**
 * Yeni sipariş bildirimi — panelin HER sayfasında (sipariş görme yetkisi olanlara). Sipariş anında (SSE olayı, gecikme
 * yok): belirgin çan sesi + "Masa 5 · Yeni sipariş #1004" kartı (siparişe bağlantı) + sekme başlığında sayaç; sekme
 * arka plandaysa tarayıcı bildirimi (izin verildiyse). Ses Web Audio ile üretilir (dosya yok).
 *
 * Tarayıcılar sayfayla hiç etkileşim olmadan ses çalmaya izin vermez: ilk tıklamada ses kilidi açılır; o ana kadar
 * gelen siparişte kart "sesi açmak için dokunun" der. Ses tercihi bu cihazda hatırlanır.
 */
type Alert = { id: string; orderId: string; number: string; tableName: string | null; itemCount: number | null; at: number };

const MUTE_KEY = "mn_order_alert_muted";
const MUTE_EVENT = "mn-order-alert-muted";
const AUTO_DISMISS_MS = 45_000;

const subscribeMute = (cb: () => void) => {
  window.addEventListener(MUTE_EVENT, cb);
  return () => window.removeEventListener(MUTE_EVENT, cb);
};
const readMuted = () => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};

/** İki tonlu belirgin çan (mutfak gürültüsünde duyulsun), ~1,2 sn. */
function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const tones: [number, number][] = [
    [880, 0],
    [1318.5, 0.18],
    [880, 0.55],
    [1318.5, 0.73],
  ];
  for (const [freq, start] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.6, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.45);
    osc.connect(gain).connect(master);
    osc.start(now + start);
    osc.stop(now + start + 0.5);
  }
}

export function NewOrderAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [locked, setLocked] = useState(false);
  // Bağlantı ilk etkileşimde kurulur: tarayıcı o ana kadar ses çaldırmaz; ayrıca açık kalan bağlantı sayfa yüklemesini
  // "bitmemiş" gösterir. Panel düzeni sayfalar arasında korunduğundan bir kez dokunmak yeter (yenilemeye kadar).
  const [armed, setArmed] = useState(false);
  const muted = useSyncExternalStore(subscribeMute, readMuted, () => false);
  const ctxRef = useRef<AudioContext | null>(null);
  const baseTitle = useRef<string | null>(null);

  const audio = () => {
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return null;
      }
    }
    return ctxRef.current;
  };

  // İlk etkileşimde ses kilidini aç (tarayıcı politikası).
  useEffect(() => {
    const unlock = () => {
      setArmed(true);
      const ctx = audio();
      void ctx?.resume().then(() => setLocked(false));
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      void ctxRef.current?.close().catch(() => undefined);
    };
  }, []);

  // Sekme başlığında bekleyen sipariş sayısı.
  useEffect(() => {
    baseTitle.current ??= document.title.replace(/^\(\d+\)\s*/, "");
    document.title = alerts.length ? `(${alerts.length}) Yeni sipariş · ${baseTitle.current}` : baseTitle.current;
  }, [alerts.length]);

  // Kendiliğinden kapanma.
  useEffect(() => {
    if (!alerts.length) return;
    const oldest = Math.min(...alerts.map((a) => a.at));
    const id = window.setTimeout(() => setAlerts((list) => list.filter((a) => Date.now() - a.at < AUTO_DISMISS_MS)), Math.max(1000, oldest + AUTO_DISMISS_MS - Date.now()));
    return () => window.clearTimeout(id);
  }, [alerts]);

  useRealtimeStream(armed ? PANEL_EVENTS_URL : null, {
    onEvent: (event: RealtimeEnvelope) => {
      if (event.type !== "ORDER_SUBMITTED" || !("orderId" in event.data)) return;
      const data = event.data as { orderId: string; orderNumber: number; tableName?: string; itemCount?: number };
      const number = formatOrderNumber(data.orderNumber);
      setAlerts((list) => (list.some((a) => a.orderId === data.orderId) ? list : [{ id: `${data.orderId}-${Date.now()}`, orderId: data.orderId, number, tableName: data.tableName ?? null, itemCount: data.itemCount ?? null, at: Date.now() }, ...list].slice(0, 5)));
      if (!muted) {
        const ctx = audio();
        if (ctx && ctx.state === "running") chime(ctx);
        else if (ctx)
          void ctx
            .resume()
            .then(() => (ctx.state === "running" ? chime(ctx) : setLocked(true)))
            .catch(() => setLocked(true));
      }
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(`${data.tableName ?? "Masa"} · Yeni sipariş ${number}`, { body: data.itemCount ? `${data.itemCount} ürün` : undefined, tag: data.orderId });
        } catch {
          /* bazı tarayıcılarda yalnızca service worker */
        }
      }
    },
  });

  return (
    <div className="pointer-events-none fixed end-4 top-20 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col items-end gap-2" aria-live="assertive">
      {alerts.map((a) => (
        <div key={a.id} role="alert" data-testid="new-order-alert" className="pointer-events-auto flex w-full items-start gap-3 rounded-2xl bg-emerald-600 p-4 text-white shadow-2xl ring-1 ring-emerald-400/40 motion-safe:animate-[pm-sheet-in_240ms_cubic-bezier(0.16,1,0.3,1)]">
          <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/20 motion-safe:animate-pulse">
            <BellRing className="size-5" />
          </span>
          <Link href={`/panel/siparisler/${a.orderId}`} onClick={() => setAlerts((l) => l.filter((x) => x.id !== a.id))} className="min-w-0 flex-1 focus-visible:outline-none">
            <p className="text-lg font-bold leading-tight">{a.tableName ?? "Masa"} · Yeni sipariş</p>
            <p className="mt-0.5 text-sm text-emerald-50">
              {a.number}
              {a.itemCount ? ` · ${a.itemCount} ürün` : ""} · Görüntüle →
            </p>
            {locked ? <p className="mt-1 text-xs font-semibold text-amber-200">Sesli bildirim için ekrana bir kez dokunun.</p> : null}
          </Link>
          <button type="button" onClick={() => setAlerts((l) => l.filter((x) => x.id !== a.id))} aria-label="Bildirimi kapat" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-white/15">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Yeni sipariş sesi aç / kapat — Siparişler sayfasının başlığında (panel genelinde sabit düğme yok). Tercih bu cihazda
 * saklanır; açarken kısa bir deneme çanı çalar ve (ilk kez) tarayıcı bildirimi izni istenir.
 */
export function OrderSoundToggle() {
  const muted = useSyncExternalStore(subscribeMute, readMuted, () => false);
  const toggle = () => {
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "0" : "1");
    } catch {
      /* gizli mod */
    }
    window.dispatchEvent(new Event(MUTE_EVENT));
    if (muted) {
      try {
        const ctx = new AudioContext();
        chime(ctx);
        window.setTimeout(() => void ctx.close().catch(() => undefined), 1500);
      } catch {
        /* ses yok */
      }
    }
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!muted}
      data-testid="order-sound-toggle"
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1", muted ? "bg-surface text-fg-subtle ring-border" : "bg-success-soft text-success ring-transparent")}
    >
      {muted ? <VolumeX aria-hidden="true" className="size-3.5" /> : <Volume2 aria-hidden="true" className="size-3.5" />}
      {muted ? "Sipariş sesi kapalı" : "Sipariş sesi açık"}
    </button>
  );
}

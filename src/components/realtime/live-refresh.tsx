"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { RealtimeEnvelope } from "@/lib/realtime/events";
import { cn } from "@/lib/utils/cn";
import { useRealtimeStream, type StreamState } from "@/hooks/use-realtime-stream";

export const PANEL_EVENTS_URL = "/panel/olaylar";

/**
 * Panel sayfalarını canlı tutar: olay geldiğinde (ya da yeniden bağlanınca) sunucu bileşenleri yeniden çekilir
 * (router.refresh — yetki ve veri her seferinde sunucuda). Art arda olaylar 250 ms'de tek yenilemeye toplanır.
 * `filter` verilirse yalnızca ilgili olaylar yenileme tetikler (ör. tek sipariş sayfası).
 */
export function LiveRefresh({ orderId, showIndicator = true }: { orderId?: string; showIndicator?: boolean }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 250);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const state = useRealtimeStream(PANEL_EVENTS_URL, {
    onEvent: (event: RealtimeEnvelope) => {
      // Servis talepleri ayrı panoda (/panel/servis); sipariş ekranlarını yenilemez.
      if (event.type.startsWith("SERVICE_REQUEST_")) return;
      if (orderId && "orderId" in event.data && event.data.orderId !== orderId) return;
      schedule();
    },
    onReconnect: schedule,
  });

  return showIndicator ? <ConnectionIndicator state={state} /> : null;
}

export function ConnectionIndicator({ state, className }: { state: StreamState; className?: string }) {
  const label = state === "live" ? "Canlı" : state === "connecting" ? "Bağlanıyor…" : "Bağlantı yeniden kuruluyor";
  return (
    <span role="status" aria-live="polite" data-testid="live-indicator" data-state={state} className={cn("inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium", state === "live" ? "bg-success-soft text-success" : "bg-warning-soft text-warning", className)}>
      <span aria-hidden="true" className={cn("size-2 rounded-full", state === "live" ? "bg-success" : "animate-pulse bg-warning")} />
      {label}
    </span>
  );
}

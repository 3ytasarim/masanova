"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { parseEnvelope, REALTIME_EVENT_TYPES, reconnectDelay, type RealtimeEnvelope } from "@/lib/realtime/events";

export type StreamState = "connecting" | "live" | "reconnecting";

/**
 * SSE aboneliği (EventSource) — tarayıcının kendi yeniden bağlanması yerine denetimli üstel geri çekilme kullanılır
 * (1 sn → 30 sn, rastgele sapmalı; sunucu dövülmez). Her (yeniden) bağlantıda `onReconnect` çağrılır: kaçırılan
 * olaylar yeniden oynatılmaz, istemci yetkili durumu sunucudan yeniden çeker. Bileşen kaldırılınca bağlantı ve
 * zamanlayıcılar kapatılır (sızıntı yok). Sekme gizliyken bağlantı açık kalır (KDS arka planda da güncellenmeli).
 */
export function useRealtimeStream(url: string | null, handlers: { onEvent?: (event: RealtimeEnvelope) => void; onReconnect?: () => void }): StreamState {
  const [state, setState] = useState<StreamState>("connecting");
  const onEvent = useEffectEvent((event: RealtimeEnvelope) => handlers.onEvent?.(event));
  const onReconnect = useEffectEvent(() => handlers.onReconnect?.());

  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let everOpened = false;
    let disposed = false;

    const handleMessage = (message: MessageEvent<string>) => {
      const event = parseEnvelope(message.data);
      if (event) onEvent(event);
    };

    const connect = () => {
      if (disposed) return;
      source = new EventSource(url);
      source.onopen = () => {
        attempt = 0;
        setState("live");
        // İlk bağlantıda sayfa zaten güncel; yeniden bağlanınca aradaki değişiklikleri çek.
        if (everOpened) onReconnect();
        everOpened = true;
      };
      source.onmessage = handleMessage;
      for (const type of REALTIME_EVENT_TYPES) {
        source.addEventListener(type, handleMessage as EventListener);
      }
      source.onerror = () => {
        source?.close();
        source = null;
        if (disposed) return;
        setState("reconnecting");
        timer = setTimeout(connect, reconnectDelay(attempt++));
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [url]);

  return state;
}

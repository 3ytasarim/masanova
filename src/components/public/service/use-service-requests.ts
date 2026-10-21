"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listServiceRequestsAction } from "@/server/actions/service-request.actions";
import type { CustomerServiceRequestView } from "@/server/services/service-requests/customer-request.service";
import { useRealtimeStream, type StreamState } from "@/hooks/use-realtime-stream";

const FALLBACK_REFRESH_MS = 30_000;

/**
 * Masanın servis talepleri (müşteri). Başlangıç durumu sunucudan (sayfa) gelir; değişiklikler masa akışıyla
 * (/t/<token>/akis) "sinyal" olarak alınır ve yetkili durum sunucudan yeniden çekilir. Akış YALNIZCA aktif talep
 * varken açıktır (talep başına ayrı bağlantı yok; aktif talep kalmayınca kapanır). Bağlantı yokken 30 sn yedek yenileme.
 */
export function useServiceRequests(token: string, initial: CustomerServiceRequestView[]) {
  const [requests, setRequests] = useState(initial);
  const hasActive = requests.some((r) => r.status === "OPEN" || r.status === "ACKNOWLEDGED");
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (!token || inflight.current) return;
    inflight.current = true;
    try {
      const res = await listServiceRequestsAction(token);
      if (res.kind === "ok") setRequests(res.requests);
    } catch {
      /* çevrimdışı: bir sonraki olay / yedek yenileme */
    } finally {
      inflight.current = false;
    }
  }, [token]);

  const state: StreamState = useRealtimeStream(token && hasActive ? `/t/${token}/akis` : null, { onEvent: () => void refresh(), onReconnect: () => void refresh() });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!token || !hasActive) return;
    const id = setInterval(() => {
      if (stateRef.current !== "live" && document.visibilityState === "visible") void refresh();
    }, FALLBACK_REFRESH_MS);
    return () => clearInterval(id);
  }, [token, hasActive, refresh]);

  /** Gönderim sonucu gibi yerel bilgi: listeyi hemen güncelle (sunucudan gelen görünümle). */
  const upsert = useCallback((request: CustomerServiceRequestView) => {
    setRequests((list) => [request, ...list.filter((r) => r.publicId !== request.publicId)]);
  }, []);

  return { requests, hasActive, streamState: hasActive ? state : "live", refresh, upsert };
}

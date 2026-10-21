"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { OrderStatus } from "@prisma/client";
import { useRealtimeStream } from "@/hooks/use-realtime-stream";

const TERMINAL: readonly OrderStatus[] = ["SERVED", "REJECTED", "CANCELLED"];
const FALLBACK_REFRESH_MS = 30_000;

/**
 * Müşteri sipariş sayfası canlı durumu. Olay yalnızca "durum değişti" sinyalidir: sayfa sunucudan yeniden çekilir
 * (erişim kuralı her seferinde sunucuda: QR bağlamı + aynı masa + 24 saat). Bağlantı koptuğunda üstel geri çekilmeyle
 * yeniden bağlanılır; bağlantı yokken 30 sn'de bir yedek yenileme yapılır. Terminal durumda akış açılmaz.
 * Gösterge yalnızca kesinti 3 sn'yi aşarsa görünür (kısa kesintilerde yanıp sönmez).
 */
export function OrderLiveStatus({ streamUrl, status, reconnectingLabel }: { streamUrl: string; status: OrderStatus; reconnectingLabel: string }) {
  const router = useRouter();
  const terminal = TERMINAL.includes(status);
  const state = useRealtimeStream(terminal ? null : streamUrl, {
    onEvent: () => router.refresh(),
    onReconnect: () => router.refresh(),
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Yedek: bağlantı canlı değilken periyodik yenileme (vekil SSE'yi engelliyorsa da durum ilerler).
  useEffect(() => {
    if (terminal) return;
    const id = setInterval(() => {
      if (stateRef.current !== "live" && document.visibilityState === "visible") router.refresh();
    }, FALLBACK_REFRESH_MS);
    return () => clearInterval(id);
  }, [terminal, router]);

  if (terminal || state !== "reconnecting") return null;
  return (
    <p role="status" className="mn-delayed-show mt-3 inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-stone-600 ring-1 ring-stone-200" data-testid="public-live-reconnecting">
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-amber-500" />
      {reconnectingLabel}
    </p>
  );
}

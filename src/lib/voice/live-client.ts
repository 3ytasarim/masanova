import { NdjsonDecoder, type LiveErrorCode, type LiveTurnEvent } from "@/lib/ai/realtime";

/**
 * Canlı tur isteği (istemci): NDJSON akışını okur, olayları sırayla iletir ve turun nasıl bittiğini döner.
 *  - "done"    → tur tamamlandı
 *  - "error"   → sunucu hata kodu verdi (yeniden denenebilir mi?)
 *  - "lost"    → akış "done" gelmeden koptu (ağ) → AYNI tur anahtarıyla yeniden bağlanılır
 *  - "aborted" → istemci iptal etti (araya girme / kapatma)
 */
export type LiveOutcome = { kind: "done" } | { kind: "error"; code: LiveErrorCode; retryable: boolean } | { kind: "lost" } | { kind: "aborted" };

export function newTurnKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const HTTP_CODES: Record<number, LiveErrorCode> = { 400: "too_long", 401: "conversation_invalid", 403: "feature_disabled", 404: "context_invalid", 413: "audio_too_long", 429: "rate_limited" };

export async function streamLiveTurn(input: { url: string; proof: string; body: unknown; signal: AbortSignal; onEvent: (e: LiveTurnEvent) => void }): Promise<LiveOutcome> {
  let res: Response;
  try {
    res = await fetch(input.url, { method: "POST", headers: { "Content-Type": "application/json", "x-mn-ai-proof": input.proof }, body: JSON.stringify(input.body), signal: input.signal });
  } catch {
    return input.signal.aborted ? { kind: "aborted" } : { kind: "lost" };
  }
  // Vekil arkasında arka uç yeniden başlıyor / kapalı (Nginx 502-504) → geçici: aynı tur anahtarıyla yeniden bağlan.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: "lost" };
  }
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as { error?: LiveErrorCode } | null;
    const code = json?.error ?? HTTP_CODES[res.status] ?? "ai_failed";
    return { kind: "error", code, retryable: res.status >= 500 || code === "rate_limited" };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const ndjson = new NdjsonDecoder();
  let outcome: LiveOutcome | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const event of ndjson.push(decoder.decode(value, { stream: true }))) {
        if (input.signal.aborted) return { kind: "aborted" };
        input.onEvent(event);
        if (event.t === "done") outcome = { kind: "done" };
        if (event.t === "error") outcome = { kind: "error", code: event.code, retryable: event.retryable };
      }
    }
  } catch {
    if (input.signal.aborted) return { kind: "aborted" };
    return outcome ?? { kind: "lost" };
  }
  if (input.signal.aborted) return { kind: "aborted" };
  return outcome ?? { kind: "lost" };
}

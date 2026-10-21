import { BODY_LIMITS, readJsonBody } from "@/lib/security/body";
import { MAX_AUDIO_BYTES } from "@/lib/voice/session";
import { runLiveTurn } from "@/server/services/ai/realtime.service";
import { clientIp, decodeAudio, json, JSON_AUDIO_BODY_MAX, livePayloadSchema, noStore, PROOF_HEADER, tableContext } from "@/server/services/ai/http";

/**
 * Canlı sesli tur — POST /t/<token>/asistan/canli. Gövde: JSON { turnKey, audio{data(base64), mime, durationMs}? | text,
 * muted, cart, recentOrders }; kanıt başlıkta. Yanıt: NDJSON olay akışı (src/lib/ai/realtime.ts). Sağlayıcı anahtarı ya da
 * sağlayıcı bağlantısı tarayıcıya hiç verilmez — tüm sağlayıcı çağrıları ve araçlar sunucuda çalışır.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function POST(request: Request, { params }: Params) {
  const ctx = await tableContext((await params).token);
  if (!ctx) return json({ ok: false, error: "context_invalid" }, 404);
  const body = await readJsonBody(request, Math.min(JSON_AUDIO_BODY_MAX, BODY_LIMITS.audioJson));
  if (!body.ok) return body.error === "too_large" ? json({ ok: false, error: "audio_too_long" }, 413) : json({ ok: false, error: "too_long" }, 400);
  const parsed = livePayloadSchema.safeParse(body.value);
  if (!parsed.success) return json({ ok: false, error: "too_long" }, 400);
  const audio = decodeAudio(parsed.data.audio);
  if (audio && audio.bytes.byteLength > MAX_AUDIO_BYTES) return json({ ok: false, error: "audio_too_long" }, 413);
  if (!audio && !parsed.data.text) return json({ ok: false, error: "too_long" }, 400);

  const stream = runLiveTurn(
    ctx,
    {
      proof: request.headers.get(PROOF_HEADER),
      ip: clientIp(request),
      text: parsed.data.text ?? null,
      audio,
      cart: parsed.data.cart,
      recentOrders: parsed.data.recentOrders,
      turnKey: parsed.data.turnKey,
      muted: parsed.data.muted,
    },
    request.signal,
  );
  return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no", ...noStore } });
}

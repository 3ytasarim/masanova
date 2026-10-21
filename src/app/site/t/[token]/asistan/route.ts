import { BODY_LIMITS, readJsonBody } from "@/lib/security/body";
import { MAX_AUDIO_BYTES } from "@/lib/voice/session";
import { runTurn, type TurnInput } from "@/server/services/ai/assistant.service";
import { clientIp, decodeAudio, json, JSON_AUDIO_BODY_MAX, PROOF_HEADER, tableContext, turnPayloadSchema } from "@/server/services/ai/http";

/**
 * Asistan turu — POST /t/<token>/asistan. Gövde: JSON (yazılı ya da base64 ses) veya multipart (payload + audio).
 * Canlı modun YEDEĞİDİR: aynı tur anahtarıyla gelirse tur ikinci kez işlenmez. Ses boyutu okunmadan
 * önce sınırlanır; ham ses bellekte STT'ye gider ve atılır. Masa / kiracı her istekte QR bağlamından; kanıt başlıkta.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

const STATUS: Record<string, number> = { context_invalid: 404, feature_disabled: 403, conversation_invalid: 401, rate_limited: 429, turn_limit: 429, too_long: 413, audio_too_long: 413, audio_invalid: 415 };

export async function POST(request: Request, { params }: Params) {
  const ctx = await tableContext((await params).token);
  if (!ctx) return json({ ok: false, error: "context_invalid" }, 404);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > Math.max(MAX_AUDIO_BYTES + 128 * 1024, JSON_AUDIO_BODY_MAX)) return json({ ok: false, error: "audio_too_long" }, 413);

  let payload: unknown = {};
  let audio: TurnInput["audio"] = null;
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("multipart/form-data")) {
      // Çok parçalı gövde akışla sınırlanamaz → uzunluk ZORUNLU ve üst sınırlı (yukarıda denetlendi).
      if (!request.headers.get("content-length")) return json({ ok: false, error: "too_long" }, 411);
      const form = await request.formData();
      payload = JSON.parse(String(form.get("payload") ?? "{}"));
      const file = form.get("audio");
      if (file instanceof File) {
        if (file.size > MAX_AUDIO_BYTES) return json({ ok: false, error: "audio_too_long" }, 413);
        audio = { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || "audio/webm", clientDurationMs: null };
      }
    } else {
      const body = await readJsonBody(request, BODY_LIMITS.audioJson);
      if (!body.ok) return body.error === "too_large" ? json({ ok: false, error: "audio_too_long" }, 413) : json({ ok: false, error: "too_long" }, 400);
      payload = body.value;
    }
  } catch {
    return json({ ok: false, error: "too_long" }, 400);
  }
  const parsed = turnPayloadSchema.safeParse(payload);
  if (!parsed.success) return json({ ok: false, error: "too_long" }, 400);
  if (audio) audio.clientDurationMs = parsed.data.clientDurationMs ?? null;
  else audio = decodeAudio(parsed.data.audio);
  if (audio && audio.bytes.byteLength > MAX_AUDIO_BYTES) return json({ ok: false, error: "audio_too_long" }, 413);
  if (!audio && !parsed.data.text) return json({ ok: false, error: "too_long" }, 400);

  const result = await runTurn(ctx, {
    proof: request.headers.get(PROOF_HEADER),
    ip: clientIp(request),
    text: parsed.data.text ?? null,
    audio,
    cart: parsed.data.cart,
    recentOrders: parsed.data.recentOrders,
    turnKey: parsed.data.turnKey ?? null,
  });
  return json(result, result.ok ? 200 : (STATUS[result.error] ?? 502));
}

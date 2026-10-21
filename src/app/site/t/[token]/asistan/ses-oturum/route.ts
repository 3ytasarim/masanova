import { z } from "zod";
import { BODY_LIMITS, readJsonBody } from "@/lib/security/body";
import { mintRealtimeSession } from "@/server/services/ai/realtime-voice.service";
import { clientIp, json, PROOF_HEADER, tableContext } from "@/server/services/ai/http";

/**
 * Sesten sese canlı garson oturumu — POST /t/<token>/asistan/ses-oturum. Geçerli QR bağlamı + paket / ayar / limit kapısı.
 * Yanıt: kısa ömürlü (60 sn) OpenAI istemci anahtarı + karşılama talimatı. Asıl API anahtarı hiçbir zaman dönmez.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function POST(request: Request, { params }: Params) {
  const ctx = await tableContext((await params).token);
  if (!ctx) return json({ ok: false, error: "context_invalid" }, 404);
  const body = z.object({ uiLocale: z.string().max(8).default("tr") }).safeParse((await readJsonBody(request, BODY_LIMITS.smallJson).then((b) => (b.ok ? b.value : null))) ?? {});
  const result = await mintRealtimeSession(ctx, { proof: request.headers.get(PROOF_HEADER), uiLocale: body.success ? body.data.uiLocale : "tr", ip: clientIp(request) });
  if (result.ok) return json(result);
  return json(result, result.error === "rate_limited" ? 429 : result.error === "feature_disabled" ? 403 : 503);
}

import { z } from "zod";
import { BODY_LIMITS, readJsonBody } from "@/lib/security/body";
import { startOrResumeSession } from "@/server/services/ai/assistant.service";
import { getRealtimeProvider } from "@/server/services/ai/realtime/provider";
import { clientIp, json, PROOF_HEADER, tableContext } from "@/server/services/ai/http";

/**
 * Asistan oturumu — POST /t/<token>/asistan/oturum (kiracı alan adı). Geçerli QR bağlamı + paket / ayar kapısı.
 * Aynı tarayıcının kanıtı (başlıkta) geçerliyse konuşma sürdürülür; değilse yeni konuşma açılır ve kanıt YALNIZCA bu
 * yanıtta bir kez döner. Başka tarayıcı / masa eski konuşmayı göremez.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function POST(request: Request, { params }: Params) {
  const ctx = await tableContext((await params).token);
  if (!ctx) return json({ ok: false, error: "context_invalid" }, 404);
  const body = z.object({ uiLocale: z.string().max(8).default("tr") }).safeParse((await readJsonBody(request, BODY_LIMITS.smallJson).then((b) => (b.ok ? b.value : null))) ?? {});
  const result = await startOrResumeSession(ctx, { proof: request.headers.get(PROOF_HEADER), uiLocale: body.success ? body.data.uiLocale : "tr", ip: clientIp(request), realtimeAvailable: !!getRealtimeProvider() });
  return json(result, result.ok ? 200 : result.error === "rate_limited" ? 429 : 403);
}

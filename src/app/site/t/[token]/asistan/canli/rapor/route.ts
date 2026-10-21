import { z } from "zod";
import { BODY_LIMITS, readJsonBody } from "@/lib/security/body";
import { TURN_KEY_PATTERN } from "@/lib/ai/realtime";
import { reportLiveTurn } from "@/server/services/ai/realtime.service";
import { clientIp, json, PROOF_HEADER, tableContext } from "@/server/services/ai/http";

/**
 * Canlı tur raporu — POST /t/<token>/asistan/canli/rapor. İstemci oynatma sonunu / araya girmeyi bildirir (çalınan ses
 * süresi, kesinti). Yalnızca kanıtla doğrulanan konuşmanın turu güncellenir; tekrar eden rapor zararsızdır.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

const schema = z.object({ turnKey: z.string().regex(TURN_KEY_PATTERN), playedMs: z.number().min(0).max(600_000), interrupted: z.boolean() });

export async function POST(request: Request, { params }: Params) {
  const ctx = await tableContext((await params).token);
  if (!ctx) return json({ ok: false, error: "context_invalid" }, 404);
  const body = await readJsonBody(request, BODY_LIMITS.smallJson);
  if (!body.ok) return json({ ok: false, error: "too_long" }, body.error === "too_large" ? 413 : 400);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return json({ ok: false, error: "too_long" }, 400);
  const result = await reportLiveTurn(ctx, { proof: request.headers.get(PROOF_HEADER), ip: clientIp(request), ...parsed.data });
  return json(result, result.ok ? 200 : result.error === "rate_limited" ? 429 : result.error === "feature_disabled" ? 403 : 404);
}

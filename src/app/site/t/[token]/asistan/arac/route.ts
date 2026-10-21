import { z } from "zod";
import { orderItemSchema } from "@/lib/validation/orders";
import { BODY_LIMITS, readJsonBody } from "@/lib/security/body";
import { runRealtimeTool } from "@/server/services/ai/realtime-voice.service";
import { clientIp, json, PROOF_HEADER, tableContext } from "@/server/services/ai/http";

/**
 * Canlı garson araç çağrısı — POST /t/<token>/asistan/arac (kanıt başlıkta). Model aracı tarayıcıdaki oturumda çağırır;
 * araç burada güvenilir menüyle çalışır. Argümanlarda kiracı / masa kimliği yoktur (bağlam QR token'ından).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

const schema = z.object({
  name: z.string().min(1).max(40),
  args: z.unknown(),
  cart: z.array(z.object({ key: z.string().min(1).max(600), selection: orderItemSchema })).max(40).default([]),
  recentOrders: z.array(z.string().regex(/^[A-Za-z0-9_-]{22}$/)).max(10).default([]),
  /** Müşterinin son konuşmalarının tanınan metni (varyant / seçim tahminini engellemek için). */
  heard: z.string().max(1500).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const ctx = await tableContext((await params).token);
  if (!ctx) return json({ ok: false, error: "context_invalid" }, 404);
  const body = await readJsonBody(request, BODY_LIMITS.smallJson);
  const parsed = schema.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
  const result = await runRealtimeTool(ctx, { proof: request.headers.get(PROOF_HEADER), ip: clientIp(request), ...parsed.data });
  return json(result, result.ok ? 200 : result.error === "rate_limited" ? 429 : 403);
}

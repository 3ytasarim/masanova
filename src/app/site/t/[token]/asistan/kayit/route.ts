import { z } from "zod";
import { TURN_KEY_PATTERN } from "@/lib/ai/realtime";
import { BODY_LIMITS, readJsonBody } from "@/lib/security/body";
import { recordRealtimeTurn } from "@/server/services/ai/realtime-voice.service";
import { json, PROOF_HEADER, tableContext } from "@/server/services/ai/http";

/** Canlı garson tur kaydı — POST /t/<token>/asistan/kayit: konuşma geçmişi + kullanım (dakika / yanıt limiti). */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

const ms = z.number().int().min(0).max(600_000);
const schema = z.object({
  turnKey: z.string().regex(TURN_KEY_PATTERN),
  userText: z.string().max(2000).default(""),
  reply: z.string().max(4000).default(""),
  inputTokens: z.number().int().min(0).max(1_000_000).default(0),
  outputTokens: z.number().int().min(0).max(1_000_000).default(0),
  audioInMs: ms.default(0),
  audioOutMs: ms.default(0),
  firstAudioMs: ms.nullable().default(null),
  totalMs: ms.nullable().default(null),
  interrupted: z.boolean().default(false),
  tools: z.array(z.string().max(40)).max(20).default([]),
});

export async function POST(request: Request, { params }: Params) {
  const ctx = await tableContext((await params).token);
  if (!ctx) return json({ ok: false, error: "context_invalid" }, 404);
  const body = await readJsonBody(request, BODY_LIMITS.smallJson);
  const parsed = schema.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
  const result = await recordRealtimeTurn(ctx, { proof: request.headers.get(PROOF_HEADER), ...parsed.data });
  return json(result, result.ok ? 200 : result.error === "rate_limited" ? 429 : 403);
}

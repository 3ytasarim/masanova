import { z } from "zod";
import { BODY_LIMITS, readJsonBody } from "@/lib/security/body";
import { isAiLanguage } from "@/lib/ai/language";
import { getVoiceAiAccess } from "@/server/services/ai/access.service";
import { speechAllowed, tableScope } from "@/server/services/ai/assistant.service";
import { findAssistantMessage, findConversation } from "@/server/services/ai/conversation.service";
import { json, noStore, PROOF_HEADER, tableContext } from "@/server/services/ai/http";
import { synthesize } from "@/server/services/voice/speech.service";

/**
 * Asistan yanıtının sesi — POST /t/<token>/asistan/ses { messageId }. Keyfi metin seslendirilemez: yalnızca bu
 * konuşmanın (kanıt + masa doğrulanmış) asistan mesajı. Ses kapalıysa / sağlayıcı yoksa 204 (istemci metinle devam eder).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function POST(request: Request, { params }: Params) {
  const ctx = await tableContext((await params).token);
  if (!ctx) return json({ ok: false, error: "context_invalid" }, 404);
  const { availability, settings } = await getVoiceAiAccess(ctx.tenant.id);
  if (!availability.available) return json({ ok: false, error: "feature_disabled" }, 403);
  const body = z.object({ messageId: z.string().regex(/^[A-Za-z0-9_-]{16}$/) }).safeParse(await readJsonBody(request, BODY_LIMITS.smallJson).then((b) => (b.ok ? b.value : null)));
  if (!body.success) return json({ ok: false, error: "invalid" }, 400);
  const conversation = await findConversation(tableScope(ctx), request.headers.get(PROOF_HEADER));
  if (!conversation) return json({ ok: false, error: "conversation_invalid" }, 401);
  if (!settings.voiceEnabled) return new Response(null, { status: 204, headers: noStore });
  if (!(await speechAllowed(conversation))) return json({ ok: false, error: "rate_limited" }, 429);
  const message = await findAssistantMessage(conversation, body.data.messageId);
  if (!message) return json({ ok: false, error: "invalid" }, 404);
  const result = await synthesize({ tenantId: ctx.tenant.id, conversationId: conversation.id, text: message.content, language: isAiLanguage(message.language) ? message.language : "tr" });
  if (!result.ok) return new Response(null, { status: 204, headers: noStore });
  return new Response(result.audio as BodyInit, { status: 200, headers: { "Content-Type": result.mimeType, ...noStore } });
}

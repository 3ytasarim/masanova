import "server-only";
import { z } from "zod";
import { orderItemSchema } from "@/lib/validation/orders";
import { TURN_KEY_PATTERN } from "@/lib/ai/realtime";
import { MAX_AUDIO_BYTES } from "@/lib/voice/session";
import { getTableQrContext, type TrustedTableContext } from "@/lib/tenant/table-qr-context";

/**
 * Asistan HTTP yardımcıları. Konuşma kanıtı YALNIZCA başlıkta gelir (URL / gövde / log değil). Yanıtlar önbelleklenmez,
 * dizine eklenmez. Hata gövdeleri yalnızca kısa kod içerir (altyapı ayrıntısı yok).
 */
export const PROOF_HEADER = "x-mn-ai-proof";

export const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...noStore } });
}

export async function tableContext(token: string): Promise<TrustedTableContext | null> {
  const result = await getTableQrContext(token);
  return result.ok ? result.context : null;
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export const turnPayloadSchema = z.object({
  text: z.string().max(1200).nullish(),
  clientDurationMs: z.number().int().min(0).max(120_000).nullish(),
  cart: z
    .array(z.object({ key: z.string().min(1).max(600), selection: orderItemSchema }))
    .max(40)
    .default([]),
  recentOrders: z.array(z.string().regex(/^[A-Za-z0-9_-]{22}$/)).max(10).default([]),
  /** Tur anahtarı (isteğe bağlı): yeniden denemede aynı tur ikinci kez işlenmez. */
  turnKey: z.string().regex(TURN_KEY_PATTERN).nullish(),
  /** JSON içinde base64 ses (canlı yol ve onun yedeği). Çok parçalı gövde de desteklenir. */
  audio: z
    .object({ data: z.string().max(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 8).regex(/^[A-Za-z0-9+/]*={0,2}$/), mime: z.string().max(60), durationMs: z.number().int().min(0).max(120_000).nullish() })
    .nullish(),
});

export const livePayloadSchema = turnPayloadSchema.extend({
  turnKey: z.string().regex(TURN_KEY_PATTERN),
  /** Sessiz mod: yanıt sesi üretilmez (yalnızca metin). */
  muted: z.boolean().default(false),
});

/** JSON gövdesindeki base64 sesi çöz. */
export function decodeAudio(audio: { data: string; mime: string; durationMs?: number | null } | null | undefined) {
  if (!audio) return null;
  const bytes = new Uint8Array(Buffer.from(audio.data, "base64"));
  return { bytes, mimeType: audio.mime, clientDurationMs: audio.durationMs ?? null };
}

/** JSON + base64 ses için gövde üst sınırı (içerik uzunluğu okunmadan önce). */
export const JSON_AUDIO_BODY_MAX = Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 128 * 1024;

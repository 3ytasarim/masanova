import { processWebhook } from "@/server/payments/payment.service";

/**
 * Ödeme sağlayıcısı webhook'u — POST /api/v1/payments/webhook/<sağlayıcı>. CSRF / oturum DEĞİL, İMZA ile korunur
 * (ham gövde üzerinden HMAC + zaman toleransı). Sağlayıcı IP'leri dağınık olabileceğinden IP hız sınırı uygulanmaz;
 * gövde boyutu sınırlı. Yinelenen olay kimliği bir kez işlenir. Ham gövde saklanmaz / loglanmaz.
 */
export const dynamic = "force-dynamic";
const MAX_BODY = 64_000;

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9_-]{1,32}$/.test(provider)) return Response.json({ ok: false }, { status: 404 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return Response.json({ ok: false }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ ok: false }, { status: 413 });
  const r = await processWebhook(provider, raw, request.headers);
  return Response.json({ ok: r.status === 200, outcome: r.outcome }, { status: r.status });
}

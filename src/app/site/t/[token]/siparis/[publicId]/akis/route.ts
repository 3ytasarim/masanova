import { publicOrderIdSchema } from "@/lib/validation/orders";
import { authorizeCustomerStream } from "@/server/realtime/authorize";
import { orderChannel } from "@/server/realtime/bus";
import { createSseResponse } from "@/server/realtime/sse";

/**
 * Müşteri canlı sipariş durumu (SSE) — /t/<token>/siparis/<publicId>/akis (kiracı alan adı).
 * Sipariş sayfasıyla aynı erişim kuralı: QR bağlamı + aynı masa + 24 saat. Olaylar yalnızca yeni durumu taşır
 * (kimlik, personel adı, iç not yok). Erişim penceresi dolunca akış sunucu tarafından kapatılır.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string; publicId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { token, publicId } = await params;
  const auth = publicOrderIdSchema.safeParse(publicId).success ? await authorizeCustomerStream(token, publicId) : null;
  if (!auth) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  return createSseResponse({
    request,
    channels: [orderChannel(auth.orderId)],
    stillAuthorized: auth.stillAuthorized,
    maxLifetimeMs: Math.max(1000, Math.min(60 * 60 * 1000, auth.expiresAt - Date.now())),
  });
}

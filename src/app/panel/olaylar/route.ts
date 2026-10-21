import { authorizePanelStream } from "@/server/realtime/authorize";
import { tenantOrdersChannel } from "@/server/realtime/bus";
import { createSseResponse } from "@/server/realtime/sse";

/**
 * Panel canlı olay akışı (SSE) — /panel/olaylar. Kiracı oturumdan; kanal sunucuda üretilir. Sipariş listesi, sipariş
 * detayı ve KDS bu akışı "değişti" sinyali olarak kullanır ve yetkili veriyi sunucudan yeniden çeker.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizePanelStream();
  if (!auth) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  return createSseResponse({
    request,
    channels: [tenantOrdersChannel(auth.tenantId)],
    stillAuthorized: auth.stillAuthorized,
    // Uzun ömürlü bağlantılar saatte bir yenilenir (istemci otomatik yeniden bağlanır ve yetkiyi tazeler).
    maxLifetimeMs: 60 * 60 * 1000,
  });
}

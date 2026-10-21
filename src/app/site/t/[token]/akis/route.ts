import { authorizeTableStream } from "@/server/realtime/authorize";
import { tableChannel } from "@/server/realtime/bus";
import { createSseResponse } from "@/server/realtime/sse";

/**
 * Masa canlı akışı (SSE) — /t/<token>/akis (kiracı alan adı). QR menüsündeki servis taleplerinin durumunu taşır.
 * Yetki: geçerli QR bağlamı (token + host); kanal masa kimliğinden sunucuda üretilir. Olay yalnızca talep tipi +
 * durum taşır; istemci güncel durumu sunucudan yeniden çeker. Talep başına ayrı bağlantı açılmaz.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await authorizeTableStream((await params).token);
  if (!auth) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  return createSseResponse({ request, channels: [tableChannel(auth.tableId)], stillAuthorized: auth.stillAuthorized, maxLifetimeMs: 60 * 60 * 1000 });
}

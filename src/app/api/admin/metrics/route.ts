import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { metrics } from "@/lib/observability/metrics";
import { getRealtimeProvider } from "@/server/realtime/bus";
import { openSseCount } from "@/server/realtime/sse";

export const dynamic = "force-dynamic";

/**
 * Süreç metrikleri — YALNIZCA Super Admin (oturum). Kişisel veri yok: sayaçlar, göstergeler, gecikme özetleri, bellek.
 * Çok süreçte her istek bir sürecin değerini döner (pid alanı); birleşik görünüm için ileride OpenTelemetry dışa aktarıcısı.
 */
export async function GET() {
  const session = await getCurrentSession();
  if (!session || session.user.role !== "SUPER_ADMIN" || session.support) return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const memory = process.memoryUsage();
  return NextResponse.json(
    {
      pid: process.pid,
      realtime: getRealtimeProvider().name,
      sseOpen: openSseCount(),
      memoryMb: { rss: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576) },
      ...metrics.snapshot(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

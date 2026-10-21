import { NextResponse } from "next/server";
import { systemHealth } from "@/server/services/system.service";

export const dynamic = "force-dynamic";

/**
 * Sağlık kontrolü (uptime izleme, yük dengeleyici, PM2 / deploy doğrulaması).
 * 200 → ok / degraded (çekirdek çalışıyor), 503 → veritabanına erişilemiyor.
 * Sır, host, iç URL, sürüm ayrıntısı ya da hata mesajı içermez.
 */
export async function GET() {
  const health = await systemHealth();
  return NextResponse.json({ ...health, timestamp: new Date().toISOString() }, { status: health.status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}

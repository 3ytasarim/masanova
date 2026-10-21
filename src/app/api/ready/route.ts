import { NextResponse } from "next/server";
import { systemReadiness } from "@/server/services/system.service";

export const dynamic = "force-dynamic";

/**
 * Hazırlık — 200 { ready: true } ya da 503. Yalnızca çekirdek bağımlılıklar (veritabanı, yapılandırılmışsa Redis,
 * yazılabilir yükleme kökü). Sağlık (/api/health) ayrıntı ve "degraded" durumu verir; ikisi de sır / host içermez.
 */
export async function GET() {
  const r = await systemReadiness();
  return NextResponse.json(r, { status: r.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

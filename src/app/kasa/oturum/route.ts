import { NextResponse } from "next/server";
import { extendCurrentSession } from "@/lib/auth/session";

/**
 * Kasa terminali oturum yenileme (ekran açıkken birkaç saatte bir). Yalnızca aynı kaynaktan; yalnızca mevcut, geçerli
 * oturumun süresi uzatılır (yeni oturum açılmaz, kimlik değişmez).
 */
export async function POST(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return new NextResponse(null, { status: 403 });
  const ok = await extendCurrentSession();
  return new NextResponse(null, { status: ok ? 204 : 401, headers: { "Cache-Control": "no-store" } });
}

import { NextResponse, type NextRequest } from "next/server";
import { PLATFORM_ORIGIN, getPlatformUrl } from "@/lib/domain/get-platform-url";
import { isPlatformOnlyPath } from "@/lib/tenant/platform-paths";

/**
 * Kiracı alan adındaki /panel, /admin, /giris isteklerini platform alan adına taşır.
 * proxy.ts: demo.masanovai.com/panel/menu?x=1  →  rewrite /site/platform/panel/menu?x=1  →  burası
 *
 * Açık yönlendirme koruması: hedef her zaman platform köküne (getPlatformUrl) göre kurulur ve yalnızca
 * platforma ait izinli yollardan biri olabilir.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathname = `/${path.map(encodeURIComponent).join("/")}`;
  const target = new URL(getPlatformUrl(`${pathname}${request.nextUrl.search}`));

  if (target.origin !== PLATFORM_ORIGIN || !isPlatformOnlyPath(target.pathname)) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.redirect(target, 307);
}

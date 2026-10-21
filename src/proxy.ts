import { NextResponse, type NextRequest } from "next/server";
import { classifyHost } from "@/lib/tenant/host";
import { PLATFORM_REDIRECT_ROUTE, isPlatformOnlyPath } from "@/lib/tenant/platform-paths";
import { ROOT_HOSTNAME } from "@/lib/domain/root-domain";
import { PLATFORM_HOST_ALIASES } from "@/lib/domain/platform-aliases";
import { PLATFORM_ORIGIN } from "@/lib/domain/get-platform-url";
import { CORRELATION_HEADER, correlationIdFrom } from "@/lib/observability/correlation";
import { QR_ENTRY_IS_DEDICATED_HOST, QR_ENTRY_PATH_PREFIX, isQrEntryHost } from "@/lib/domain/qr-entry";

/**
 * Next 16 Proxy (eski adıyla middleware) — host tabanlı yönlendirme. Veritabanına DOKUNMAZ (her istekte çalışır);
 * yalnızca host'u sınıflandırır, kiracı çözümlemesi sunucu bileşenlerinde yapılır (tenant-context.ts).
 *
 * Platform host'u (masanovai.com, www., localhost)  → uygulama olduğu gibi: /, /giris, /admin, /panel, /q (kararlı QR girişi)
 * QR giriş host'u (QR_ENTRY_ORIGIN, ör. go.)         → yalnızca /q/<token>
 * Kiracı host'u (demo.masanovai.com, menu.x.com)    → /site rewrite (public kiracı sitesi / QR menü)
 *   /admin, /panel, /giris kiracı host'unda açılmaz; platform alan adına yönlendirilir. Böylece oturum
 *   çerezleri tek (platform) origin'de kalır ve kiracı alan adı ele geçirilse bile panel yüzeyi sunulmaz.
 *
 * Not: Yönlendirme burada değil /site/platform route handler'ında üretilir. Next, proxy yanıtındaki
 * Location başlığının host'u sunucunun kendi host'uyla aynıysa URL'i göreceli hale getirir; yerelde
 * (demo.localhost:3000 → localhost:3000) bu sonsuz yönlendirme döngüsü yaratır.
 */
export function proxy(request: NextRequest) {
  // İlişkilendirme kimliği: isteğe (sunucu kodu okur) ve yanıta (destek / log eşleştirme) yazılır. Sır taşımaz.
  const requestId = correlationIdFrom(request.headers);
  const headers = new Headers(request.headers);
  headers.set(CORRELATION_HEADER, requestId);
  const tag = <T extends NextResponse>(response: T): T => {
    response.headers.set(CORRELATION_HEADER, requestId);
    return response;
  };
  const next = () => tag(NextResponse.next({ request: { headers } }));

  // API uçları host yönlendirmesinden geçmez (yalnızca kimlik eklenir).
  if (request.nextUrl.pathname.startsWith("/api/")) return next();

  // Kararlı QR giriş host'u (prod: go.masanovai.com): yalnızca /q/<token> sunulur, gerisi platforma gider.
  if (QR_ENTRY_IS_DEDICATED_HOST && isQrEntryHost(request.headers.get("host"))) {
    if (request.nextUrl.pathname.startsWith(QR_ENTRY_PATH_PREFIX)) return next();
    return tag(NextResponse.redirect(new URL("/", PLATFORM_ORIGIN)));
  }

  const host = classifyHost(request.headers.get("host"), ROOT_HOSTNAME, PLATFORM_HOST_ALIASES);
  if (host.kind === "platform") return next();

  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();

  if (isPlatformOnlyPath(pathname)) {
    url.pathname = `${PLATFORM_REDIRECT_ROUTE}${pathname}`;
    return tag(NextResponse.rewrite(url, { request: { headers } }));
  }

  // Geçersiz / bilinmeyen host'lar da /site'a gider; orada güvenli 404 üretilir.
  url.pathname = pathname === "/" ? "/site" : `/site${pathname}`;
  return tag(NextResponse.rewrite(url, { request: { headers } }));
}

export const config = {
  // Next.js iç dosyaları ve uzantılı her dosya (robots.txt, sitemap.xml, icon.svg, public/*) proxy'den geçmez.
  // /api yalnızca ilişkilendirme kimliği için geçer (host yönlendirmesi yapılmadan döner).
  // /api/v1/media (görsel yükleme) proxy'den GEÇMEZ: proxy istek gövdesini tamponlar (varsayılan 10 MB sınırı) —
  // gövde rota tarafından akış hâlinde ve tür sınırıyla okunur. /media/… görsel adresleri uzantılı olduğu için zaten hariç.
  matcher: ["/((?!_next/|api/v1/media$|.*\\..*).*)"],
};

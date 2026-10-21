import type { NextConfig } from "next";
import { noindexHeaders, securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Yerel kiracı simülasyonu: demo.localhost:3000 gibi alt alan adlarından gelen dev isteklerine izin ver.
  allowedDevOrigins: ["*.localhost"],
  // Etiket üretimi yazı tiplerini çalışma anında diskten okur (assets/fonts) — sunucu paketine dahil edilsin.
  outputFileTracingIncludes: { "/panel/masalar/**": ["./assets/fonts/**"] },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: noindexHeaders },
      { source: "/panel/:path*", headers: noindexHeaders },
      { source: "/giris", headers: noindexHeaders },
      { source: "/api/:path*", headers: noindexHeaders },
      // Masa QR adresleri (token içerir) asla dizine eklenmez / arşivlenmez.
      { source: "/q/:path*", headers: noindexHeaders },
      { source: "/t/:path*", headers: noindexHeaders },
    ];
  },
};

export default nextConfig;

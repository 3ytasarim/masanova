import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HERO } from "@/content/marketing/copy";

/** Koyu zemin logosu (derleme anında okunur; data URL). */
const logo = `data:image/png;base64,${readFileSync(path.join(process.cwd(), "src/assets/brand/masanova-logo-dark.png")).toString("base64")}`;

/** Sosyal önizleme görseli (1200×630) — derleme anında üretilir; ikili dosya depoda yok. */
export const alt = "MasaNova AI — Restoranınızın yeni dijital garsonu";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", background: "linear-gradient(135deg,#0c0a09 55%,#431407)", color: "#fafaf9", fontFamily: "sans-serif" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse yalnızca <img> destekler */}
        <img src={logo} alt="MasaNova AI" height={64} style={{ height: 64, width: (64 * 1841) / 354 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2, maxWidth: 900 }}>{HERO.title}</div>
          <div style={{ fontSize: 30, color: "#d6d3d1", maxWidth: 900, lineHeight: 1.35 }}>QR menü · Masadan sipariş · Mutfak ekranı · Garson çağırma · Analitik · Sesli AI (5 dil)</div>
        </div>
        <div style={{ fontSize: 24, color: "#a8a29e" }}>Restoranlar için AI destekli servis ve operasyon platformu</div>
      </div>
    ),
    size,
  );
}

import type { Font } from "opentype.js";

/**
 * Metin → vektör yol. Tüm ölçüler milimetre: yazı boyutu = em kare yüksekliği (mm).
 * Ölçüm ve çizim aynı glif ilerlemesi + kerning hesabını kullanır; ortalama/hizalama birebir tutarlıdır.
 */
export type TextStyle = { font: Font; size: number; /** Harf aralığı, em cinsinden (0.1 = %10). */ tracking?: number };

function glyphRun(style: TextStyle, text: string) {
  const { font, size } = style;
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const tracking = (style.tracking ?? 0) * size;
  const offsets: number[] = [];
  let x = 0;
  glyphs.forEach((glyph, i) => {
    offsets.push(x);
    x += (glyph.advanceWidth ?? 0) * scale;
    const next = glyphs[i + 1];
    if (next) x += font.getKerningValue(glyph, next) * scale + tracking;
  });
  return { glyphs, offsets, width: x };
}

export function measureText(style: TextStyle, text: string): number {
  return glyphRun(style, text).width;
}

/** Büyük harf yüksekliği (mm) — satırları optik olarak hizalamak için. */
export function capHeight(style: TextStyle): number {
  const os2 = style.font.tables.os2 as { sCapHeight?: number } | undefined;
  return ((os2?.sCapHeight ?? style.font.unitsPerEm * 0.7) / style.font.unitsPerEm) * style.size;
}

/** Satır yüksekliği: büyük harf + alt uzantı payı. Taban çizgisi = satır üstü + capHeight. */
export function lineBox(style: TextStyle): { height: number; baseline: number } {
  const cap = capHeight(style);
  return { height: cap + style.size * 0.26, baseline: cap };
}

export type Align = "left" | "center" | "right";

/** x: hizalama noktası (left → sol kenar, center → orta), baselineY: taban çizgisi. */
export function textPath(style: TextStyle, text: string, x: number, baselineY: number, align: Align = "left"): string {
  const run = glyphRun(style, text);
  const startX = align === "center" ? x - run.width / 2 : align === "right" ? x - run.width : x;
  return run.glyphs
    .map((glyph, i) => glyph.getPath(startX + run.offsets[i]!, baselineY, style.size).toPathData(3))
    .filter(Boolean)
    .join("");
}

/**
 * Genişliğe sığdırma: önce yazı boyutu `minScale` oranına kadar küçültülür, yine sığmazsa üç noktayla kısaltılır.
 */
export function fitText(style: TextStyle, text: string, maxWidth: number, minScale = 0.7): { style: TextStyle; text: string } {
  const clean = text.replace(/\s+/g, " ").trim();
  const width = measureText(style, clean);
  if (width <= maxWidth) return { style, text: clean };
  const scaled = Math.max(minScale, maxWidth / width);
  const shrunk: TextStyle = { ...style, size: style.size * scaled };
  if (measureText(shrunk, clean) <= maxWidth) return { style: shrunk, text: clean };
  let cut = clean;
  while (cut.length > 1 && measureText(shrunk, `${cut}…`) > maxWidth) cut = cut.slice(0, -1).trimEnd();
  return { style: shrunk, text: `${cut}…` };
}

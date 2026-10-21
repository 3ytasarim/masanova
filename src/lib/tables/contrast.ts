/**
 * Renk kontrastı (WCAG 2.x göreli parlaklık) ve QR okunabilirlik güvencesi.
 *
 * QR kodu marka rengiyle basılabilir, ancak yalnızca güvenliyse: koyu modüller açık zeminden belirgin biçimde
 * KOYU olmalı (ters renkli QR'ları birçok tarayıcı okuyamaz) ve kontrast en az QR_MIN_CONTRAST olmalı.
 * Aksi halde QR otomatik olarak siyah/beyaza zorlanır.
 */

export const QR_MIN_CONTRAST = 7;
export const TEXT_MIN_CONTRAST = 4.5;

export function parseHexColor(hex: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function isHexColor(hex: string | null | undefined): hex is string {
  return parseHexColor(hex) !== null;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`Geçersiz renk: ${hex}`);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type QrColors = { dark: string; light: string; forced: boolean };

/** İstenen QR renkleri güvenli değilse siyah/beyaz döner (`forced: true` — arayüz kullanıcıya bildirir). */
export function safeQrColors(preferredDark: string | null | undefined, light = "#ffffff"): QrColors {
  const fallback: QrColors = { dark: "#000000", light: "#ffffff", forced: true };
  if (!isHexColor(light)) return fallback;
  if (!isHexColor(preferredDark)) return { ...fallback, forced: preferredDark != null };
  const darkEnough = relativeLuminance(preferredDark) < relativeLuminance(light);
  if (!darkEnough || contrastRatio(preferredDark, light) < QR_MIN_CONTRAST) return fallback;
  return { dark: preferredDark.toLowerCase(), light: light.toLowerCase(), forced: false };
}

/** Zemin üzerinde okunur metin rengi: tercih edilen renk yeterli kontrastta değilse koyu/açık yedek. */
export function readableTextColor(background: string, preferred?: string | null, min = TEXT_MIN_CONTRAST): string {
  if (isHexColor(preferred) && contrastRatio(preferred, background) >= min) return preferred.toLowerCase();
  return contrastRatio("#111111", background) >= contrastRatio("#ffffff", background) ? "#111111" : "#ffffff";
}

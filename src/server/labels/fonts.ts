import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse, type Font } from "opentype.js";

/**
 * Etiket yazı tipleri (SIL OFL 1.1 — lisanslar assets/fonts/*-OFL.txt). Metin, baskı çıktısında yazı tipine
 * bağımlı kalmasın diye vektör yola (outline) çevrilir: SVG ve PDF birebir aynı görünür, matbaada font eksikliği olmaz.
 */
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

const FILES = {
  sans: "Inter-Regular.ttf",
  sansSemi: "Inter-SemiBold.ttf",
  sansBold: "Inter-Bold.ttf",
  serif: "PlayfairDisplay-SemiBold.ttf",
} as const;

export type FontKey = keyof typeof FILES;

const cache = new Map<FontKey, Font>();

export function getFont(key: FontKey): Font {
  const cached = cache.get(key);
  if (cached) return cached;
  const buffer = readFileSync(path.join(FONT_DIR, FILES[key]));
  const font = parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  cache.set(key, font);
  return font;
}

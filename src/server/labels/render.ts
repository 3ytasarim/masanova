import "server-only";
import { PDFDocument, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { MM_TO_PT, type SheetLayout } from "@/lib/tables/label-geometry";
import type { LabelDrawing, LogoImage } from "@/server/labels/layout";
import { escapeXml } from "@/server/labels/qr";

/**
 * Çizim listesi → SVG / PDF. İkisi de vektördür (metin yola çevrilmiş, QR modülleri dolgulu yol);
 * yalnızca logo raster olarak gömülür. PDF gerçek fiziksel ölçüde üretilir (pt = mm × 72 / 25,4);
 * tarayıcı ekran görüntüsü / html2canvas kullanılmaz.
 */

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function renderLabelSvg(drawing: LabelDrawing): string {
  const { width, height, bleed } = drawing;
  const W = width + bleed * 2;
  const H = height + bleed * 2;
  const body = drawing.shapes
    .map((shape) =>
      shape.kind === "path"
        ? `<path d="${shape.d}" fill="${shape.fill}"/>`
        : `<image x="${r3(shape.x)}" y="${r3(shape.y)}" width="${r3(shape.width)}" height="${r3(shape.height)}" preserveAspectRatio="xMidYMid meet" href="data:${shape.image.mime};base64,${Buffer.from(shape.image.data).toString("base64")}"/>`,
    )
    .join("");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(W)}mm" height="${r3(H)}mm" viewBox="${-bleed} ${-bleed} ${r3(W)} ${r3(H)}" role="img">`,
    `<title>${escapeXml(drawing.title)}</title>`,
    body,
    `</svg>`,
  ].join("");
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

type ImageCache = Map<LogoImage, PDFImage>;

async function embed(doc: PDFDocument, cache: ImageCache, image: LogoImage): Promise<PDFImage> {
  const cached = cache.get(image);
  if (cached) return cached;
  const embedded = image.mime === "image/png" ? await doc.embedPng(image.data) : await doc.embedJpg(image.data);
  cache.set(image, embedded);
  return embedded;
}

/** Çizimi sayfaya yerleştirir; (originX, originY) = kesim kutusunun sol-üst köşesi, sayfa sol-üstünden mm. */
async function drawOnPage(doc: PDFDocument, page: PDFPage, drawing: LabelDrawing, originX: number, originY: number, cache: ImageCache) {
  const pageHeight = page.getHeight();
  const x0 = originX * MM_TO_PT;
  const y0 = pageHeight - originY * MM_TO_PT;
  for (const shape of drawing.shapes) {
    if (shape.kind === "path") {
      if (shape.d) page.drawSvgPath(shape.d, { x: x0, y: y0, scale: MM_TO_PT, color: hexToRgb(shape.fill) });
      continue;
    }
    const image = await embed(doc, cache, shape.image);
    page.drawImage(image, {
      x: x0 + shape.x * MM_TO_PT,
      y: y0 - (shape.y + shape.height) * MM_TO_PT,
      width: shape.width * MM_TO_PT,
      height: shape.height * MM_TO_PT,
    });
  }
}

function setMetadata(doc: PDFDocument, title: string) {
  doc.setTitle(title);
  doc.setCreator("MasaNova AI");
  doc.setProducer("MasaNova AI etiket üretici");
  doc.setCreationDate(new Date());
}

/** Tek etiket PDF'i: sayfa = etiket + taşma payı; TrimBox / BleedBox doğru ayarlanır. */
export async function renderLabelPdf(drawing: LabelDrawing): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setMetadata(doc, drawing.title);
  const { width, height, bleed } = drawing;
  const page = doc.addPage([(width + bleed * 2) * MM_TO_PT, (height + bleed * 2) * MM_TO_PT]);
  page.setBleedBox(0, 0, page.getWidth(), page.getHeight());
  page.setTrimBox(bleed * MM_TO_PT, bleed * MM_TO_PT, width * MM_TO_PT, height * MM_TO_PT);
  await drawOnPage(doc, page, drawing, bleed, bleed, new Map());
  return doc.save();
}

const CROP_OFFSET_MM = 1;
const CROP_LENGTH_MM = 1.8;
const CROP_WEIGHT_MM = 0.12;

/** Kesim işaretleri: her köşede, etiket kenarının uzantısında, aradaki boşluğa çizilen kısa çizgiler. */
function cropMarks(x: number, y: number, w: number, h: number): string {
  const o = CROP_OFFSET_MM;
  const l = CROP_LENGTH_MM;
  const t = CROP_WEIGHT_MM;
  const bar = (bx: number, by: number, bw: number, bh: number) => `M${r3(bx)} ${r3(by)}H${r3(bx + bw)}V${r3(by + bh)}H${r3(bx)}Z`;
  return [
    // sol-üst
    bar(x - o - l, y - t / 2, l, t),
    bar(x - t / 2, y - o - l, t, l),
    // sağ-üst
    bar(x + w + o, y - t / 2, l, t),
    bar(x + w - t / 2, y - o - l, t, l),
    // sol-alt
    bar(x - o - l, y + h - t / 2, l, t),
    bar(x - t / 2, y + h + o, t, l),
    // sağ-alt
    bar(x + w + o, y + h - t / 2, l, t),
    bar(x + w - t / 2, y + h + o, t, l),
  ].join("");
}

/**
 * A4 toplu baskı: etiketler gerçek ölçüsünde, hesaplanan ızgarada; taşma payı uygulanmaz (kesim işaretleri eklenir).
 */
export async function renderSheetPdf(drawings: LabelDrawing[], layout: SheetLayout, sheet: { width: number; height: number }, title: string): Promise<Uint8Array> {
  if (layout.perPage === 0) throw new Error("Etiket sayfaya sığmıyor.");
  const doc = await PDFDocument.create();
  setMetadata(doc, title);
  const cache: ImageCache = new Map();
  for (let start = 0; start < drawings.length; start += layout.perPage) {
    const page = doc.addPage([sheet.width * MM_TO_PT, sheet.height * MM_TO_PT]);
    const chunk = drawings.slice(start, start + layout.perPage);
    let marks = "";
    for (const [i, drawing] of chunk.entries()) {
      const pos = layout.positions[i]!;
      await drawOnPage(doc, page, { ...drawing, bleed: 0 }, pos.x, pos.y, cache);
      marks += cropMarks(pos.x, pos.y, drawing.width, drawing.height);
    }
    page.drawSvgPath(marks, { x: 0, y: page.getHeight(), scale: MM_TO_PT, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

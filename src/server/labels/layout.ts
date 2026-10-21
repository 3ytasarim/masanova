import "server-only";
import { readableTextColor, safeQrColors, contrastRatio, isHexColor } from "@/lib/tables/contrast";
import { QR_MIN_PRINT_MM, pixelsForPrint, safeMarginMm } from "@/lib/tables/label-geometry";
import type { LabelOptions, LabelTemplate } from "@/lib/tables/label-options";
import { getFont, type FontKey } from "@/server/labels/fonts";
import { createQrMatrix, qrModulesPath, QR_QUIET_ZONE_MODULES } from "@/server/labels/qr";
import { fitText, lineBox, measureText, textPath, type TextStyle } from "@/server/labels/text";

/**
 * Etiket çizimi — şablondan bağımsız bir "çizim listesi" üretir (yalnızca dolgulu vektör yollar + logo görseli).
 * Aynı liste hem SVG'ye hem PDF'e çevrilir; önizleme, SVG ve PDF birebir aynıdır. Tüm ölçüler milimetre,
 * kesim (trim) kutusunun sol-üst köşesi (0,0). Taşma payı (bleed) negatif koordinatlara uzanan zemindir.
 */

export type LogoImage = { data: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number };

export type LabelShape =
  | { kind: "path"; d: string; fill: string }
  | { kind: "image"; x: number; y: number; width: number; height: number; image: LogoImage };

export type LabelDrawing = {
  width: number;
  height: number;
  bleed: number;
  shapes: LabelShape[];
  qr: { sizeMm: number; moduleMm: number; colorsForced: boolean };
  warnings: string[];
  title: string;
};

export type LabelBrand = {
  name: string;
  primary: string | null;
  secondary: string | null;
  accent: string | null;
  logo: LogoImage | null;
  /** Logo adresi var ama indirilemedi/desteklenmiyor. */
  logoFailed?: boolean;
};

export type LabelContent = { tableName: string; url: string };

// ─── Şekil yardımcıları ─────────────────────────────────────────────────────

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Saat yönünde (ya da `reverse` ile ters) yuvarlatılmış dikdörtgen — ters yön, iç içe çizimde delik açar. */
export function roundedRectPath(x: number, y: number, w: number, h: number, radius = 0, reverse = false): string {
  const rad = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (rad === 0) {
    return reverse
      ? `M${r3(x)} ${r3(y)}V${r3(y + h)}H${r3(x + w)}V${r3(y)}Z`
      : `M${r3(x)} ${r3(y)}H${r3(x + w)}V${r3(y + h)}H${r3(x)}Z`;
  }
  const k = rad * 0.5523;
  const [x2, y2] = [x + w, y + h];
  if (!reverse) {
    return [
      `M${r3(x + rad)} ${r3(y)}H${r3(x2 - rad)}`,
      `C${r3(x2 - rad + k)} ${r3(y)} ${r3(x2)} ${r3(y + rad - k)} ${r3(x2)} ${r3(y + rad)}`,
      `V${r3(y2 - rad)}`,
      `C${r3(x2)} ${r3(y2 - rad + k)} ${r3(x2 - rad + k)} ${r3(y2)} ${r3(x2 - rad)} ${r3(y2)}`,
      `H${r3(x + rad)}`,
      `C${r3(x + rad - k)} ${r3(y2)} ${r3(x)} ${r3(y2 - rad + k)} ${r3(x)} ${r3(y2 - rad)}`,
      `V${r3(y + rad)}`,
      `C${r3(x)} ${r3(y + rad - k)} ${r3(x + rad - k)} ${r3(y)} ${r3(x + rad)} ${r3(y)}Z`,
    ].join("");
  }
  return [
    `M${r3(x + rad)} ${r3(y)}`,
    `C${r3(x + rad - k)} ${r3(y)} ${r3(x)} ${r3(y + rad - k)} ${r3(x)} ${r3(y + rad)}`,
    `V${r3(y2 - rad)}`,
    `C${r3(x)} ${r3(y2 - rad + k)} ${r3(x + rad - k)} ${r3(y2)} ${r3(x + rad)} ${r3(y2)}`,
    `H${r3(x2 - rad)}`,
    `C${r3(x2 - rad + k)} ${r3(y2)} ${r3(x2)} ${r3(y2 - rad + k)} ${r3(x2)} ${r3(y2 - rad)}`,
    `V${r3(y + rad)}`,
    `C${r3(x2)} ${r3(y + rad - k)} ${r3(x2 - rad + k)} ${r3(y)} ${r3(x2 - rad)} ${r3(y)}`,
    `H${r3(x + rad)}Z`,
  ].join("");
}

/** Çerçeve: dış dikdörtgen + ters yönlü iç dikdörtgen (nonzero dolguyla halka). */
function framePath(x: number, y: number, w: number, h: number, thickness: number): string {
  return roundedRectPath(x, y, w, h) + roundedRectPath(x + thickness, y + thickness, w - thickness * 2, h - thickness * 2, 0, true);
}

function circlePath(cx: number, cy: number, radius: number): string {
  return roundedRectPath(cx - radius, cy - radius, radius * 2, radius * 2, radius);
}

/** Rengi beyazla karıştırır (amount = rengin oranı). */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * amount + 255 * (1 - amount));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${[r, g, b].map((c) => c!.toString(16).padStart(2, "0")).join("")}`;
}

const color = (value: string | null | undefined, fallback: string) => (isHexColor(value) ? value.toLowerCase() : fallback);

const NOIR = "#0b0b0f";

/** Rengi koyu zeminle karıştırır (amount = rengin oranı) — koyu şablonda "ışıltı" katmanları için. */
function shade(hex: string, base: string, amount: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(base.slice(1), 16);
  const ch = (n: number, s: number) => (n >> s) & 255;
  const mix = (s: number) => Math.round(ch(a, s) * amount + ch(b, s) * (1 - amount));
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, "0")).join("")}`;
}

/** Yuvarlatılmış halka (dış + ters yönlü iç) — QR plakasının çevresine ince marka çizgisi. */
function roundedRingPath(x: number, y: number, w: number, h: number, radius: number, thickness: number): string {
  return roundedRectPath(x, y, w, h, radius) + roundedRectPath(x + thickness, y + thickness, w - thickness * 2, h - thickness * 2, Math.max(0, radius - thickness), true);
}

/** "Okutma çerçevesi": QR'ın dört köşesinde L biçimli işaretler (modern tarayıcı vizörü görünümü). */
function scanCornersPath(x: number, y: number, size: number, length: number, thickness: number): string {
  const parts: string[] = [];
  const corner = (cx: number, cy: number, dx: number, dy: number) => {
    const hx = dx > 0 ? cx : cx - length;
    const vy = dy > 0 ? cy : cy - length;
    parts.push(roundedRectPath(hx, dy > 0 ? cy : cy - thickness, length, thickness, thickness / 2));
    parts.push(roundedRectPath(dx > 0 ? cx : cx - thickness, vy, thickness, length, thickness / 2));
  };
  corner(x, y, 1, 1);
  corner(x + size, y, -1, 1);
  corner(x, y + size, 1, -1);
  corner(x + size, y + size, -1, -1);
  return parts.join("");
}

// ─── Şablon paletleri ───────────────────────────────────────────────────────

type Palette = {
  background: string;
  text: string;
  muted: string;
  table: string;
  /** QR plakası (açık zemin). */
  plate: string;
  plateRadius: number;
  /** "brand" seçildiğinde denenecek QR rengi. */
  qrBrand: string;
  nameFont: FontKey;
  nameUpper: boolean;
  nameTracking: number;
  tableFont: FontKey;
  ctaFont: FontKey;
  ctaUpper: boolean;
  ctaTracking: number;
  ctaColor: string;
};

function paletteFor(template: LabelTemplate, brand: LabelBrand): Palette {
  const primary = color(brand.primary, "#1f2937");
  const accent = color(brand.accent ?? brand.secondary, primary);
  const base = {
    plateRadius: 0,
    nameFont: "sansSemi" as FontKey,
    nameUpper: true,
    nameTracking: 0.12,
    tableFont: "sansBold" as FontKey,
    ctaFont: "sansSemi" as FontKey,
    ctaUpper: false,
    ctaTracking: 0,
  };
  switch (template) {
    case "minimal":
      return { ...base, background: "#ffffff", text: "#111111", muted: "#5f5f5f", table: readableTextColor("#ffffff", primary), plate: "#ffffff", qrBrand: primary, ctaColor: "#111111" };
    case "modern":
      return { ...base, background: "#ffffff", text: "#111111", muted: "#5f5f5f", table: "#111111", plate: "#ffffff", qrBrand: primary, ctaColor: "#111111", nameTracking: 0.08 };
    case "dark":
      return {
        ...base,
        background: "#101114",
        text: "#f4f4f5",
        muted: "#a1a1aa",
        table: "#ffffff",
        plate: "#ffffff",
        plateRadius: 1,
        qrBrand: primary,
        ctaColor: readableTextColor("#101114", accent),
      };
    case "luxury":
      return {
        ...base,
        background: "#f6f0e4",
        text: "#1c1a17",
        muted: "#6b5f4d",
        table: "#1c1a17",
        plate: "#f6f0e4",
        qrBrand: "#1c1a17",
        nameFont: "serif",
        nameUpper: false,
        nameTracking: 0.02,
        tableFont: "serif",
        ctaFont: "sans",
        ctaUpper: true,
        ctaTracking: 0.18,
        ctaColor: "#6b5f4d",
      };
    case "signature": {
      const on = readableTextColor(primary, "#ffffff");
      const light = on === "#ffffff";
      return {
        ...base,
        background: primary,
        text: on,
        muted: light ? tint(primary, 0.32) : "#3f3f46",
        table: readableTextColor("#ffffff", primary),
        plate: "#ffffff",
        plateRadius: 2.4,
        qrBrand: primary,
        nameFont: "sansBold",
        nameTracking: 0.16,
        ctaColor: on,
      };
    }
    case "wave":
      return { ...base, background: "#ffffff", text: "#111111", muted: "#6b7280", table: readableTextColor("#ffffff", primary), plate: "#ffffff", plateRadius: 2, qrBrand: primary, nameFont: "sansBold", nameTracking: 0.12, ctaColor: "#111111" };
    case "noir":
      return {
        ...base,
        background: NOIR,
        text: "#fafafa",
        muted: "#a1a1aa",
        table: "#ffffff",
        plate: "#ffffff",
        plateRadius: 2,
        qrBrand: primary,
        nameTracking: 0.24,
        ctaFont: "sans",
        ctaUpper: true,
        ctaTracking: 0.18,
        ctaColor: accentOnDark(accent, NOIR),
      };
    case "tableCard":
      return { ...base, background: "#ffffff", text: "#111111", muted: "#6b7280", table: readableTextColor("#ffffff", primary), plate: "#ffffff", plateRadius: 1.6, qrBrand: primary, nameFont: "sansSemi", nameTracking: 0.14, ctaColor: "#111111" };
    case "cafe":
      return {
        ...base,
        background: "#fbf3e7",
        text: "#2b2118",
        muted: "#6e5d4b",
        table: readableTextColor("#fbf3e7", primary),
        plate: "#ffffff",
        plateRadius: 1.4,
        qrBrand: primary,
        nameTracking: 0.06,
        ctaColor: "#2b2118",
      };
  }
}

// ─── Yerleşim ───────────────────────────────────────────────────────────────

type Row =
  | { kind: "logo"; height: number }
  | { kind: "text"; role: "name" | "cta" | "table" | "info" | "powered"; style: TextStyle; text: string; fill: string; height: number; baseline: number; pill?: { fill: string; padX: number; padY: number } };

const POWERED_BY = "Powered by MasaNova AI";

export function buildLabel(options: LabelOptions, brand: LabelBrand, content: LabelContent): LabelDrawing {
  const { width: w, height: h, template } = options;
  const bleed = options.bleed ? 3 : 0;
  const palette = paletteFor(template, brand);
  const primary = color(brand.primary, "#1f2937");
  const accent = color(brand.accent ?? brand.secondary, primary);
  const warnings: string[] = [];
  const shapes: LabelShape[] = [];

  // Lüks şablonda çerçeve güvenli alanın içinde kalır; içerik çerçeveden ayrıca uzaklaşır.
  const margin = safeMarginMm(w, h) + (template === "luxury" ? Math.min(w, h) * 0.035 : 0);
  const landscape = w / h >= 1.3;
  const unit = (landscape ? h : Math.min(w, h)) / 50;
  const contentW = w - margin * 2;
  const contentH = h - margin * 2;

  const qrColors = options.qrColor === "brand" ? safeQrColors(palette.qrBrand, palette.plate) : safeQrColors("#000000", palette.plate);
  if (options.qrColor === "brand" && qrColors.forced) warnings.push("Marka rengi QR için yeterli kontrastta değil; QR otomatik olarak siyah/beyaz basılıyor.");

  // Zemin (taşma payına kadar).
  shapes.push({ kind: "path", d: roundedRectPath(-bleed, -bleed, w + bleed * 2, h + bleed * 2), fill: palette.background });

  // Satır stilleri.
  const style = (font: FontKey, size: number, tracking = 0): TextStyle => ({ font: getFont(font), size: size * unit, tracking });
  // Yatay etiket: QR solda (yükseklik kadar), metin sütunu sağda.
  const landscapeQr = Math.min(contentH, contentW * 0.55);
  const landscapeColX = margin + landscapeQr + (template === "dark" ? 5 : 3.5) * unit;
  const textColumnW = landscape ? w - margin - landscapeColX : contentW;
  const textRow = (role: Extract<Row, { kind: "text" }>["role"], s: TextStyle, raw: string, fill: string, maxW: number, pill?: { fill: string; padX: number; padY: number }): Row => {
    const fitted = fitText(s, raw, maxW - (pill ? pill.padX * 2 : 0));
    const box = lineBox(fitted.style);
    const padY = pill ? pill.padY : 0;
    return { kind: "text", role, style: fitted.style, text: fitted.text, fill, height: box.height + padY * 2, baseline: box.baseline + padY, pill };
  };

  const nameText = palette.nameUpper ? brand.name.toLocaleUpperCase("tr-TR") : brand.name;
  const ctaText = palette.ctaUpper ? options.cta.toLocaleUpperCase("tr-TR") : options.cta;
  const tablePill =
    template === "modern"
      ? { fill: accent, padX: 2.4 * unit, padY: 1.1 * unit }
      : template === "signature"
        ? { fill: "#ffffff", padX: 2.6 * unit, padY: 1.1 * unit }
        : template === "noir"
          ? { fill: accentOnDark(accent, NOIR), padX: 2.6 * unit, padY: 1.1 * unit }
          : undefined;
  const tableFill = template === "signature" ? readableTextColor("#ffffff", primary) : tablePill ? readableTextColor(tablePill.fill, "#ffffff") : palette.table;

  const logoAvailable = options.showLogo && brand.logo !== null;
  if (options.showLogo && brand.logoFailed) warnings.push("Logo indirilemedi ya da desteklenmeyen biçimde (yalnızca PNG/JPEG); işletme adı kullanıldı.");

  let header: Row[] = [];
  if (logoAvailable) header.push({ kind: "logo", height: (landscape ? 6 : 7) * unit });
  if (options.showName && (!logoAvailable || Math.min(w, h) >= 70)) {
    const onBand = template === "modern" || (template === "wave" && !landscape);
    header.push(textRow("name", style(palette.nameFont, palette.nameUpper ? (template === "tableCard" ? 2.2 : 2.7) : 3.4, palette.nameTracking), nameText, onBand ? readableTextColor(primary, "#ffffff") : palette.text, textColumnW));
  }
  let cta: Row = textRow("cta", style(palette.ctaFont, palette.ctaUpper ? 2.0 : 2.6, palette.ctaTracking), ctaText, palette.ctaColor, textColumnW);
  const table: Row = textRow("table", style(palette.tableFont, template === "tableCard" && !landscape ? 6.6 : 4.8), content.tableName, tableFill, textColumnW, tablePill);
  let info: Row[] = options.info.trim() ? [textRow("info", style("sans", 1.8), options.info.trim(), palette.muted, textColumnW)] : [];
  let powered: Row[] = options.poweredBy ? [textRow("powered", style("sans", 1.45, 0.02), POWERED_BY, palette.muted, textColumnW)] : [];

  const gap = 1.6 * unit;
  // Okutma çerçevesi köşeleri QR plakasının dışına taşar → bu şablonlarda QR çevresinde daha fazla boşluk.
  const qrGap = (["signature", "wave", "noir", "tableCard"].includes(template) ? 3.8 : 2.2) * unit;
  const sumRows = (rows: Row[]) => rows.reduce((t, r) => t + r.height, 0);

  // QR boyutu: kalan alan. Küçük etiketlerde QR en az QR_MIN_PRINT_MM kalsın diye isteğe bağlı satırlar sırayla düşer.
  const qrSizeFor = () => {
    if (landscape) return landscapeQr;
    const rows = [...header, cta, table, ...info, ...powered];
    const gaps = Math.max(0, rows.length - 1) * gap + qrGap * 2 - gap;
    return Math.min(contentW * (h / w > 1.3 ? 0.8 : 0.86), contentH - sumRows(rows) - gaps);
  };
  let qrSize = qrSizeFor();
  const dropped: string[] = [];
  if (!landscape && qrSize < QR_MIN_PRINT_MM && info.length) {
    info = [];
    dropped.push("bilgi satırı");
    qrSize = qrSizeFor();
  }
  if (!landscape && qrSize < QR_MIN_PRINT_MM && header.length) {
    header = [];
    dropped.push("logo/işletme adı");
    qrSize = qrSizeFor();
  }
  if (!landscape && qrSize < QR_MIN_PRINT_MM && powered.length) {
    powered = [];
    dropped.push("MasaNova imzası");
    qrSize = qrSizeFor();
  }
  if (dropped.length) warnings.push(`Etiket küçük olduğu için QR'a yer açmak üzere gizlendi: ${dropped.join(", ")}.`);
  if (qrSize < QR_MIN_PRINT_MM) {
    // Son çare: CTA küçültülür (QR asla küçültülerek okunmaz hale getirilmez — uyarı verilir).
    cta = textRow("cta", { ...(cta as Extract<Row, { kind: "text" }>).style, size: 2 * unit }, ctaText, palette.ctaColor, textColumnW);
    qrSize = qrSizeFor();
  }
  if (qrSize < QR_MIN_PRINT_MM) warnings.push(`QR kodu ${qrSize.toFixed(1).replace(".", ",")} mm; masa mesafesinden güvenilir okutma için en az ${QR_MIN_PRINT_MM} mm önerilir. Daha büyük bir etiket seçin.`);

  const matrix = createQrMatrix(content.url);
  const moduleMm = qrSize / (matrix.size + QR_QUIET_ZONE_MODULES * 2);

  const drawQr = (x: number, y: number) => {
    // Okutma çerçevesi köşeleri plakanın DIŞINDA (QR sessiz alanı ve okunabilirlik etkilenmez).
    const cornerColor = template === "signature" ? readableTextColor(primary, "#ffffff") : template === "noir" ? accentOnDark(accent, NOIR) : template === "wave" || template === "tableCard" ? readableTextColor("#ffffff", primary) : null;
    if (cornerColor) {
      const off = 1.3 * unit;
      shapes.push({ kind: "path", d: scanCornersPath(x - off, y - off, qrSize + off * 2, Math.max(2.5, qrSize * 0.16), Math.max(0.5, 0.55 * unit)), fill: cornerColor });
    }
    if (template === "wave" || template === "tableCard") {
      const ring = 0.35 * unit;
      shapes.push({ kind: "path", d: roundedRingPath(x - ring, y - ring, qrSize + ring * 2, qrSize + ring * 2, palette.plateRadius * unit + ring, ring), fill: tint(primary, 0.28) });
    }
    shapes.push({ kind: "path", d: roundedRectPath(x, y, qrSize, qrSize, palette.plateRadius * unit), fill: qrColors.light });
    const offset = QR_QUIET_ZONE_MODULES * moduleMm;
    shapes.push({ kind: "path", d: qrModulesPath(matrix, x + offset, y + offset, moduleMm), fill: qrColors.dark });
  };

  const drawRow = (row: Row, x: number, top: number, align: "left" | "center", columnW: number) => {
    if (row.kind === "logo") {
      const logo = brand.logo!;
      const maxW = columnW * 0.7;
      let lh = row.height;
      let lw = (logo.width / logo.height) * lh;
      if (lw > maxW) {
        lw = maxW;
        lh = (logo.height / logo.width) * lw;
      }
      const lx = align === "center" ? x - lw / 2 : x;
      shapes.push({ kind: "image", x: lx, y: top + (row.height - lh) / 2, width: lw, height: lh, image: logo });
      const needed = pixelsForPrint(lw);
      if (logo.width < needed * 0.5) warnings.push(`Logo düşük çözünürlüklü (${logo.width} px; bu boyutta 300 DPI için ~${needed} px önerilir). Baskıda bulanık görünebilir.`);
      return;
    }
    if (row.pill) {
      const textW = measureText(row.style, row.text);
      const pw = textW + row.pill.padX * 2;
      const px = align === "center" ? x - pw / 2 : x;
      shapes.push({ kind: "path", d: roundedRectPath(px, top, pw, row.height, row.height / 2), fill: row.pill.fill });
      const tx = align === "center" ? x : x + row.pill.padX;
      shapes.push({ kind: "path", d: textPath(row.style, row.text, tx, top + row.baseline, align), fill: row.fill });
      return;
    }
    shapes.push({ kind: "path", d: textPath(row.style, row.text, x, top + row.baseline, align), fill: row.fill });
  };

  // Şablon süslemeleri (içerikten önce, zeminin üstünde).
  if (template === "luxury") {
    const inset = safeMarginMm(w, h) * 0.45;
    shapes.push({ kind: "path", d: framePath(inset, inset, w - inset * 2, h - inset * 2, 0.45 * unit), fill: color(brand.secondary, "#a3824a") });
    const inner = inset + 1.1 * unit;
    shapes.push({ kind: "path", d: framePath(inner, inner, w - inner * 2, h - inner * 2, 0.18 * unit), fill: color(brand.secondary, "#a3824a") });
  }
  if (template === "noir") {
    const r = Math.max(w, h);
    for (const [k, amount] of [
      [0.62, 0.1],
      [0.46, 0.16],
      [0.3, 0.24],
    ] as const)
      shapes.push({ kind: "path", d: circlePath(w * 0.5, h * 0.42, r * k), fill: shade(primary, NOIR, amount) });
    shapes.push({ kind: "path", d: circlePath(w * 0.92, h * 0.06, r * 0.18), fill: shade(accent, NOIR, 0.14) });
  }
  if (template === "cafe") {
    shapes.push({ kind: "path", d: circlePath(w * 0.95, h * 0.04, Math.min(w, h) * 0.32), fill: tint(primary, 0.16) });
    shapes.push({ kind: "path", d: circlePath(w * 0.04, h * 0.97, Math.min(w, h) * 0.26), fill: tint(accent, 0.22) });
  }

  if (landscape) {
    const qrX = margin;
    const qrY = margin + (contentH - qrSize) / 2;
    if (template === "modern") shapes.push({ kind: "path", d: roundedRectPath(-bleed, h - 2.4 * unit, w + bleed * 2, 2.4 * unit + bleed), fill: primary });
    if (template === "dark") shapes.push({ kind: "path", d: roundedRectPath(margin + qrSize + 2.4 * unit, margin, 0.5 * unit, contentH), fill: accentOnDark(accent) });
    if (template === "wave") {
      const edge = qrX + qrSize * 0.55;
      shapes.push({ kind: "path", d: `M${r3(-bleed)} ${r3(-bleed)}H${r3(edge)}C${r3(edge + 6 * unit)} ${r3(h * 0.3)} ${r3(edge - 6 * unit)} ${r3(h * 0.7)} ${r3(edge)} ${r3(h + bleed)}H${r3(-bleed)}Z`, fill: primary });
    }
    drawQr(qrX, qrY);
    const colX = landscapeColX;
    const colW = textColumnW;
    const rows = [...header, cta, table, ...info, ...powered].map((row) => (template === "modern" && row.kind === "text" && row.role === "name" ? { ...row, fill: palette.text } : row));
    const total = sumRows(rows) + (rows.length - 1) * gap;
    let y = margin + Math.max(0, (contentH - total) / 2);
    for (const row of rows) {
      drawRow(row, colX, y, "left", colW);
      y += row.height + gap;
    }
  } else {
    const cx = w / 2;
    // Masa Kartı: masa adı en üstte (uzaktan okunur); işletme adı küçük, altta.
    const topRows = template === "tableCard" ? [...header.filter((r) => r.kind === "logo"), table] : header;
    const bottomRows = template === "tableCard" ? [cta, ...header.filter((r) => r.kind === "text"), ...info] : [cta, table, ...info];
    const total = sumRows(topRows) + Math.max(0, topRows.length - 1) * gap + (topRows.length ? qrGap : 0) + qrSize + qrGap + sumRows(bottomRows) + (bottomRows.length - 1) * gap;
    const poweredH = powered.length ? powered[0]!.height : 0;
    const available = contentH - (poweredH ? poweredH + gap : 0);
    let y = margin + Math.max(0, (available - total) / 2);

    if (template === "modern") {
      const headerBottom = topRows.length ? y + sumRows(topRows) + (topRows.length - 1) * gap + qrGap * 0.55 : margin + 1.2 * unit;
      shapes.push({ kind: "path", d: roundedRectPath(-bleed, -bleed, w + bleed * 2, headerBottom + bleed), fill: primary });
      if (!topRows.length) y = Math.max(y, headerBottom + qrGap);
    }
    if (template === "wave") {
      const qrTop = y + sumRows(topRows) + Math.max(0, topRows.length - 1) * gap + (topRows.length ? qrGap : 0);
      const waveY = qrTop + qrSize * 0.42;
      shapes.push({
        kind: "path",
        d: `M${r3(-bleed)} ${r3(-bleed)}H${r3(w + bleed)}V${r3(waveY - 4 * unit)}C${r3(w * 0.7)} ${r3(waveY + 5 * unit)} ${r3(w * 0.32)} ${r3(waveY - 7 * unit)} ${r3(-bleed)} ${r3(waveY + 2 * unit)}Z`,
        fill: primary,
      });
    }
    for (const row of topRows) {
      drawRow(row, cx, y, "center", contentW);
      y += row.height + gap;
    }
    if (topRows.length) y += qrGap - gap;
    drawQr(cx - qrSize / 2, y);
    y += qrSize + qrGap;
    if (template === "dark") {
      shapes.push({ kind: "path", d: roundedRectPath(cx - 4 * unit, y - qrGap * 0.55, 8 * unit, 0.45 * unit, 0.22 * unit), fill: accentOnDark(accent) });
      y += 0.6 * unit;
    }
    for (const row of bottomRows) {
      drawRow(row, cx, y, "center", contentW);
      y += row.height + gap;
    }
    if (powered.length) drawRow(powered[0]!, cx, h - margin - poweredH, "center", contentW);
  }

  return {
    width: w,
    height: h,
    bleed,
    shapes,
    qr: { sizeMm: qrSize, moduleMm, colorsForced: qrColors.forced && options.qrColor === "brand" },
    warnings: [...new Set(warnings)],
    title: `${brand.name} — ${content.tableName}`,
  };
}

/** Koyu zeminde vurgu rengi: görünür değilse nötr açık gri. */
function accentOnDark(accent: string, base = "#101114"): string {
  return contrastRatio(accent, base) >= 3 ? accent : "#d4d4d8";
}

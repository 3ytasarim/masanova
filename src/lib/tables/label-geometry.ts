/**
 * Etiket ölçüleri — tüm baskı ölçüleri MİLİMETRE. PDF'e çevirirken 1 mm = 72 / 25,4 pt.
 * Etiketler hiçbir zaman sessizce ölçeklenmez: A4 yerleşimi sığmıyorsa ya da verimsizse açık uyarı üretilir.
 */

export const MM_TO_PT = 72 / 25.4;
export const BLEED_MM = 3;
export const LABEL_MIN_MM = 40;
export const LABEL_MAX_WIDTH_MM = 210;
export const LABEL_MAX_HEIGHT_MM = 297;
/** Bu boyutun altındaki QR'lar masa mesafesinden güvenilir okunmayabilir. */
export const QR_MIN_PRINT_MM = 20;
/** Raster görseller için hedef çözünürlük. */
export const PRINT_DPI = 300;

export const A4_MM = { width: 210, height: 297 } as const;
/** Yazıcıların basamadığı kenar payı. */
export const SHEET_MARGIN_MM = 8;
/** Etiketler arası boşluk — kesim işaretleri bu boşluğa çizilir. */
export const SHEET_GAP_MM = 6;

export const LABEL_SIZE_PRESETS = {
  "50x50": { width: 50, height: 50, label: "5 × 5 cm" },
  "60x60": { width: 60, height: 60, label: "6 × 6 cm" },
  "70x70": { width: 70, height: 70, label: "7 × 7 cm" },
  "80x50": { width: 80, height: 50, label: "8 × 5 cm" },
  a6: { width: 105, height: 148, label: "A6 (10,5 × 14,8 cm)" },
} as const;

export type LabelSizePreset = keyof typeof LABEL_SIZE_PRESETS;
export const LABEL_SIZE_PRESET_KEYS = Object.keys(LABEL_SIZE_PRESETS) as LabelSizePreset[];

export const mmToPt = (mm: number) => mm * MM_TO_PT;

/** Kesim çizgisinden içeri güvenli alan (metin/QR bu alanın dışına taşmaz). */
export function safeMarginMm(width: number, height: number): number {
  return Math.min(8, Math.max(3, Math.round(Math.min(width, height) * 0.07 * 2) / 2));
}

/** Belirli fiziksel boyutta 300 DPI için gereken piksel. */
export function pixelsForPrint(mm: number, dpi = PRINT_DPI): number {
  return Math.ceil((mm / 25.4) * dpi);
}

export type SheetLayout = {
  columns: number;
  rows: number;
  perPage: number;
  pages: number;
  /** Her etiketin sayfadaki sol-üst köşesi (mm, sayfa sol-üstünden). */
  positions: { x: number; y: number }[];
  /** Etiket alanının sayfa alanına oranı (0–1). */
  utilization: number;
  warning: string | null;
};

/**
 * A4 yerleşimi: kenar payı ve aralıkla sığan tam sütun × satır sayısı; ızgara sayfada ortalanır.
 * Etiket boyutu asla değiştirilmez.
 */
export function computeSheetLayout(
  label: { width: number; height: number },
  count: number,
  sheet: { width: number; height: number } = A4_MM,
  margin = SHEET_MARGIN_MM,
  gap = SHEET_GAP_MM,
): SheetLayout {
  const usableW = sheet.width - margin * 2;
  const usableH = sheet.height - margin * 2;
  const columns = label.width > usableW ? 0 : Math.floor((usableW + gap) / (label.width + gap));
  const rows = label.height > usableH ? 0 : Math.floor((usableH + gap) / (label.height + gap));
  const perPage = columns * rows;

  if (perPage === 0) {
    return {
      columns: 0,
      rows: 0,
      perPage: 0,
      pages: 0,
      positions: [],
      utilization: 0,
      warning: `${fmt(label.width)} × ${fmt(label.height)} mm etiket, ${margin} mm kenar payıyla A4 sayfaya sığmıyor. Daha küçük bir boyut seçin ya da tek etiket PDF'i indirin.`,
    };
  }

  const gridW = columns * label.width + (columns - 1) * gap;
  const gridH = rows * label.height + (rows - 1) * gap;
  const offsetX = (sheet.width - gridW) / 2;
  const offsetY = (sheet.height - gridH) / 2;
  const positions: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) positions.push({ x: offsetX + c * (label.width + gap), y: offsetY + r * (label.height + gap) });
  }

  const utilization = (perPage * label.width * label.height) / (sheet.width * sheet.height);
  const warning =
    utilization < 0.4
      ? `Bu boyut A4'e verimsiz yerleşiyor: sayfa başına ${perPage} etiket (${columns} × ${rows}), kâğıdın yalnızca %${Math.round(utilization * 100)}'i kullanılıyor. Etiketler gerçek ölçüsünde basılır; ölçeklenmez.`
      : null;

  return { columns, rows, perPage, pages: count > 0 ? Math.ceil(count / perPage) : 0, positions, utilization, warning };
}

function fmt(mm: number): string {
  return Number.isInteger(mm) ? String(mm) : mm.toFixed(1).replace(".", ",");
}

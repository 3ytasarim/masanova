import "server-only";
import QRCode from "qrcode";

/**
 * QR üretimi — tamamen yerel (harici QR API'si yok). Hata düzeltme "H" (~%30): basılı etiketlerde çizik,
 * leke ve parlamaya dayanıklı. Sessiz bölge 4 modül (standart). QR yalnızca son public adresi kodlar;
 * izleme parametresi eklenmez.
 */
export const QR_ERROR_CORRECTION = "H" as const;
export const QR_QUIET_ZONE_MODULES = 4;

export type QrMatrix = { size: number; isDark: (row: number, col: number) => boolean; version: number };

export function createQrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const { size, data } = qr.modules;
  return { size, version: qr.version, isDark: (row, col) => data[row * size + col] === 1 };
}

/**
 * Koyu modüller → tek SVG yolu (yatay ardışık modüller birleştirilir). Koordinatlar: (x, y) sol-üst,
 * `module` bir modülün kenarı. Sessiz bölge çağıranın plakasındadır (burada yalnızca veri modülleri).
 */
export function qrModulesPath(matrix: QrMatrix, x: number, y: number, module: number): string {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  let d = "";
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.isDark(row, col)) col++;
      const left = r(x + start * module);
      const top = r(y + row * module);
      const right = r(x + col * module);
      const bottom = r(y + (row + 1) * module);
      d += `M${left} ${top}H${right}V${bottom}H${left}Z`;
    }
  }
  return d;
}

/** Yalnızca QR (sessiz bölge dahil) — vektör SVG, siyah/beyaz. */
export function qrSvg(text: string, title: string): string {
  const matrix = createQrMatrix(text);
  const total = matrix.size + QR_QUIET_ZONE_MODULES * 2;
  const path = qrModulesPath(matrix, QR_QUIET_ZONE_MODULES, QR_QUIET_ZONE_MODULES, 1);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="1024" height="1024" shape-rendering="crispEdges" role="img">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect width="${total}" height="${total}" fill="#ffffff"/>`,
    `<path d="${path}" fill="#000000"/>`,
    `</svg>`,
  ].join("");
}

/** Yalnızca QR — PNG (1200 px; 5 cm'de ~600 DPI). */
export function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    errorCorrectionLevel: QR_ERROR_CORRECTION,
    margin: QR_QUIET_ZONE_MODULES,
    width: 1200,
    color: { dark: "#000000ff", light: "#ffffffff" },
    type: "png",
  });
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

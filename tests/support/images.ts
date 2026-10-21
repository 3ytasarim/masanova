import { crc32 } from "node:zlib";
import sharp from "sharp";

/** Deterministik test görselleri (ikili dosya depoya girmez; her koşuda üretilir). */
export function solid(width: number, height: number, color = { r: 200, g: 80, b: 40 }, format: "jpeg" | "png" | "webp" = "jpeg"): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: color } });
  return (format === "jpeg" ? base.jpeg({ quality: 85 }) : format === "png" ? base.png() : base.webp()).toBuffer();
}

/** Şeffaf PNG (logo). */
export function transparentPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0 } } })
    .composite([{ input: { create: { width: Math.floor(width / 2), height: Math.floor(height / 2), channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } }, gravity: "centre" }])
    .png()
    .toBuffer();
}

/** EXIF içinde GPS konumu ve yön (6 = 90° saat yönü) taşıyan JPEG — "müşteri telefonu fotoğrafı". */
export function jpegWithGps(width: number, height: number, orientation = 1): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 160, b: 90 } } })
    .jpeg()
    .withMetadata({ orientation })
    .withExifMerge({ IFD0: { Make: "TestPhone", Model: "GPS-1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "29/1 0/1 0/1" } })
    .toBuffer();
}

/** İki kareli hareketli WebP. */
export async function animatedWebp(): Promise<Buffer> {
  const a = await solid(64, 64, { r: 255, g: 0, b: 0 }, "png");
  const b = await solid(64, 64, { r: 0, g: 0, b: 255 }, "png");
  return sharp([a, b], { join: { animated: true } }).webp({ loop: 0 }).toBuffer();
}

/** Başlığı 100000 × 100000 diyen PNG (görüntü bombası) — gerçek piksel verisi yok, yalnızca geçerli IHDR. */
export function pngBombHeader(width = 100_000, height = 100_000): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 2; // RGB
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])), chunk("IEND", Buffer.alloc(0))]);
}

/** JPEG imzasıyla başlayan ama görüntü olmayan bayt dizisi. */
export function fakeJpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("this is not really an image — arbitrary bytes ".repeat(40))]);
}

/** "fotograf.jpg" adı verilmiş Windows çalıştırılabilir dosyası (MZ başlığı). */
export function exeBytes(): Buffer {
  return Buffer.concat([Buffer.from("MZ"), Buffer.alloc(510, 0x90)]);
}

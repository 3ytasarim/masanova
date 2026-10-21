import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Yükleme kökü yazılabilir mi: klasörü oluşturur (yoksa), küçük bir geçici dosya yazıp siler. Yol / hata ayrıntısı
 * dışarı verilmez. Açılış denetimi ve sağlık uçları kullanır.
 */
export async function probeWritable(dir: string): Promise<boolean> {
  const probe = path.join(/* turbopackIgnore: true */ dir, `.probe-${randomBytes(6).toString("hex")}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(probe, "ok");
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isValidAssetPrefix, isValidStorageKey } from "@/server/media/keys";
import type { ImageStorageProvider, StoredObjectMetadata } from "@/server/media/storage/types";

const CONTENT_TYPES: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg" };

export class StorageKeyError extends Error {
  constructor() {
    super("Geçersiz depolama anahtarı.");
    this.name = "StorageKeyError";
  }
}

/**
 * Yerel disk sağlayıcısı. Kök (UPLOAD_ROOT) kaynak kodun DIŞINDA olmalı (üretim: /var/lib/masanova/uploads) — yeniden
 * dağıtım / derleme yüklemeleri silmez. Güvenlik:
 * - Anahtar katı biçim denetiminden geçer (yalnızca sunucunun ürettiği desen); "..", mutlak yol, ters bölü reddedilir.
 * - Çözülen yol kökün İÇİNDE kalmalı (ikinci savunma hattı).
 * - Yazma atomik: geçici dosya → rename; var olan anahtarın üzerine yazılmaz.
 */
export class LocalImageStorageProvider implements ImageStorageProvider {
  readonly id = "local" as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly publicBaseUrl = "/media",
  ) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    if (!isValidStorageKey(key)) throw new StorageKeyError();
    const full = path.resolve(this.root, ...key.split("/"));
    if (!full.startsWith(this.root + path.sep)) throw new StorageKeyError();
    return full;
  }

  async put(key: string, data: Buffer, options: { contentType: string }): Promise<void> {
    const full = this.resolve(key);
    const ext = key.slice(key.lastIndexOf(".") + 1);
    if (CONTENT_TYPES[ext] !== options.contentType) throw new StorageKeyError();
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(tmp, data, { flag: "wx", mode: 0o640 });
    try {
      // Var olan dosyanın üzerine yazma: link başarısızsa (EEXIST) anahtar zaten kullanımda.
      await fs.link(tmp, full);
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    const full = this.resolve(key);
    try {
      const data = await fs.readFile(full);
      return { data, contentType: CONTENT_TYPES[key.slice(key.lastIndexOf(".") + 1)]! };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    await fs.unlink(full).catch((error) => {
      if (!isNotFound(error)) throw error;
    });
    // Varlık klasörü boşaldıysa kaldır (kiracı / tür klasörleri kalır).
    await fs.rmdir(path.dirname(full)).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.getMetadata(key)) !== null;
  }

  async getMetadata(key: string): Promise<StoredObjectMetadata | null> {
    const full = this.resolve(key);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) return null;
      return { size: stat.size, contentType: CONTENT_TYPES[key.slice(key.lastIndexOf(".") + 1)]!, modifiedAt: stat.mtime };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  getPublicUrl(key: string): string {
    if (!isValidStorageKey(key)) throw new StorageKeyError();
    return `${this.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
  }

  async *listAssetPrefixes(): AsyncIterable<{ prefix: string; modifiedAt: Date }> {
    const tenantsDir = path.join(this.root, "tenants");
    for (const tenant of await readDirSafe(tenantsDir)) {
      for (const folder of await readDirSafe(path.join(tenantsDir, tenant))) {
        for (const asset of await readDirSafe(path.join(tenantsDir, tenant, folder))) {
          const prefix = `tenants/${tenant}/${folder}/${asset}`;
          if (!isValidAssetPrefix(prefix)) continue;
          const stat = await fs.stat(path.join(tenantsDir, tenant, folder, asset)).catch(() => null);
          if (stat?.isDirectory()) yield { prefix, modifiedAt: stat.mtime };
        }
      }
    }
  }

  /** Yetim temizliği: varlık klasörünü ve içindeki çıktıları siler (yalnızca geçerli önek). */
  async deletePrefix(prefix: string): Promise<void> {
    if (!isValidAssetPrefix(prefix)) throw new StorageKeyError();
    const full = path.resolve(this.root, ...prefix.split("/"));
    if (!full.startsWith(this.root + path.sep)) throw new StorageKeyError();
    await fs.rm(full, { recursive: true, force: true });
  }
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT";
}

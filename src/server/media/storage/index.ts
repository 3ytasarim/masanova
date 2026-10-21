import "server-only";
import { getServerEnv } from "@/lib/env";
import { log } from "@/lib/observability/logger";
import { LocalImageStorageProvider } from "@/server/media/storage/local";
import { resolveUploadRoot } from "@/server/media/storage/root";
import type { ImageStorageProvider } from "@/server/media/storage/types";

export type { ImageStorageProvider } from "@/server/media/storage/types";
export { resolveUploadRoot } from "@/server/media/storage/root";

let instance: ImageStorageProvider | null = null;

export function getImageStorage(): ImageStorageProvider {
  if (instance) return instance;
  const env = getServerEnv();
  if (env.NODE_ENV === "production" && !env.UPLOAD_ROOT) {
    log.warn("media.upload_root_default", { note: "UPLOAD_ROOT ayarlı değil; geliştirme varsayılanı kullanılıyor — üretimde uygulama dışında kalıcı bir klasör ayarlayın." });
  }
  instance = new LocalImageStorageProvider(resolveUploadRoot(env.UPLOAD_ROOT), env.UPLOAD_PUBLIC_BASE_URL || "/media");
  return instance;
}

/** Testler: geçici klasöre yazan sağlayıcı. */
export function setImageStorageForTests(provider: ImageStorageProvider | null): void {
  instance = provider;
}

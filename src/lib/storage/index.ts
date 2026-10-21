import { externalUrlProvider } from "@/lib/storage/external-url-provider";
import type { StorageProvider, StorageProviderId } from "@/lib/storage/types";

export type { StorageProvider, StorageProviderId, StoredObjectRef } from "@/lib/storage/types";

/**
 * Sağlayıcı kaydı. Hetzner Object Storage (S3 uyumlu) eklendiğinde: HetznerStorageProvider burada kaydedilir
 * ve ACTIVE_UPLOAD_PROVIDER değiştirilir; mevcut kayıtlar kendi `provider` alanlarıyla çözülmeye devam eder.
 */
const PROVIDERS: Partial<Record<StorageProviderId, StorageProvider>> = {
  external: externalUrlProvider,
};

/** Yeni görsellerin hangi sağlayıcıyla saklanacağı (nesne depolama yapılandırılana kadar harici URL). */
export const ACTIVE_IMAGE_PROVIDER: StorageProviderId = "external";

export function getStorageProvider(id: string): StorageProvider | null {
  return PROVIDERS[id as StorageProviderId] ?? null;
}

/** Saklanan referansı tarayıcı URL'ine çevirir; bilinmeyen sağlayıcıda null (görsel gösterilmez). */
export function resolveImageUrl(provider: string, key: string): string | null {
  return getStorageProvider(provider)?.publicUrl(key) ?? null;
}

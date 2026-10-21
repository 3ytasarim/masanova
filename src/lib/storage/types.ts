/**
 * Görsel/dosya depolama soyutlaması. Veritabanı yalnızca REFERANS tutar: { provider, key }.
 * Görsel verisi (blob / base64) asla PostgreSQL'e yazılmaz.
 *
 * Bugün:   "external" → key = doğrulanmış https URL (işletmenin kendi barındırdığı görsel).
 * Gelecek: "hetzner"  → key = nesne anahtarı (tenants/<tenantId>/products/<uuid>.webp); public URL
 *          sağlayıcı tarafından üretilir, yükleme imzalı URL ile doğrudan nesne depolamaya yapılır.
 * Geçiş: mevcut "external" kayıtlar olduğu gibi çalışmaya devam eder; yeni yüklemeler yeni sağlayıcıya gider.
 */
export type StorageProviderId = "external" | "hetzner";

export type StoredObjectRef = { provider: StorageProviderId; key: string };

export interface StorageProvider {
  readonly id: StorageProviderId;
  /** Tarayıcıda gösterilecek public URL. */
  publicUrl(key: string): string;
  /** Kayıt öncesi anahtarı doğrular/normalize eder; geçersizse hata mesajı döner. */
  validateKey(key: string): { ok: true; key: string } | { ok: false; error: string };
  /** Doğrudan yükleme desteği (imzalı URL). External sağlayıcıda yok. */
  readonly supportsUpload: boolean;
}

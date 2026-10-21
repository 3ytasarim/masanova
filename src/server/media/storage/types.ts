/**
 * Görsel depolama soyutlaması (Sprint 13). Uygulama mantığı (ürün / kategori / tema) yalnızca bu arayüzü ve
 * sağlayıcıdan bağımsız ANAHTARLARI bilir ("tenants/<kiracı-anahtarı>/products/<rastgele>/md.webp"); disk yolu ya da
 * kova adı asla veritabanına ve tarayıcıya gitmez.
 *
 * Bugün: LocalImageStorageProvider (UPLOAD_ROOT altında dosya sistemi).
 * Gelecek: S3ImageStorageProvider (Hetzner Object Storage / AWS S3 / Cloudflare R2) — aynı anahtarlar nesne anahtarı
 * olur; MediaAsset.storageProvider alanı her kaydın hangi sağlayıcıda olduğunu söyler (karışık geçiş dönemi mümkün).
 */
export type ImageStorageProviderId = "local";

export type StoredObjectMetadata = { size: number; contentType: string; modifiedAt: Date };

export interface ImageStorageProvider {
  readonly id: ImageStorageProviderId;
  /** Yazar. Anahtar zaten varsa HATA (üzerine yazma yok — her sürüm yeni anahtar alır, önbellek bayatlamaz). */
  put(key: string, data: Buffer, options: { contentType: string }): Promise<void>;
  /** Okur (sunum / etiket PDF'i). Yoksa null. */
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  /** Siler; yoksa sessizce geçer (idempotent). */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getMetadata(key: string): Promise<StoredObjectMetadata | null>;
  /** Tarayıcının kullanacağı adres (göreli "/media/…" ya da UPLOAD_PUBLIC_BASE_URL / CDN). */
  getPublicUrl(key: string): string;
  /** Önek altındaki varlık klasörleri (yetim temizliği için): "tenants/x/products/abc" + son değişiklik. */
  listAssetPrefixes(): AsyncIterable<{ prefix: string; modifiedAt: Date }>;
  /** Yetim temizliği: bir varlığın tüm çıktılarını siler (yalnızca geçerli varlık öneki). */
  deletePrefix(prefix: string): Promise<void>;
}

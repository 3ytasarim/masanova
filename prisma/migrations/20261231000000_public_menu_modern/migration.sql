-- Modern (koyu) QR menü düzeni + "Google Yorum" bağlantısı.
ALTER TYPE "PublicMenuStyle" ADD VALUE IF NOT EXISTS 'MODERN';

ALTER TABLE "public_menu_settings" ADD COLUMN IF NOT EXISTS "google_review_url" TEXT;

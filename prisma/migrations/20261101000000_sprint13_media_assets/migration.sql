-- Sprint 13: yüklenen görseller (MediaAsset) + geriye uyumlu referanslar (harici URL alanları korunur).
-- Uygulama: npx prisma db execute --url "$DIRECT_URL" --file <bu dosya>  (ya da baseline sonrası npm run db:deploy)

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('LOGO', 'HERO', 'CATEGORY', 'PRODUCT');

-- AlterTable
ALTER TABLE "menu_categories" ADD COLUMN     "image_asset_id" TEXT;

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "media_asset_id" TEXT;

-- AlterTable
ALTER TABLE "public_menu_settings" ADD COLUMN     "hero_asset_id" TEXT;

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "logo_asset_id" TEXT;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "renditions" JSONB NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_assets_tenant_id_kind_created_at_idx" ON "media_assets"("tenant_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_id_tenant_id_key" ON "media_assets"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_provider_storage_key_key" ON "media_assets"("storage_provider", "storage_key");

-- CreateIndex
CREATE INDEX "product_images_media_asset_id_idx" ON "product_images"("media_asset_id");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_logo_asset_id_tenant_id_fkey" FOREIGN KEY ("logo_asset_id", "tenant_id") REFERENCES "media_assets"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_image_asset_id_tenant_id_fkey" FOREIGN KEY ("image_asset_id", "tenant_id") REFERENCES "media_assets"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_asset_id_tenant_id_fkey" FOREIGN KEY ("media_asset_id", "tenant_id") REFERENCES "media_assets"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public_menu_settings" ADD CONSTRAINT "public_menu_settings_hero_asset_id_tenant_id_fkey" FOREIGN KEY ("hero_asset_id", "tenant_id") REFERENCES "media_assets"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tutarlılık: yönetilen ürün görseli ⇔ media_asset_id dolu (Prisma CHECK kısıtlarını şemada göstermez).
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_consistency_check" CHECK (("storage_provider" = 'media') = ("media_asset_id" IS NOT NULL));

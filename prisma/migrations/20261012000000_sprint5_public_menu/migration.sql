-- Sprint 5: public QR menü sunum ayarları (kiracı başına tek satır; satır yoksa varsayılanlar).
-- CreateEnum
CREATE TYPE "PublicMenuStyle" AS ENUM ('COMPACT', 'VISUAL', 'LUXURY');

-- CreateTable
CREATE TABLE "public_menu_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "style" "PublicMenuStyle" NOT NULL DEFAULT 'VISUAL',
    "welcome_text" TEXT,
    "hero_image_url" TEXT,
    "show_nutrition" BOOLEAN NOT NULL DEFAULT true,
    "show_allergens" BOOLEAN NOT NULL DEFAULT true,
    "show_ingredients" BOOLEAN NOT NULL DEFAULT true,
    "show_preparation_time" BOOLEAN NOT NULL DEFAULT true,
    "show_powered_by" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_menu_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_menu_settings_tenant_id_key" ON "public_menu_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "public_menu_settings" ADD CONSTRAINT "public_menu_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


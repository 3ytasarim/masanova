
-- CreateTable
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_category_translations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_category_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "sku" TEXT,
    "base_price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sold_out" BOOLEAN NOT NULL DEFAULT false,
    "preparation_minutes" INTEGER,
    "calories" INTEGER,
    "protein_grams" INTEGER,
    "carbohydrate_grams" INTEGER,
    "fat_grams" INTEGER,
    "allergens_confirmed_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_translations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'external',
    "storage_key" TEXT NOT NULL,
    "alt_text" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "price_minor" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_translations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variant_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_group_translations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modifier_group_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modifier_group_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifiers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modifier_group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_minor" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_translations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modifier_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modifier_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_modifier_groups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "modifier_group_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_translations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredient_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("product_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "allergens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allergens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergen_translations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "allergen_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allergen_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_allergens" (
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "allergen_id" TEXT NOT NULL,

    CONSTRAINT "product_allergens_pkey" PRIMARY KEY ("product_id","allergen_id")
);

-- CreateTable
CREATE TABLE "dietary_tags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dietary_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dietary_tag_translations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "dietary_tag_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dietary_tag_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_dietary_tags" (
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "dietary_tag_id" TEXT NOT NULL,

    CONSTRAINT "product_dietary_tags_pkey" PRIMARY KEY ("product_id","dietary_tag_id")
);

-- CreateTable
CREATE TABLE "branch_products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "available" BOOLEAN,
    "sold_out" BOOLEAN,
    "price_minor" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_variant_prices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_variant_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_categories_tenant_id_parent_id_sort_order_idx" ON "menu_categories"("tenant_id", "parent_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_tenant_id_slug_key" ON "menu_categories"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_id_tenant_id_key" ON "menu_categories"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "menu_category_translations_tenant_id_idx" ON "menu_category_translations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_category_translations_category_id_locale_key" ON "menu_category_translations"("category_id", "locale");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_id_sort_order_idx" ON "products"("tenant_id", "category_id", "sort_order");

-- CreateIndex
CREATE INDEX "products_tenant_id_archived_at_updated_at_idx" ON "products"("tenant_id", "archived_at", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_slug_key" ON "products"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_tenant_id_key" ON "products"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "product_translations_tenant_id_idx" ON "product_translations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_translations_product_id_locale_key" ON "product_translations"("product_id", "locale");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_images_tenant_id_idx" ON "product_images"("tenant_id");

-- CreateIndex
CREATE INDEX "product_variants_tenant_id_idx" ON "product_variants"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_name_key" ON "product_variants"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_id_tenant_id_key" ON "product_variants"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "product_variant_translations_tenant_id_idx" ON "product_variant_translations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_translations_variant_id_locale_key" ON "product_variant_translations"("variant_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_groups_tenant_id_name_key" ON "modifier_groups"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_groups_id_tenant_id_key" ON "modifier_groups"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "modifier_group_translations_tenant_id_idx" ON "modifier_group_translations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_group_translations_modifier_group_id_locale_key" ON "modifier_group_translations"("modifier_group_id", "locale");

-- CreateIndex
CREATE INDEX "modifiers_tenant_id_idx" ON "modifiers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifiers_modifier_group_id_name_key" ON "modifiers"("modifier_group_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "modifiers_id_tenant_id_key" ON "modifiers"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "modifier_translations_tenant_id_idx" ON "modifier_translations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "modifier_translations_modifier_id_locale_key" ON "modifier_translations"("modifier_id", "locale");

-- CreateIndex
CREATE INDEX "product_modifier_groups_tenant_id_idx" ON "product_modifier_groups"("tenant_id");

-- CreateIndex
CREATE INDEX "product_modifier_groups_modifier_group_id_idx" ON "product_modifier_groups"("modifier_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_modifier_groups_product_id_modifier_group_id_key" ON "product_modifier_groups"("product_id", "modifier_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_tenant_id_name_key" ON "ingredients"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_id_tenant_id_key" ON "ingredients"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "ingredient_translations_tenant_id_idx" ON "ingredient_translations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_translations_ingredient_id_locale_key" ON "ingredient_translations"("ingredient_id", "locale");

-- CreateIndex
CREATE INDEX "product_ingredients_tenant_id_idx" ON "product_ingredients"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "allergens_tenant_id_code_key" ON "allergens"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "allergen_translations_allergen_id_locale_key" ON "allergen_translations"("allergen_id", "locale");

-- CreateIndex
CREATE INDEX "product_allergens_tenant_id_idx" ON "product_allergens"("tenant_id");

-- CreateIndex
CREATE INDEX "product_allergens_allergen_id_idx" ON "product_allergens"("allergen_id");

-- CreateIndex
CREATE UNIQUE INDEX "dietary_tags_tenant_id_code_key" ON "dietary_tags"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "dietary_tag_translations_dietary_tag_id_locale_key" ON "dietary_tag_translations"("dietary_tag_id", "locale");

-- CreateIndex
CREATE INDEX "product_dietary_tags_tenant_id_idx" ON "product_dietary_tags"("tenant_id");

-- CreateIndex
CREATE INDEX "product_dietary_tags_dietary_tag_id_idx" ON "product_dietary_tags"("dietary_tag_id");

-- CreateIndex
CREATE INDEX "branch_products_tenant_id_product_id_idx" ON "branch_products"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_products_branch_id_product_id_key" ON "branch_products"("branch_id", "product_id");

-- CreateIndex
CREATE INDEX "branch_variant_prices_tenant_id_variant_id_idx" ON "branch_variant_prices"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_variant_prices_branch_id_variant_id_key" ON "branch_variant_prices"("branch_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_tenant_id_key" ON "branches"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "menu_categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_category_translations" ADD CONSTRAINT "menu_category_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_category_translations" ADD CONSTRAINT "menu_category_translations_category_id_tenant_id_fkey" FOREIGN KEY ("category_id", "tenant_id") REFERENCES "menu_categories"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_tenant_id_fkey" FOREIGN KEY ("category_id", "tenant_id") REFERENCES "menu_categories"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_translations" ADD CONSTRAINT "product_variant_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_translations" ADD CONSTRAINT "product_variant_translations_variant_id_tenant_id_fkey" FOREIGN KEY ("variant_id", "tenant_id") REFERENCES "product_variants"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_group_translations" ADD CONSTRAINT "modifier_group_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_group_translations" ADD CONSTRAINT "modifier_group_translations_modifier_group_id_tenant_id_fkey" FOREIGN KEY ("modifier_group_id", "tenant_id") REFERENCES "modifier_groups"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_modifier_group_id_tenant_id_fkey" FOREIGN KEY ("modifier_group_id", "tenant_id") REFERENCES "modifier_groups"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_translations" ADD CONSTRAINT "modifier_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_translations" ADD CONSTRAINT "modifier_translations_modifier_id_tenant_id_fkey" FOREIGN KEY ("modifier_id", "tenant_id") REFERENCES "modifiers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_modifier_group_id_tenant_id_fkey" FOREIGN KEY ("modifier_group_id", "tenant_id") REFERENCES "modifier_groups"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_translations" ADD CONSTRAINT "ingredient_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_translations" ADD CONSTRAINT "ingredient_translations_ingredient_id_tenant_id_fkey" FOREIGN KEY ("ingredient_id", "tenant_id") REFERENCES "ingredients"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_ingredient_id_tenant_id_fkey" FOREIGN KEY ("ingredient_id", "tenant_id") REFERENCES "ingredients"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergens" ADD CONSTRAINT "allergens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergen_translations" ADD CONSTRAINT "allergen_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergen_translations" ADD CONSTRAINT "allergen_translations_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_allergens" ADD CONSTRAINT "product_allergens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_allergens" ADD CONSTRAINT "product_allergens_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_allergens" ADD CONSTRAINT "product_allergens_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dietary_tags" ADD CONSTRAINT "dietary_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dietary_tag_translations" ADD CONSTRAINT "dietary_tag_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dietary_tag_translations" ADD CONSTRAINT "dietary_tag_translations_dietary_tag_id_fkey" FOREIGN KEY ("dietary_tag_id") REFERENCES "dietary_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_dietary_tags" ADD CONSTRAINT "product_dietary_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_dietary_tags" ADD CONSTRAINT "product_dietary_tags_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_dietary_tags" ADD CONSTRAINT "product_dietary_tags_dietary_tag_id_fkey" FOREIGN KEY ("dietary_tag_id") REFERENCES "dietary_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_products" ADD CONSTRAINT "branch_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_products" ADD CONSTRAINT "branch_products_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_products" ADD CONSTRAINT "branch_products_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_variant_prices" ADD CONSTRAINT "branch_variant_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_variant_prices" ADD CONSTRAINT "branch_variant_prices_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_variant_prices" ADD CONSTRAINT "branch_variant_prices_variant_id_tenant_id_fkey" FOREIGN KEY ("variant_id", "tenant_id") REFERENCES "product_variants"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Referans veri: platform standart alerjenleri ve diyet etiketleri ─────────
-- tenant_id NULL → tüm kiracılar için ortak, salt okunur. Kimlikler deterministik (yeniden çalıştırmada çakışmaz).
-- Görünen adlar çeviri tablosundan okunur (tr/en/de/ar); `name` kanonik yedek addır (İngilizce).

INSERT INTO "allergens" ("id", "tenant_id", "code", "name", "active", "created_at", "updated_at") VALUES
  ('sys_alg_gluten',      NULL, 'gluten',      'Gluten',        true, now(), now()),
  ('sys_alg_crustaceans', NULL, 'crustaceans', 'Crustaceans',   true, now(), now()),
  ('sys_alg_eggs',        NULL, 'eggs',        'Eggs',          true, now(), now()),
  ('sys_alg_fish',        NULL, 'fish',        'Fish',          true, now(), now()),
  ('sys_alg_peanuts',     NULL, 'peanuts',     'Peanuts',       true, now(), now()),
  ('sys_alg_soy',         NULL, 'soy',         'Soy',           true, now(), now()),
  ('sys_alg_milk',        NULL, 'milk',        'Milk',          true, now(), now()),
  ('sys_alg_nuts',        NULL, 'nuts',        'Tree nuts',     true, now(), now()),
  ('sys_alg_celery',      NULL, 'celery',      'Celery',        true, now(), now()),
  ('sys_alg_mustard',     NULL, 'mustard',     'Mustard',       true, now(), now()),
  ('sys_alg_sesame',      NULL, 'sesame',      'Sesame',        true, now(), now()),
  ('sys_alg_sulphites',   NULL, 'sulphites',   'Sulphites',     true, now(), now()),
  ('sys_alg_lupin',       NULL, 'lupin',       'Lupin',         true, now(), now()),
  ('sys_alg_molluscs',    NULL, 'molluscs',    'Molluscs',      true, now(), now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "allergen_translations" ("id", "tenant_id", "allergen_id", "locale", "name", "updated_at")
SELECT a.id || '_' || t.locale, NULL, a.id, t.locale, t.name, now()
FROM (VALUES
  ('sys_alg_gluten', 'tr', 'Gluten'), ('sys_alg_gluten', 'en', 'Gluten'), ('sys_alg_gluten', 'de', 'Gluten'), ('sys_alg_gluten', 'ar', 'الغلوتين'),
  ('sys_alg_crustaceans', 'tr', 'Kabuklu deniz ürünleri'), ('sys_alg_crustaceans', 'en', 'Crustaceans'), ('sys_alg_crustaceans', 'de', 'Krebstiere'), ('sys_alg_crustaceans', 'ar', 'القشريات'),
  ('sys_alg_eggs', 'tr', 'Yumurta'), ('sys_alg_eggs', 'en', 'Eggs'), ('sys_alg_eggs', 'de', 'Eier'), ('sys_alg_eggs', 'ar', 'البيض'),
  ('sys_alg_fish', 'tr', 'Balık'), ('sys_alg_fish', 'en', 'Fish'), ('sys_alg_fish', 'de', 'Fisch'), ('sys_alg_fish', 'ar', 'السمك'),
  ('sys_alg_peanuts', 'tr', 'Yer fıstığı'), ('sys_alg_peanuts', 'en', 'Peanuts'), ('sys_alg_peanuts', 'de', 'Erdnüsse'), ('sys_alg_peanuts', 'ar', 'الفول السوداني'),
  ('sys_alg_soy', 'tr', 'Soya'), ('sys_alg_soy', 'en', 'Soy'), ('sys_alg_soy', 'de', 'Soja'), ('sys_alg_soy', 'ar', 'الصويا'),
  ('sys_alg_milk', 'tr', 'Süt ve süt ürünleri'), ('sys_alg_milk', 'en', 'Milk'), ('sys_alg_milk', 'de', 'Milch'), ('sys_alg_milk', 'ar', 'الحليب'),
  ('sys_alg_nuts', 'tr', 'Sert kabuklu yemişler'), ('sys_alg_nuts', 'en', 'Tree nuts'), ('sys_alg_nuts', 'de', 'Schalenfrüchte'), ('sys_alg_nuts', 'ar', 'المكسرات'),
  ('sys_alg_celery', 'tr', 'Kereviz'), ('sys_alg_celery', 'en', 'Celery'), ('sys_alg_celery', 'de', 'Sellerie'), ('sys_alg_celery', 'ar', 'الكرفس'),
  ('sys_alg_mustard', 'tr', 'Hardal'), ('sys_alg_mustard', 'en', 'Mustard'), ('sys_alg_mustard', 'de', 'Senf'), ('sys_alg_mustard', 'ar', 'الخردل'),
  ('sys_alg_sesame', 'tr', 'Susam'), ('sys_alg_sesame', 'en', 'Sesame'), ('sys_alg_sesame', 'de', 'Sesam'), ('sys_alg_sesame', 'ar', 'السمسم'),
  ('sys_alg_sulphites', 'tr', 'Kükürt dioksit ve sülfitler'), ('sys_alg_sulphites', 'en', 'Sulphites'), ('sys_alg_sulphites', 'de', 'Sulfite'), ('sys_alg_sulphites', 'ar', 'الكبريتيت'),
  ('sys_alg_lupin', 'tr', 'Acı bakla (lupin)'), ('sys_alg_lupin', 'en', 'Lupin'), ('sys_alg_lupin', 'de', 'Lupinen'), ('sys_alg_lupin', 'ar', 'الترمس'),
  ('sys_alg_molluscs', 'tr', 'Yumuşakçalar'), ('sys_alg_molluscs', 'en', 'Molluscs'), ('sys_alg_molluscs', 'de', 'Weichtiere'), ('sys_alg_molluscs', 'ar', 'الرخويات')
) AS t(allergen_id, locale, name)
JOIN "allergens" a ON a.id = t.allergen_id
ON CONFLICT ("allergen_id", "locale") DO NOTHING;

INSERT INTO "dietary_tags" ("id", "tenant_id", "code", "name", "active", "created_at", "updated_at") VALUES
  ('sys_tag_vegan',               NULL, 'vegan',               'Vegan',                 true, now(), now()),
  ('sys_tag_vegetarian',          NULL, 'vegetarian',          'Vegetarian',            true, now(), now()),
  ('sys_tag_gluten_free',         NULL, 'gluten_free',         'Gluten free',           true, now(), now()),
  ('sys_tag_lactose_free',        NULL, 'lactose_free',        'Lactose free',          true, now(), now()),
  ('sys_tag_spicy',               NULL, 'spicy',               'Spicy',                 true, now(), now()),
  ('sys_tag_halal',               NULL, 'halal',               'Halal',                 true, now(), now()),
  ('sys_tag_popular',             NULL, 'popular',             'Popular',               true, now(), now()),
  ('sys_tag_chef_recommendation', NULL, 'chef_recommendation', 'Chef''s recommendation', true, now(), now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "dietary_tag_translations" ("id", "tenant_id", "dietary_tag_id", "locale", "name", "updated_at")
SELECT d.id || '_' || t.locale, NULL, d.id, t.locale, t.name, now()
FROM (VALUES
  ('sys_tag_vegan', 'tr', 'Vegan'), ('sys_tag_vegan', 'en', 'Vegan'), ('sys_tag_vegan', 'de', 'Vegan'), ('sys_tag_vegan', 'ar', 'نباتي صرف'),
  ('sys_tag_vegetarian', 'tr', 'Vejetaryen'), ('sys_tag_vegetarian', 'en', 'Vegetarian'), ('sys_tag_vegetarian', 'de', 'Vegetarisch'), ('sys_tag_vegetarian', 'ar', 'نباتي'),
  ('sys_tag_gluten_free', 'tr', 'Glutensiz'), ('sys_tag_gluten_free', 'en', 'Gluten free'), ('sys_tag_gluten_free', 'de', 'Glutenfrei'), ('sys_tag_gluten_free', 'ar', 'خالٍ من الغلوتين'),
  ('sys_tag_lactose_free', 'tr', 'Laktozsuz'), ('sys_tag_lactose_free', 'en', 'Lactose free'), ('sys_tag_lactose_free', 'de', 'Laktosefrei'), ('sys_tag_lactose_free', 'ar', 'خالٍ من اللاكتوز'),
  ('sys_tag_spicy', 'tr', 'Acılı'), ('sys_tag_spicy', 'en', 'Spicy'), ('sys_tag_spicy', 'de', 'Scharf'), ('sys_tag_spicy', 'ar', 'حار'),
  ('sys_tag_halal', 'tr', 'Helal'), ('sys_tag_halal', 'en', 'Halal'), ('sys_tag_halal', 'de', 'Halal'), ('sys_tag_halal', 'ar', 'حلال'),
  ('sys_tag_popular', 'tr', 'Popüler'), ('sys_tag_popular', 'en', 'Popular'), ('sys_tag_popular', 'de', 'Beliebt'), ('sys_tag_popular', 'ar', 'الأكثر طلبًا'),
  ('sys_tag_chef_recommendation', 'tr', 'Şefin önerisi'), ('sys_tag_chef_recommendation', 'en', 'Chef''s recommendation'), ('sys_tag_chef_recommendation', 'de', 'Empfehlung des Küchenchefs'), ('sys_tag_chef_recommendation', 'ar', 'توصية الشيف')
) AS t(tag_id, locale, name)
JOIN "dietary_tags" d ON d.id = t.tag_id
ON CONFLICT ("dietary_tag_id", "locale") DO NOTHING;

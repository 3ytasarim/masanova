-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE', 'FREE_ITEM');

-- CreateEnum
CREATE TYPE "PromotionScope" AS ENUM ('ALL', 'PRODUCTS', 'CATEGORIES');

-- CreateEnum
CREATE TYPE "CouponAudience" AS ENUM ('ANYONE', 'IDENTIFIED', 'LOYALTY_MEMBER', 'REPEAT_CUSTOMER');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrderPromotionKind" AS ENUM ('COUPON', 'LOYALTY_REWARD');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "CampaignSegment" AS ENUM ('ALL_OPTED_IN', 'LOYALTY_MEMBERS', 'REPEAT_CUSTOMERS', 'NO_VISIT_30_DAYS', 'HIGH_ORDER_COUNT', 'LANGUAGE_TR', 'LANGUAGE_EN');

-- AlterEnum
ALTER TYPE "LoyaltyEntryType" ADD VALUE 'REVERSAL';

-- AlterTable
ALTER TABLE "loyalty_ledger" ADD COLUMN     "reverses_entry_id" TEXT,
ADD COLUMN     "reward_id" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discount_minor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "code" TEXT NOT NULL,
    "code_normalized" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PromotionType" NOT NULL,
    "value_minor" INTEGER,
    "percentage_bps" INTEGER,
    "max_discount_minor" INTEGER,
    "minimum_order_minor" INTEGER,
    "scope" "PromotionScope" NOT NULL DEFAULT 'ALL',
    "free_product_id" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "days_mask" INTEGER,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER,
    "audience" "CouponAudience" NOT NULL DEFAULT 'ANYONE',
    "status" "CouponStatus" NOT NULL DEFAULT 'INACTIVE',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_products" (
    "coupon_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "coupon_products_pkey" PRIMARY KEY ("coupon_id","product_id")
);

-- CreateTable
CREATE TABLE "coupon_categories" (
    "coupon_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "coupon_categories_pkey" PRIMARY KEY ("coupon_id","category_id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "code_snapshot" TEXT NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_rewards" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "points_cost" INTEGER NOT NULL,
    "reward_type" "PromotionType" NOT NULL,
    "fixed_discount_minor" INTEGER,
    "percentage_bps" INTEGER,
    "max_discount_minor" INTEGER,
    "minimum_order_minor" INTEGER,
    "free_product_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_promotions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "kind" "OrderPromotionKind" NOT NULL,
    "coupon_id" TEXT,
    "reward_id" TEXT,
    "code_snapshot" TEXT,
    "label" TEXT NOT NULL,
    "promotion_type" "PromotionType" NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "points_spent" INTEGER,
    "free_item_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" "CampaignChannel" NOT NULL,
    "segment" "CampaignSegment" NOT NULL,
    "coupon_id" TEXT,
    "message_template" TEXT NOT NULL,
    "audience_snapshot" JSONB,
    "ready_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coupons_tenant_id_status_idx" ON "coupons"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_tenant_id_code_normalized_key" ON "coupons"("tenant_id", "code_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_id_tenant_id_key" ON "coupons"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_tenant_id_coupon_id_created_at_idx" ON "coupon_redemptions"("tenant_id", "coupon_id", "created_at");

-- CreateIndex
CREATE INDEX "coupon_redemptions_tenant_id_customer_id_idx" ON "coupon_redemptions"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_order_id_key" ON "coupon_redemptions"("coupon_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_tenant_id_key" ON "coupon_redemptions"("order_id", "tenant_id");

-- CreateIndex
CREATE INDEX "loyalty_rewards_tenant_id_is_active_idx" ON "loyalty_rewards"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_rewards_id_tenant_id_key" ON "loyalty_rewards"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_promotions_order_id_key" ON "order_promotions"("order_id");

-- CreateIndex
CREATE INDEX "order_promotions_tenant_id_kind_created_at_idx" ON "order_promotions"("tenant_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_promotions_order_id_tenant_id_key" ON "order_promotions"("order_id", "tenant_id");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_status_idx" ON "campaigns"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_reverses_entry_id_key" ON "loyalty_ledger"("reverses_entry_id");

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "loyalty_ledger"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_reward_id_tenant_id_fkey" FOREIGN KEY ("reward_id", "tenant_id") REFERENCES "loyalty_rewards"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_free_product_id_tenant_id_fkey" FOREIGN KEY ("free_product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_coupon_id_tenant_id_fkey" FOREIGN KEY ("coupon_id", "tenant_id") REFERENCES "coupons"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_coupon_id_tenant_id_fkey" FOREIGN KEY ("coupon_id", "tenant_id") REFERENCES "coupons"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_category_id_tenant_id_fkey" FOREIGN KEY ("category_id", "tenant_id") REFERENCES "menu_categories"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_tenant_id_fkey" FOREIGN KEY ("coupon_id", "tenant_id") REFERENCES "coupons"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_free_product_id_tenant_id_fkey" FOREIGN KEY ("free_product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_coupon_id_tenant_id_fkey" FOREIGN KEY ("coupon_id", "tenant_id") REFERENCES "coupons"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_reward_id_tenant_id_fkey" FOREIGN KEY ("reward_id", "tenant_id") REFERENCES "loyalty_rewards"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_coupon_id_tenant_id_fkey" FOREIGN KEY ("coupon_id", "tenant_id") REFERENCES "coupons"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- ─── Sprint 18 bütünlük kısıtları ──────────────────────────────────────────────
-- Sipariş toplamı: toplam = ara toplam − indirim; indirim ≥ 0; toplam asla eksi değil.
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_check" CHECK ("discount_minor" >= 0 AND "total_minor" = "subtotal_minor" - "discount_minor" AND "total_minor" >= 0);

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_rule_check" CHECK (
  "code_normalized" ~ '^[A-Z0-9_-]{3,24}$'
  AND char_length("name") BETWEEN 1 AND 80
  AND ("description" IS NULL OR char_length("description") <= 300)
  AND (
    ("type" = 'FIXED_AMOUNT' AND "value_minor" > 0 AND "percentage_bps" IS NULL AND "free_product_id" IS NULL)
    OR ("type" = 'PERCENTAGE' AND "percentage_bps" BETWEEN 1 AND 10000 AND "value_minor" IS NULL AND "free_product_id" IS NULL)
    OR ("type" = 'FREE_ITEM' AND "free_product_id" IS NOT NULL AND "value_minor" IS NULL AND "percentage_bps" IS NULL)
  )
  AND ("max_discount_minor" IS NULL OR "max_discount_minor" > 0)
  AND ("minimum_order_minor" IS NULL OR "minimum_order_minor" >= 0)
  AND ("usage_limit" IS NULL OR "usage_limit" > 0)
  AND ("per_customer_limit" IS NULL OR "per_customer_limit" > 0)
  AND ("days_mask" IS NULL OR "days_mask" BETWEEN 1 AND 127)
  AND (("start_minute" IS NULL AND "end_minute" IS NULL) OR ("start_minute" BETWEEN 0 AND 1439 AND "end_minute" BETWEEN 1 AND 1440 AND "end_minute" > "start_minute"))
  AND ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at")
);
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_rule_check" CHECK (
  "points_cost" BETWEEN 1 AND 10000000
  AND char_length("name") BETWEEN 1 AND 80
  AND ("description" IS NULL OR char_length("description") <= 300)
  AND (
    ("reward_type" = 'FIXED_AMOUNT' AND "fixed_discount_minor" > 0 AND "percentage_bps" IS NULL AND "free_product_id" IS NULL)
    OR ("reward_type" = 'PERCENTAGE' AND "percentage_bps" BETWEEN 1 AND 10000 AND "fixed_discount_minor" IS NULL AND "free_product_id" IS NULL)
    OR ("reward_type" = 'FREE_ITEM' AND "free_product_id" IS NOT NULL AND "fixed_discount_minor" IS NULL AND "percentage_bps" IS NULL)
  )
  AND ("max_discount_minor" IS NULL OR "max_discount_minor" > 0)
  AND ("minimum_order_minor" IS NULL OR "minimum_order_minor" >= 0)
  AND ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at")
);
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_discount_check" CHECK ("discount_minor" >= 0);
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_check" CHECK (
  "discount_minor" >= 0
  AND (("kind" = 'COUPON' AND "coupon_id" IS NOT NULL AND "reward_id" IS NULL) OR ("kind" = 'LOYALTY_REWARD' AND "reward_id" IS NOT NULL AND "coupon_id" IS NULL AND "points_spent" > 0))
);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_text_check" CHECK (char_length("name") BETWEEN 1 AND 80 AND char_length("message_template") <= 1000);

-- Kupon kullanımı ve sipariş promosyon kopyası değiştirilemez (ekleme-yalnız).
CREATE OR REPLACE FUNCTION promotions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER coupon_redemptions_no_update BEFORE UPDATE ON coupon_redemptions FOR EACH ROW EXECUTE FUNCTION promotions_immutable();
CREATE TRIGGER order_promotions_no_update BEFORE UPDATE ON order_promotions FOR EACH ROW EXECUTE FUNCTION promotions_immutable();
CREATE TRIGGER loyalty_ledger_no_update BEFORE UPDATE ON loyalty_ledger FOR EACH ROW EXECUTE FUNCTION promotions_immutable();

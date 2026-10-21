-- Sprint 6: siparişler (değişmez kopyalar), sipariş kalemleri, ekstralar, durum geçmişi, şube sipariş sayacı.
-- Tekrarlanan gönderim: (tenant_id, idempotency_key_hash) benzersiz. Sipariş no: (branch_id, order_number) benzersiz.
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('QR_TABLE');

-- CreateEnum
CREATE TYPE "OrderActorType" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "qr_token_id" TEXT,
    "public_id" TEXT NOT NULL,
    "order_number" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "source" "OrderSource" NOT NULL DEFAULT 'QR_TABLE',
    "currency" TEXT NOT NULL,
    "subtotal_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "item_count" INTEGER NOT NULL,
    "customer_note" TEXT,
    "locale" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "area_name" TEXT,
    "idempotency_key_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "variant_id" TEXT,
    "product_name" TEXT NOT NULL,
    "product_name_default" TEXT NOT NULL,
    "variant_name" TEXT,
    "base_price_minor" INTEGER NOT NULL,
    "modifiers_total_minor" INTEGER NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total_minor" INTEGER NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_modifiers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "modifier_id" TEXT,
    "modifier_group_id" TEXT,
    "group_name" TEXT NOT NULL,
    "modifier_name" TEXT NOT NULL,
    "price_delta_minor" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_type" "OrderActorType" NOT NULL,
    "actor_user_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sequences" (
    "branch_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("branch_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_public_id_key" ON "orders"("public_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_created_at_idx" ON "orders"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_status_created_at_idx" ON "orders"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_branch_id_created_at_idx" ON "orders"("tenant_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_table_id_created_at_idx" ON "orders"("tenant_id", "table_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_idempotency_key_hash_key" ON "orders"("tenant_id", "idempotency_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "orders_branch_id_order_number_key" ON "orders"("branch_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_id_tenant_id_key" ON "orders"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_sort_order_idx" ON "order_items"("order_id", "sort_order");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_product_id_idx" ON "order_items"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_id_tenant_id_key" ON "order_items"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "order_item_modifiers_order_item_id_sort_order_idx" ON "order_item_modifiers"("order_item_id", "sort_order");

-- CreateIndex
CREATE INDEX "order_item_modifiers_tenant_id_modifier_id_idx" ON "order_item_modifiers"("tenant_id", "modifier_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "table_qr_tokens_id_tenant_id_key" ON "table_qr_tokens"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_branch_id_tenant_id_fkey" FOREIGN KEY ("table_id", "branch_id", "tenant_id") REFERENCES "dining_tables"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_qr_token_id_tenant_id_fkey" FOREIGN KEY ("qr_token_id", "tenant_id") REFERENCES "table_qr_tokens"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_tenant_id_fkey" FOREIGN KEY ("variant_id", "tenant_id") REFERENCES "product_variants"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_tenant_id_fkey" FOREIGN KEY ("order_item_id", "tenant_id") REFERENCES "order_items"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_id_tenant_id_fkey" FOREIGN KEY ("modifier_id", "tenant_id") REFERENCES "modifiers"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_group_id_tenant_id_fkey" FOREIGN KEY ("modifier_group_id", "tenant_id") REFERENCES "modifier_groups"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sequences" ADD CONSTRAINT "order_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sequences" ADD CONSTRAINT "order_sequences_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


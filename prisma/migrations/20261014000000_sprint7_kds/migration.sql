-- Sprint 7: şube hazırlama istasyonları, şube varsayılan istasyonu, ürün → istasyon yönlendirmesi, istasyon fişleri.
-- Sipariş hazırlık zaman damgaları (preparing/ready/served) ve personel iptal açıklaması.
-- CreateEnum
CREATE TYPE "StationType" AS ENUM ('KITCHEN', 'BAR', 'DESSERT', 'COLD', 'GRILL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'CANCELLED');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "default_station_id" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "preparing_at" TIMESTAMP(3),
ADD COLUMN     "ready_at" TIMESTAMP(3),
ADD COLUMN     "served_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "preparation_stations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StationType" NOT NULL DEFAULT 'KITCHEN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preparation_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_preparation_stations" (
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,

    CONSTRAINT "product_preparation_stations_pkey" PRIMARY KEY ("product_id","station_id")
);

-- CreateTable
CREATE TABLE "order_tickets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "station_name" TEXT NOT NULL,
    "station_type" "StationType" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_ticket_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "order_ticket_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "preparation_stations_tenant_id_branch_id_sort_order_idx" ON "preparation_stations"("tenant_id", "branch_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "preparation_stations_branch_id_name_key" ON "preparation_stations"("branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "preparation_stations_id_branch_id_tenant_id_key" ON "preparation_stations"("id", "branch_id", "tenant_id");

-- CreateIndex
CREATE INDEX "product_preparation_stations_tenant_id_branch_id_idx" ON "product_preparation_stations"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "product_preparation_stations_station_id_idx" ON "product_preparation_stations"("station_id");

-- CreateIndex
CREATE INDEX "order_tickets_tenant_id_station_id_status_created_at_idx" ON "order_tickets"("tenant_id", "station_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "order_tickets_tenant_id_branch_id_status_idx" ON "order_tickets"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "order_tickets_order_id_station_id_key" ON "order_tickets"("order_id", "station_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_tickets_id_tenant_id_key" ON "order_tickets"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "order_ticket_items_ticket_id_sort_order_idx" ON "order_ticket_items"("ticket_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "order_ticket_items_ticket_id_order_item_id_key" ON "order_ticket_items"("ticket_id", "order_item_id");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_default_station_id_id_tenant_id_fkey" FOREIGN KEY ("default_station_id", "id", "tenant_id") REFERENCES "preparation_stations"("id", "branch_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "preparation_stations" ADD CONSTRAINT "preparation_stations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_stations" ADD CONSTRAINT "preparation_stations_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_preparation_stations" ADD CONSTRAINT "product_preparation_stations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_preparation_stations" ADD CONSTRAINT "product_preparation_stations_product_id_tenant_id_fkey" FOREIGN KEY ("product_id", "tenant_id") REFERENCES "products"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_preparation_stations" ADD CONSTRAINT "product_preparation_stations_station_id_branch_id_tenant_i_fkey" FOREIGN KEY ("station_id", "branch_id", "tenant_id") REFERENCES "preparation_stations"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tickets" ADD CONSTRAINT "order_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tickets" ADD CONSTRAINT "order_tickets_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tickets" ADD CONSTRAINT "order_tickets_station_id_branch_id_tenant_id_fkey" FOREIGN KEY ("station_id", "branch_id", "tenant_id") REFERENCES "preparation_stations"("id", "branch_id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_ticket_items" ADD CONSTRAINT "order_ticket_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_ticket_items" ADD CONSTRAINT "order_ticket_items_ticket_id_tenant_id_fkey" FOREIGN KEY ("ticket_id", "tenant_id") REFERENCES "order_tickets"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_ticket_items" ADD CONSTRAINT "order_ticket_items_order_item_id_tenant_id_fkey" FOREIGN KEY ("order_item_id", "tenant_id") REFERENCES "order_items"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


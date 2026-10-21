-- CreateEnum
CREATE TYPE "ServiceRequestType" AS ENUM ('WAITER', 'WATER', 'NAPKIN', 'BILL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "table_service_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "dining_area_id" TEXT,
    "qr_token_id" TEXT,
    "public_id" TEXT NOT NULL,
    "type" "ServiceRequestType" NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "active_slot" TEXT DEFAULT 'ACTIVE',
    "note" TEXT,
    "related_order_id" TEXT,
    "branch_name" TEXT NOT NULL,
    "area_name" TEXT,
    "table_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "acknowledged_by_user_id" TEXT,
    "acknowledged_by_name" TEXT,
    "completed_by_user_id" TEXT,
    "cancelled_by" "OrderActorType",
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_service_request_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "from_status" "ServiceRequestStatus",
    "to_status" "ServiceRequestStatus" NOT NULL,
    "actor_type" "OrderActorType" NOT NULL,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_service_request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "table_service_requests_public_id_key" ON "table_service_requests"("public_id");

-- CreateIndex
CREATE INDEX "table_service_requests_tenant_id_status_created_at_idx" ON "table_service_requests"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "table_service_requests_tenant_id_branch_id_created_at_idx" ON "table_service_requests"("tenant_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "table_service_requests_tenant_id_table_id_created_at_idx" ON "table_service_requests"("tenant_id", "table_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "table_service_requests_table_id_type_active_slot_key" ON "table_service_requests"("table_id", "type", "active_slot");

-- CreateIndex
CREATE UNIQUE INDEX "table_service_requests_id_tenant_id_key" ON "table_service_requests"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "table_service_request_status_history_request_id_created_at_idx" ON "table_service_request_status_history"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_table_id_branch_id_tenant_id_fkey" FOREIGN KEY ("table_id", "branch_id", "tenant_id") REFERENCES "dining_tables"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_dining_area_id_branch_id_tenant_id_fkey" FOREIGN KEY ("dining_area_id", "branch_id", "tenant_id") REFERENCES "dining_areas"("id", "branch_id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_qr_token_id_tenant_id_fkey" FOREIGN KEY ("qr_token_id", "tenant_id") REFERENCES "table_qr_tokens"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_related_order_id_tenant_id_fkey" FOREIGN KEY ("related_order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_service_request_status_history" ADD CONSTRAINT "table_service_request_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_service_request_status_history" ADD CONSTRAINT "table_service_request_status_history_request_id_tenant_id_fkey" FOREIGN KEY ("request_id", "tenant_id") REFERENCES "table_service_requests"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Aktif talep tekilliği: active_slot yalnızca OPEN / ACKNOWLEDGED iken dolu ('ACTIVE'); (table_id, type, active_slot)
-- benzersiz → aynı masa + tip için ikinci aktif talep veritabanında reddedilir (eşzamanlı gönderimde de).
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_active_slot_chk" CHECK (
  ("status" IN ('OPEN', 'ACKNOWLEDGED') AND "active_slot" = 'ACTIVE')
  OR ("status" IN ('COMPLETED', 'CANCELLED') AND "active_slot" IS NULL)
);
-- Not yalnızca özel istekte ve kısa (uygulama da süzer).
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_note_len_chk" CHECK ("note" IS NULL OR char_length("note") <= 160);

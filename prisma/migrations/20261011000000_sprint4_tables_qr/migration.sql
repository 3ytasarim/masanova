-- Sprint 4: yemek alanları (bölgeler), masalar, masa QR token'ları.
-- Bileşik FK'ler: masa → aynı kiracı + aynı şubenin bölgesi; token → aynı kiracı + şubenin masası.
-- Düz QR token saklanmaz (yalnızca SHA-256 özeti + HMAC nonce).

-- CreateTable
CREATE TABLE "dining_areas" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dining_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "dining_area_id" TEXT,
    "name" TEXT NOT NULL,
    "number" INTEGER,
    "code" TEXT,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_qr_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_nonce" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "scan_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "table_qr_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dining_areas_tenant_id_branch_id_sort_order_idx" ON "dining_areas"("tenant_id", "branch_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "dining_areas_branch_id_slug_key" ON "dining_areas"("branch_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "dining_areas_id_branch_id_tenant_id_key" ON "dining_areas"("id", "branch_id", "tenant_id");

-- CreateIndex
CREATE INDEX "dining_tables_tenant_id_branch_id_dining_area_id_sort_order_idx" ON "dining_tables"("tenant_id", "branch_id", "dining_area_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_branch_id_name_key" ON "dining_tables"("branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_branch_id_number_key" ON "dining_tables"("branch_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_branch_id_code_key" ON "dining_tables"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_id_branch_id_tenant_id_key" ON "dining_tables"("id", "branch_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "table_qr_tokens_token_hash_key" ON "table_qr_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "table_qr_tokens_token_nonce_key" ON "table_qr_tokens"("token_nonce");

-- CreateIndex
CREATE INDEX "table_qr_tokens_tenant_id_table_id_active_idx" ON "table_qr_tokens"("tenant_id", "table_id", "active");

-- AddForeignKey
ALTER TABLE "dining_areas" ADD CONSTRAINT "dining_areas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_areas" ADD CONSTRAINT "dining_areas_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_dining_area_id_branch_id_tenant_id_fkey" FOREIGN KEY ("dining_area_id", "branch_id", "tenant_id") REFERENCES "dining_areas"("id", "branch_id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_qr_tokens" ADD CONSTRAINT "table_qr_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_qr_tokens" ADD CONSTRAINT "table_qr_tokens_table_id_branch_id_tenant_id_fkey" FOREIGN KEY ("table_id", "branch_id", "tenant_id") REFERENCES "dining_tables"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


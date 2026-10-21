-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('PUBLIC_WEB', 'STAFF', 'WALK_IN', 'PHONE', 'OTHER');

-- AlterTable
ALTER TABLE "dining_tables" ADD COLUMN     "capacity_min" INTEGER,
ADD COLUMN     "reservable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "reservation_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_booking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_confirm" BOOLEAN NOT NULL DEFAULT true,
    "default_duration_minutes" INTEGER NOT NULL DEFAULT 90,
    "slot_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "min_advance_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_advance_days" INTEGER NOT NULL DEFAULT 60,
    "min_party_size" INTEGER NOT NULL DEFAULT 1,
    "max_party_size" INTEGER NOT NULL DEFAULT 8,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "cancellation_cutoff_minutes" INTEGER NOT NULL DEFAULT 60,
    "no_show_grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_opening_hours" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opens_minute" INTEGER NOT NULL,
    "closes_minute" INTEGER NOT NULL,

    CONSTRAINT "branch_opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_blackouts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_combinations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_combinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_combination_tables" (
    "combination_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "table_combination_tables_pkey" PRIMARY KEY ("combination_id","table_id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "manage_token_hash" TEXT NOT NULL,
    "manage_token_nonce" TEXT NOT NULL,
    "customer_id" TEXT,
    "guest_name" TEXT NOT NULL,
    "guest_phone" TEXT,
    "guest_phone_normalized" TEXT,
    "guest_email" TEXT,
    "party_size" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL,
    "source" "ReservationSource" NOT NULL,
    "preferred_area_id" TEXT,
    "special_request" TEXT,
    "internal_note" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'tr',
    "idempotency_key_hash" TEXT,
    "request_hash" TEXT,
    "created_by_user_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "seated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "no_show_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_tables" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "blocked_until" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reservation_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "from_status" "ReservationStatus",
    "to_status" "ReservationStatus" NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservation_settings_tenant_id_key" ON "reservation_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_opening_hours_tenant_id_branch_id_weekday_idx" ON "branch_opening_hours"("tenant_id", "branch_id", "weekday");

-- CreateIndex
CREATE INDEX "reservation_blackouts_tenant_id_branch_id_starts_at_idx" ON "reservation_blackouts"("tenant_id", "branch_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "table_combinations_branch_id_name_key" ON "table_combinations"("branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "table_combinations_id_branch_id_tenant_id_key" ON "table_combinations"("id", "branch_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_public_id_key" ON "reservations"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_manage_token_hash_key" ON "reservations"("manage_token_hash");

-- CreateIndex
CREATE INDEX "reservations_tenant_id_branch_id_starts_at_idx" ON "reservations"("tenant_id", "branch_id", "starts_at");

-- CreateIndex
CREATE INDEX "reservations_tenant_id_customer_id_idx" ON "reservations"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_tenant_id_idempotency_key_hash_key" ON "reservations"("tenant_id", "idempotency_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_id_tenant_id_key" ON "reservations"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_id_branch_id_tenant_id_key" ON "reservations"("id", "branch_id", "tenant_id");

-- CreateIndex
CREATE INDEX "reservation_tables_tenant_id_branch_id_starts_at_idx" ON "reservation_tables"("tenant_id", "branch_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_tables_reservation_id_table_id_key" ON "reservation_tables"("reservation_id", "table_id");

-- CreateIndex
CREATE INDEX "reservation_status_history_tenant_id_reservation_id_created_idx" ON "reservation_status_history"("tenant_id", "reservation_id", "created_at");

-- AddForeignKey
ALTER TABLE "reservation_settings" ADD CONSTRAINT "reservation_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_opening_hours" ADD CONSTRAINT "branch_opening_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_opening_hours" ADD CONSTRAINT "branch_opening_hours_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_blackouts" ADD CONSTRAINT "reservation_blackouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_blackouts" ADD CONSTRAINT "reservation_blackouts_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_combinations" ADD CONSTRAINT "table_combinations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_combinations" ADD CONSTRAINT "table_combinations_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_combination_tables" ADD CONSTRAINT "table_combination_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_combination_tables" ADD CONSTRAINT "table_combination_tables_combination_id_branch_id_tenant_i_fkey" FOREIGN KEY ("combination_id", "branch_id", "tenant_id") REFERENCES "table_combinations"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "table_combination_tables" ADD CONSTRAINT "table_combination_tables_table_id_branch_id_tenant_id_fkey" FOREIGN KEY ("table_id", "branch_id", "tenant_id") REFERENCES "dining_tables"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_preferred_area_id_branch_id_tenant_id_fkey" FOREIGN KEY ("preferred_area_id", "branch_id", "tenant_id") REFERENCES "dining_areas"("id", "branch_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservation_tables" ADD CONSTRAINT "reservation_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_tables" ADD CONSTRAINT "reservation_tables_reservation_id_branch_id_tenant_id_fkey" FOREIGN KEY ("reservation_id", "branch_id", "tenant_id") REFERENCES "reservations"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservation_tables" ADD CONSTRAINT "reservation_tables_table_id_branch_id_tenant_id_fkey" FOREIGN KEY ("table_id", "branch_id", "tenant_id") REFERENCES "dining_tables"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reservation_status_history" ADD CONSTRAINT "reservation_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_status_history" ADD CONSTRAINT "reservation_status_history_reservation_id_tenant_id_fkey" FOREIGN KEY ("reservation_id", "tenant_id") REFERENCES "reservations"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- ─── Sprint 17 bütünlük kısıtları (Prisma şemasında ifade edilemez) ───────────────

-- ÇİFT REZERVASYON YOK: aynı masa, etkin (PENDING / CONFIRMED / SEATED) iki rezervasyonda çakışan yarı-açık
-- [starts_at, blocked_until) aralıklarına sahip olamaz. 18:00–20:00 ile 20:00–22:00 çakışmaz.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "reservation_tables" ADD CONSTRAINT "reservation_tables_no_overlap"
  EXCLUDE USING gist ("table_id" WITH =, tsrange("starts_at", "blocked_until", '[)') WITH &&) WHERE ("active");

ALTER TABLE "reservation_tables" ADD CONSTRAINT "reservation_tables_interval_check" CHECK ("blocked_until" > "starts_at");
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_interval_check" CHECK ("ends_at" > "starts_at" AND "duration_minutes" BETWEEN 15 AND 720 AND "buffer_minutes" BETWEEN 0 AND 240);
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_party_check" CHECK ("party_size" BETWEEN 1 AND 100);
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_text_check" CHECK (
  char_length("guest_name") BETWEEN 1 AND 80
  AND ("special_request" IS NULL OR char_length("special_request") <= 300)
  AND ("internal_note" IS NULL OR char_length("internal_note") <= 500)
);
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_capacity_check" CHECK (
  ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 50)
  AND ("capacity_min" IS NULL OR ("capacity_min" >= 1 AND ("capacity" IS NULL OR "capacity_min" <= "capacity")))
);
ALTER TABLE "branch_opening_hours" ADD CONSTRAINT "branch_opening_hours_check" CHECK (
  "weekday" BETWEEN 1 AND 7 AND "opens_minute" >= 0 AND "closes_minute" <= 1440 AND "closes_minute" > "opens_minute"
);
ALTER TABLE "reservation_blackouts" ADD CONSTRAINT "reservation_blackouts_interval_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "reservation_settings" ADD CONSTRAINT "reservation_settings_check" CHECK (
  "default_duration_minutes" BETWEEN 15 AND 720
  AND "slot_interval_minutes" IN (10, 15, 20, 30, 60)
  AND "min_advance_minutes" BETWEEN 0 AND 10080
  AND "max_advance_days" BETWEEN 1 AND 365
  AND "min_party_size" >= 1 AND "max_party_size" >= "min_party_size" AND "max_party_size" <= 100
  AND "buffer_minutes" BETWEEN 0 AND 240
  AND "cancellation_cutoff_minutes" BETWEEN 0 AND 10080
  AND "no_show_grace_minutes" BETWEEN 0 AND 240
);
-- Durum geçmişi değiştirilemez (ekleme-yalnız).
CREATE OR REPLACE FUNCTION reservation_history_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reservation_status_history is append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER reservation_status_history_no_update BEFORE UPDATE ON reservation_status_history FOR EACH ROW EXECUTE FUNCTION reservation_history_immutable();

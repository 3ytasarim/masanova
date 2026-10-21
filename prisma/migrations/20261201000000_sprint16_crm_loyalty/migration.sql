-- Sprint 16: CRM temeli, açık onay, onay geçmişi, müşteri oturumu, iletişim doğrulama, sadakat defteri.
-- Müşteri kimliği isteğe bağlıdır; kayıtlar kiracıya özeldir.

-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('QR_OPT_IN', 'ORDER_CHECKOUT', 'LOYALTY_JOIN', 'MANUAL_STAFF');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('PRIVACY', 'MARKETING_EMAIL', 'MARKETING_SMS', 'MARKETING_WHATSAPP', 'LOYALTY');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('QR_OPT_IN', 'CUSTOMER_PROFILE', 'MANUAL_STAFF');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('PHONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "LoyaltyEntryType" AS ENUM ('EARN', 'REDEEM', 'ADJUSTMENT', 'EXPIRE');

-- CreateEnum
CREATE TYPE "LoyaltyEarnTrigger" AS ENUM ('ACCEPTED', 'SERVED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customer_id" TEXT;

-- AlterTable
ALTER TABLE "table_service_requests" ADD COLUMN     "customer_id" TEXT;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "phone_normalized" TEXT,
    "email" TEXT,
    "email_normalized" TEXT,
    "phone_verified_at" TIMESTAMP(3),
    "email_verified_at" TIMESTAMP(3),
    "preferred_language" TEXT,
    "source" "CustomerSource" NOT NULL,
    "staff_note" TEXT,
    "deletion_requested_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_verified_contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "value_normalized" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_verified_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "version" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_verifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "value_normalized" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minor_per_point" INTEGER,
    "earn_on" "LoyaltyEarnTrigger" NOT NULL DEFAULT 'SERVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "LoyaltyEntryType" NOT NULL,
    "points" INTEGER NOT NULL,
    "order_id" TEXT,
    "reason" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_public_id_key" ON "customers"("public_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_phone_normalized_idx" ON "customers"("tenant_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "customers_tenant_id_email_normalized_idx" ON "customers"("tenant_id", "email_normalized");

-- CreateIndex
CREATE INDEX "customers_tenant_id_created_at_idx" ON "customers"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_tenant_id_key" ON "customers"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_verified_contacts_tenant_id_channel_value_normaliz_key" ON "customer_verified_contacts"("tenant_id", "channel", "value_normalized");

-- CreateIndex
CREATE INDEX "customer_consents_tenant_id_customer_id_type_created_at_idx" ON "customer_consents"("tenant_id", "customer_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "customer_sessions_tenant_id_customer_id_idx" ON "customer_sessions"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_verifications_public_id_key" ON "contact_verifications"("public_id");

-- CreateIndex
CREATE INDEX "contact_verifications_tenant_id_channel_value_normalized_cr_idx" ON "contact_verifications"("tenant_id", "channel", "value_normalized", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_settings_tenant_id_key" ON "loyalty_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_tenant_id_customer_id_key" ON "loyalty_accounts"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_id_tenant_id_key" ON "loyalty_accounts"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "loyalty_ledger_tenant_id_account_id_created_at_idx" ON "loyalty_ledger"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_tenant_id_order_id_type_key" ON "loyalty_ledger"("tenant_id", "order_id", "type");

-- CreateIndex
CREATE INDEX "orders_tenant_id_customer_id_created_at_idx" ON "orders"("tenant_id", "customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "table_service_requests" ADD CONSTRAINT "table_service_requests_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_verified_contacts" ADD CONSTRAINT "customer_verified_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_verified_contacts" ADD CONSTRAINT "customer_verified_contacts_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_verifications" ADD CONSTRAINT "contact_verifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_settings" ADD CONSTRAINT "loyalty_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_account_id_tenant_id_fkey" FOREIGN KEY ("account_id", "tenant_id") REFERENCES "loyalty_accounts"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Onay satırı tutarlılığı: verilen → granted_at dolu, geri alınan → revoked_at dolu.
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_status_check" CHECK (("status" = 'GRANTED' AND "granted_at" IS NOT NULL AND "revoked_at" IS NULL) OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL));
-- Kazanım yalnızca siparişe bağlı ve pozitif; kazanım dışı satırlar siparişsiz de olabilir.
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_earn_check" CHECK ("type" <> 'EARN' OR ("order_id" IS NOT NULL AND "points" > 0));
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_points_check" CHECK ("points" <> 0);
-- Personel notu sınırlı düz metin.
ALTER TABLE "customers" ADD CONSTRAINT "customers_staff_note_check" CHECK ("staff_note" IS NULL OR char_length("staff_note") <= 500);
ALTER TABLE "loyalty_settings" ADD CONSTRAINT "loyalty_settings_rate_check" CHECK ("minor_per_point" IS NULL OR "minor_per_point" > 0);

-- Sadakat defteri bütünlüğü: sipariş bağlı satırda siparişin müşterisi, hesabın müşterisiyle AYNI olmalı
-- (kiracı eşleşmesi zaten bileşik yabancı anahtarlarla garanti).
CREATE OR REPLACE FUNCTION loyalty_ledger_order_customer_check() RETURNS trigger AS $$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM orders o JOIN loyalty_accounts a ON a.id = NEW.account_id AND a.tenant_id = NEW.tenant_id
      WHERE o.id = NEW.order_id AND o.tenant_id = NEW.tenant_id AND o.customer_id = a.customer_id
    ) THEN
      RAISE EXCEPTION 'loyalty_ledger: order customer does not match account customer' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER loyalty_ledger_order_customer
  BEFORE INSERT OR UPDATE OF order_id, account_id ON loyalty_ledger
  FOR EACH ROW EXECUTE FUNCTION loyalty_ledger_order_customer_check();

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE', 'CASH', 'CARD_TERMINAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentSplitMode" AS ENUM ('FULL', 'AMOUNT', 'EQUAL', 'ITEMS');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "payment_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allow_online" BOOLEAN NOT NULL DEFAULT true,
    "allow_cash" BOOLEAN NOT NULL DEFAULT true,
    "allow_card_terminal" BOOLEAN NOT NULL DEFAULT true,
    "reservation_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "provider" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "split_mode" "PaymentSplitMode" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "refunded_minor" INTEGER NOT NULL DEFAULT 0,
    "reserved_until" TIMESTAMP(3),
    "needs_refund" BOOLEAN NOT NULL DEFAULT false,
    "failure_code" TEXT,
    "card_brand" TEXT,
    "card_last4" TEXT,
    "idempotency_key_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "succeeded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT,
    "status" "PaymentAttemptStatus" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "checkout_url" TEXT,
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "quantity" INTEGER,
    "amount_minor" INTEGER NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "status" "PaymentRefundStatus" NOT NULL,
    "provider_reference" TEXT,
    "reason" TEXT,
    "idempotency_key_hash" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "type" TEXT NOT NULL,
    "provider_reference" TEXT,
    "outcome" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_settings_tenant_id_key" ON "payment_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_public_id_key" ON "payments"("public_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_order_id_idx" ON "payments"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_status_created_at_idx" ON "payments"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_hash_key" ON "payments"("tenant_id", "idempotency_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_tenant_id_key" ON "payments"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "payment_attempts_tenant_id_payment_id_idx" ON "payment_attempts"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_provider_reference_key" ON "payment_attempts"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_idempotency_key_key" ON "payment_attempts"("provider", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_order_id_idx" ON "payment_allocations"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_payment_id_idx" ON "payment_allocations"("tenant_id", "payment_id");

-- CreateIndex
CREATE INDEX "payment_refunds_tenant_id_payment_id_idx" ON "payment_refunds"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_refunds_tenant_id_idempotency_key_hash_key" ON "payment_refunds"("tenant_id", "idempotency_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

-- AddForeignKey
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_tenant_id_fkey" FOREIGN KEY ("customer_id", "tenant_id") REFERENCES "customers"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_tenant_id_fkey" FOREIGN KEY ("payment_id", "tenant_id") REFERENCES "payments"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_tenant_id_fkey" FOREIGN KEY ("payment_id", "tenant_id") REFERENCES "payments"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_order_item_id_tenant_id_fkey" FOREIGN KEY ("order_item_id", "tenant_id") REFERENCES "order_items"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_tenant_id_fkey" FOREIGN KEY ("payment_id", "tenant_id") REFERENCES "payments"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Sprint 19 bütünlük kısıtları ──────────────────────────────────────────────
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK (
  "amount_minor" > 0 AND "refunded_minor" >= 0 AND "refunded_minor" <= "amount_minor"
  AND ("card_last4" IS NULL OR "card_last4" ~ '^[0-9]{4}$')
  AND ("card_brand" IS NULL OR char_length("card_brand") <= 20)
  AND (("method" = 'ONLINE') = ("provider" <> 'manual'))
);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_check" CHECK (
  "amount_minor" >= 0 AND (("order_item_id" IS NULL AND "quantity" IS NULL) OR ("order_item_id" IS NOT NULL AND "quantity" > 0))
);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_check" CHECK ("amount_minor" > 0);
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_amount_check" CHECK ("amount_minor" > 0 AND ("reason" IS NULL OR char_length("reason") <= 200));
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_check" CHECK ("reservation_minutes" BETWEEN 1 AND 120);

-- Dağıtım: ödemenin siparişi ve (varsa) kalemin siparişi AYNI olmalı; dağıtım satırı değiştirilemez.
CREATE OR REPLACE FUNCTION payment_allocation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'payment_allocations is append-only' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = NEW.payment_id AND p.tenant_id = NEW.tenant_id AND p.order_id = NEW.order_id) THEN
    RAISE EXCEPTION 'payment_allocations: payment/order mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.order_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.id = NEW.order_item_id AND i.tenant_id = NEW.tenant_id AND i.order_id = NEW.order_id) THEN
    RAISE EXCEPTION 'payment_allocations: item/order mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_allocations_guard BEFORE INSERT OR UPDATE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocation_guard();

-- FAZLA ÖDEME YOK (son savunma): bir ödeme SUCCEEDED olurken sipariş satırı KİLİTLENİR; kesinleşmiş ödemeler toplamı
-- sipariş toplamını, kalem bazında ödenen adet kalem adedini aşamaz. Tutar ve sipariş değişmez; kesinleşen ödeme geriye
-- (PENDING / PROCESSING / FAILED / CANCELLED) dönemez (geç / sırasız webhook).
CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger AS $$
DECLARE order_total INTEGER; settled INTEGER; over_item RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.amount_minor <> OLD.amount_minor OR NEW.order_id <> OLD.order_id OR NEW.currency <> OLD.currency OR NEW.method <> OLD.method THEN
      RAISE EXCEPTION 'payments: amount/order/currency/method are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND NEW.status NOT IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN
      RAISE EXCEPTION 'payments: settled payment cannot regress' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'SUCCEEDED' AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')) THEN
    SELECT total_minor INTO order_total FROM orders WHERE id = NEW.order_id AND tenant_id = NEW.tenant_id FOR UPDATE;
    SELECT COALESCE(SUM(amount_minor), 0) INTO settled FROM payments
      WHERE order_id = NEW.order_id AND tenant_id = NEW.tenant_id AND id <> NEW.id AND status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED');
    IF settled + NEW.amount_minor > order_total THEN
      RAISE EXCEPTION 'payments: overpayment' USING ERRCODE = '23514';
    END IF;
    SELECT i.id INTO over_item FROM order_items i
      JOIN payment_allocations a ON a.order_item_id = i.id
      JOIN payments p ON p.id = a.payment_id
      WHERE i.order_id = NEW.order_id AND i.tenant_id = NEW.tenant_id
        AND (p.id = NEW.id OR p.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'))
      GROUP BY i.id, i.quantity HAVING SUM(a.quantity) > i.quantity LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'payments: item over-allocation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payment_guard();

-- İade tutarı değiştirilemez.
CREATE OR REPLACE FUNCTION payment_refund_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_minor <> OLD.amount_minor OR NEW.payment_id <> OLD.payment_id THEN
    RAISE EXCEPTION 'payment_refunds: amount is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_refunds_guard BEFORE UPDATE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION payment_refund_guard();

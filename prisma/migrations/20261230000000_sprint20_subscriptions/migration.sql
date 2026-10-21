-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELLED', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('SUBSCRIPTION_CREATED', 'SUBSCRIPTION_PLAN_CHANGED', 'SUBSCRIPTION_STATUS_CHANGED', 'SUBSCRIPTION_TRIAL_STARTED', 'SUBSCRIPTION_TRIAL_EXTENDED', 'SUBSCRIPTION_PERIOD_CHANGED', 'SUBSCRIPTION_CANCEL_SCHEDULED', 'SUBSCRIPTION_CANCEL_UNSCHEDULED', 'SUBSCRIPTION_REACTIVATED', 'ENTITLEMENT_OVERRIDE_SET', 'ENTITLEMENT_OVERRIDE_REMOVED');

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan" "TenantPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "grace_ends_at" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "from_plan" "TenantPlan",
    "to_plan" "TenantPlan",
    "from_status" "SubscriptionStatus",
    "to_status" "SubscriptionStatus",
    "actor_user_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "limit_value" BIGINT,
    "expires_at" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_id_tenant_id_key" ON "subscriptions"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "subscription_events_tenant_id_created_at_idx" ON "subscription_events"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "entitlement_overrides_tenant_id_key_key" ON "entitlement_overrides"("tenant_id", "key");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_tenant_id_fkey" FOREIGN KEY ("subscription_id", "tenant_id") REFERENCES "subscriptions"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Sprint 20: değişmezler (Prisma ifade edemez) ──────────────────────────
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_check" CHECK ("status" <> 'TRIALING' OR "trial_ends_at" IS NOT NULL);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_grace_check" CHECK ("status" NOT IN ('PAST_DUE', 'GRACE') OR "grace_ends_at" IS NOT NULL);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_cancel_check" CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_check" CHECK ("current_period_end" IS NULL OR "current_period_end" > "current_period_start");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_check" CHECK ("provider" ~ '^[a-z0-9_-]{1,32}$');
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_kind_check" CHECK (("enabled" IS NULL) <> ("limit_value" IS NULL));
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_key_check" CHECK ("key" ~ '^[A-Za-z_]{2,40}$');
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_limit_check" CHECK ("limit_value" IS NULL OR "limit_value" >= -1);
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 200);

-- Abonelik geçmişi yalnızca ekleme (kiracı silinince CASCADE ile gider).
CREATE OR REPLACE FUNCTION subscription_event_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'subscription_events is append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER subscription_events_guard BEFORE UPDATE ON "subscription_events" FOR EACH ROW EXECUTE FUNCTION subscription_event_guard();

-- Tenant.plan = abonelik paketinin AYNASI: abonelik yazılınca eşitlenir; doğrudan farklı değer yazılamaz.
CREATE OR REPLACE FUNCTION subscription_plan_mirror() RETURNS trigger AS $$
BEGIN
  UPDATE "tenants" SET "plan" = NEW."plan" WHERE "id" = NEW."tenant_id" AND "plan" IS DISTINCT FROM NEW."plan";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER subscriptions_plan_mirror AFTER INSERT OR UPDATE OF "plan" ON "subscriptions" FOR EACH ROW EXECUTE FUNCTION subscription_plan_mirror();

CREATE OR REPLACE FUNCTION tenant_plan_guard() RETURNS trigger AS $$
DECLARE sub_plan "TenantPlan";
BEGIN
  IF NEW."plan" IS DISTINCT FROM OLD."plan" THEN
    SELECT "plan" INTO sub_plan FROM "subscriptions" WHERE "tenant_id" = NEW."id";
    IF FOUND AND sub_plan IS DISTINCT FROM NEW."plan" THEN
      RAISE EXCEPTION 'tenants.plan mirrors subscriptions.plan; change the subscription instead' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tenants_plan_guard BEFORE UPDATE OF "plan" ON "tenants" FOR EACH ROW EXECUTE FUNCTION tenant_plan_guard();

-- Geri doldurma: mevcut her kiracı → mevcut paketinde ACTIVE, açık uçlu manuel abonelik (veri / erişim değişmez).
INSERT INTO "subscriptions" ("id", "tenant_id", "plan", "status", "provider", "starts_at", "current_period_start", "updated_at")
SELECT 'sub' || replace(gen_random_uuid()::text, '-', ''), t."id", t."plan", 'ACTIVE', 'manual', t."created_at", t."created_at", CURRENT_TIMESTAMP
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."tenant_id" = t."id");

INSERT INTO "subscription_events" ("id", "tenant_id", "subscription_id", "type", "to_plan", "to_status", "metadata")
SELECT 'sev' || replace(gen_random_uuid()::text, '-', ''), s."tenant_id", s."id", 'SUBSCRIPTION_CREATED', s."plan", s."status", '{"source":"migration"}'::jsonb
FROM "subscriptions" s;

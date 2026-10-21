-- CreateEnum
CREATE TYPE "DomainVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "DemoRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST');

-- AlterEnum: paket adları yeniden adlandırılır (veri korunur, eşleme açık):
-- PROFESSIONAL → PRO, ENTERPRISE → AI
ALTER TYPE "TenantPlan" RENAME VALUE 'PROFESSIONAL' TO 'PRO';
ALTER TYPE "TenantPlan" RENAME VALUE 'ENTERPRISE' TO 'AI';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "support_started_at" TIMESTAMP(3),
ADD COLUMN     "support_tenant_id" TEXT;

-- CreateTable
CREATE TABLE "domain_verifications" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "DomainVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "city" TEXT,
    "table_count" INTEGER,
    "message" TEXT,
    "status" "DemoRequestStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_verifications_domain_id_key" ON "domain_verifications"("domain_id");

-- CreateIndex
CREATE INDEX "domain_verifications_status_idx" ON "domain_verifications"("status");

-- CreateIndex
CREATE INDEX "demo_requests_status_created_at_idx" ON "demo_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "demo_requests_created_at_idx" ON "demo_requests"("created_at");

-- CreateIndex
CREATE INDEX "tenants_plan_idx" ON "tenants"("plan");

-- CreateIndex
CREATE INDEX "tenants_created_at_idx" ON "tenants"("created_at");

-- AddForeignKey
ALTER TABLE "domain_verifications" ADD CONSTRAINT "domain_verifications_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "tenant_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;


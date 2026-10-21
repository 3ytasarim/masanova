-- Sprint 15: İşletme Danışmanı içgörüleri + ADVISOR AI kullanım türü. Salt okunur danışman; müşteri / konuşma verisi yok.

-- CreateEnum
CREATE TYPE "AdvisorInsightStatus" AS ENUM ('NEW', 'SEEN', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AdvisorFeedback" AS ENUM ('USEFUL', 'NOT_USEFUL');

-- AlterEnum
ALTER TYPE "AiUsageKind" ADD VALUE 'ADVISOR';

-- CreateTable
CREATE TABLE "advisor_insights" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "scope_key" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "fact_hash" TEXT NOT NULL,
    "material_hash" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "comparison_start" TIMESTAMP(3) NOT NULL,
    "comparison_end" TIMESTAMP(3) NOT NULL,
    "status" "AdvisorInsightStatus" NOT NULL DEFAULT 'NEW',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "explanation" JSONB,
    "explanation_hash" TEXT,
    "explanation_model" TEXT,
    "feedback" "AdvisorFeedback",
    "dismissed_at" TIMESTAMP(3),
    "dismissed_by_user_id" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advisor_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advisor_insights_tenant_id_status_active_idx" ON "advisor_insights"("tenant_id", "status", "active");

-- CreateIndex
CREATE UNIQUE INDEX "advisor_insights_tenant_id_scope_key_range_type_subject_key_key" ON "advisor_insights"("tenant_id", "scope_key", "range", "type", "subject_key");

-- AddForeignKey
ALTER TABLE "advisor_insights" ADD CONSTRAINT "advisor_insights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisor_insights" ADD CONSTRAINT "advisor_insights_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Kapsam tutarlılığı: tüm şubeler → 'all', tek şube → şube kimliği.
ALTER TABLE "advisor_insights" ADD CONSTRAINT "advisor_insights_scope_check" CHECK ("scope_key" = COALESCE("branch_id", 'all'));

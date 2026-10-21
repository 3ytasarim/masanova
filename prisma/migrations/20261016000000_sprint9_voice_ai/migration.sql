-- CreateEnum
CREATE TYPE "AiTone" AS ENUM ('WARM', 'FORMAL', 'CASUAL');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AiInputMode" AS ENUM ('VOICE', 'TEXT');

-- CreateEnum
CREATE TYPE "AiUsageKind" AS ENUM ('CONVERSATION', 'CHAT', 'STT', 'TTS');

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "assistant_name" TEXT NOT NULL DEFAULT 'MasaNova AI',
    "welcome_message" TEXT,
    "tone" "AiTone" NOT NULL DEFAULT 'WARM',
    "custom_instructions" TEXT,
    "allow_recommendations" BOOLEAN NOT NULL DEFAULT true,
    "allow_cart_actions" BOOLEAN NOT NULL DEFAULT true,
    "allow_service_actions" BOOLEAN NOT NULL DEFAULT true,
    "voice_enabled" BOOLEAN NOT NULL DEFAULT true,
    "default_voice_language" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "proof_hash" TEXT NOT NULL,
    "ui_locale" TEXT NOT NULL,
    "conversation_language" TEXT NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "input_mode" "AiInputMode",
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "metadata" JSONB,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "kind" "AiUsageKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "stt_ms" INTEGER NOT NULL DEFAULT 0,
    "tts_characters" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_settings_tenant_id_key" ON "ai_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversations_public_id_key" ON "ai_conversations"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversations_proof_hash_key" ON "ai_conversations"("proof_hash");

-- CreateIndex
CREATE INDEX "ai_conversations_tenant_id_created_at_idx" ON "ai_conversations"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_conversations_table_id_last_activity_at_idx" ON "ai_conversations"("table_id", "last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversations_id_tenant_id_key" ON "ai_conversations"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_public_id_key" ON "ai_messages"("public_id");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_tenant_id_created_at_idx" ON "ai_usage"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage"("created_at");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_branch_id_tenant_id_fkey" FOREIGN KEY ("branch_id", "tenant_id") REFERENCES "branches"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_table_id_branch_id_tenant_id_fkey" FOREIGN KEY ("table_id", "branch_id", "tenant_id") REFERENCES "dining_tables"("id", "branch_id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "ai_conversations"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "ai_conversations"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Uzunluk sınırları (uygulama da süzer)
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_custom_instructions_len_chk" CHECK ("custom_instructions" IS NULL OR char_length("custom_instructions") <= 300);
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_welcome_len_chk" CHECK ("welcome_message" IS NULL OR char_length("welcome_message") <= 200);
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_content_len_chk" CHECK (char_length("content") <= 4000);

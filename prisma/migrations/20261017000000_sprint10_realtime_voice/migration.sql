-- CreateEnum
CREATE TYPE "AiTurnStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'INTERRUPTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiTurnMode" AS ENUM ('REALTIME', 'FALLBACK');

-- AlterTable
ALTER TABLE "ai_conversations" ADD COLUMN     "context" JSONB;

-- CreateTable
CREATE TABLE "ai_turns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_key" TEXT NOT NULL,
    "mode" "AiTurnMode" NOT NULL,
    "status" "AiTurnStatus" NOT NULL DEFAULT 'PROCESSING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "assistant_message_id" TEXT,
    "stt_ms" INTEGER,
    "first_text_ms" INTEGER,
    "first_audio_ms" INTEGER,
    "total_ms" INTEGER,
    "audio_in_ms" INTEGER NOT NULL DEFAULT 0,
    "audio_out_ms" INTEGER NOT NULL DEFAULT 0,
    "interrupted_at" TIMESTAMP(3),
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_turns_tenant_id_created_at_idx" ON "ai_turns"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_turns_conversation_id_turn_key_key" ON "ai_turns"("conversation_id", "turn_key");

-- AddForeignKey
ALTER TABLE "ai_turns" ADD CONSTRAINT "ai_turns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_turns" ADD CONSTRAINT "ai_turns_conversation_id_tenant_id_fkey" FOREIGN KEY ("conversation_id", "tenant_id") REFERENCES "ai_conversations"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;


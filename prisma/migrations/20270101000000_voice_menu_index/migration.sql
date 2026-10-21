-- Sesli menü sözlüğü: kiracı başına menü tarama dizini.
CREATE TYPE "VoiceIndexStatus" AS ENUM ('READY', 'STALE', 'BUILDING', 'FAILED');

CREATE TABLE "voice_menu_indexes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" "VoiceIndexStatus" NOT NULL DEFAULT 'BUILDING',
    "menu_hash" TEXT,
    "built_at" TIMESTAMP(3),
    "stale_since" TIMESTAMP(3),
    "product_count" INTEGER NOT NULL DEFAULT 0,
    "variant_count" INTEGER NOT NULL DEFAULT 0,
    "modifier_count" INTEGER NOT NULL DEFAULT 0,
    "term_count" INTEGER NOT NULL DEFAULT 0,
    "ambiguous_count" INTEGER NOT NULL DEFAULT 0,
    "lexicon" JSONB,
    "ai_terms" JSONB,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "voice_menu_indexes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voice_menu_indexes_tenant_id_key" ON "voice_menu_indexes"("tenant_id");

ALTER TABLE "voice_menu_indexes" ADD CONSTRAINT "voice_menu_indexes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Yapay Zeka Eğitimi: platform geneli serbest eğitim metinleri (Super Admin).
CREATE TABLE "ai_knowledge_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_knowledge_documents_active_sort_order_idx" ON "ai_knowledge_documents"("active", "sort_order");

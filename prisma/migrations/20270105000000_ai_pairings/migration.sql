-- İşletme yemek eşleştirmeleri (ana yemek → meze / içecek), sesli garson için.
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "pairings" JSONB;

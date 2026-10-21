-- Sprint 12: analitik için kiracı geneli tarih aralığı indeksleri (yalnızca gerekçeli olanlar; bkz. docs/architecture.md §97)
-- CreateIndex
CREATE INDEX "ai_messages_tenant_id_role_created_at_idx" ON "ai_messages"("tenant_id", "role", "created_at");

-- CreateIndex
CREATE INDEX "order_tickets_tenant_id_created_at_idx" ON "order_tickets"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "table_service_requests_tenant_id_created_at_idx" ON "table_service_requests"("tenant_id", "created_at");


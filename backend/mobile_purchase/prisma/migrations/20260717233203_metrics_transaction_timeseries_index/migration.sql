-- CreateIndex
CREATE INDEX "transactions_project_id_environment_purchased_at_idx" ON "transactions"("project_id", "environment", "purchased_at");

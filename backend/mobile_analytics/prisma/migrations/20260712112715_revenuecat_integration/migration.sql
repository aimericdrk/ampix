-- CreateTable
CREATE TABLE "revenuecat_integrations" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "api_key" TEXT,
    "rc_project_id" TEXT,
    "sandbox_mode" BOOLEAN NOT NULL DEFAULT false,
    "last_webhook_at" TIMESTAMP(3),
    "backfill_status" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenuecat_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_states" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "rc_app_user_id" TEXT NOT NULL,
    "distinct_id" TEXT,
    "status" TEXT NOT NULL,
    "product_id" TEXT,
    "store" TEXT,
    "period_type" TEXT,
    "price_cents" INTEGER,
    "currency" TEXT,
    "mrr_cents" INTEGER NOT NULL DEFAULT 0,
    "total_spent_cents" INTEGER NOT NULL DEFAULT 0,
    "first_purchase_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenuecat_webhook_events" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "rc_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "rc_app_user_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "revenuecat_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "revenuecat_integrations_project_id_key" ON "revenuecat_integrations"("project_id");

-- CreateIndex
CREATE INDEX "subscription_states_project_id_status_idx" ON "subscription_states"("project_id", "status");

-- CreateIndex
CREATE INDEX "subscription_states_project_id_distinct_id_idx" ON "subscription_states"("project_id", "distinct_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_states_project_id_rc_app_user_id_key" ON "subscription_states"("project_id", "rc_app_user_id");

-- CreateIndex
CREATE INDEX "revenuecat_webhook_events_project_id_status_idx" ON "revenuecat_webhook_events"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "revenuecat_webhook_events_project_id_rc_event_id_key" ON "revenuecat_webhook_events"("project_id", "rc_event_id");

-- AddForeignKey
ALTER TABLE "revenuecat_integrations" ADD CONSTRAINT "revenuecat_integrations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_states" ADD CONSTRAINT "subscription_states_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenuecat_webhook_events" ADD CONSTRAINT "revenuecat_webhook_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

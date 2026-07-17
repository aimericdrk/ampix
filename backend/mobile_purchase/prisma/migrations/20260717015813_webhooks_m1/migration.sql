-- CreateEnum
CREATE TYPE "Store" AS ENUM ('APP_STORE', 'PLAY_STORE');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('NORMAL', 'TRIAL', 'INTRO', 'PROMO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'INTRO', 'ACTIVE', 'CANCELLED', 'GRACE_PERIOD', 'BILLING_RETRY', 'PAUSED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('PROCESSED', 'FAILED', 'UNLINKED', 'SKIPPED');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "app_user_id" TEXT NOT NULL,
    "apple_app_account_token" UUID,
    "google_obfuscated_account_id" TEXT,
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "product_id" UUID,
    "store_product_id" TEXT NOT NULL,
    "store" "Store" NOT NULL,
    "environment" "Environment" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "period_type" "PeriodType" NOT NULL DEFAULT 'NORMAL',
    "original_transaction_id" TEXT,
    "purchase_token" TEXT,
    "purchased_at" TIMESTAMP(3) NOT NULL,
    "original_purchased_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "auto_renew_status" BOOLEAN NOT NULL DEFAULT true,
    "auto_renew_product_id" TEXT,
    "unsubscribe_detected_at" TIMESTAMP(3),
    "billing_issue_detected_at" TIMESTAMP(3),
    "grace_period_expires_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "price_cents" INTEGER,
    "currency" TEXT,
    "last_event_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "customer_id" UUID,
    "app_id" UUID NOT NULL,
    "subscription_id" UUID,
    "store" "Store" NOT NULL,
    "environment" "Environment" NOT NULL,
    "store_transaction_id" TEXT NOT NULL,
    "original_transaction_id" TEXT,
    "store_product_id" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "purchased_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "price_cents" INTEGER,
    "currency" TEXT,
    "is_trial_period" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_notifications" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "app_id" UUID,
    "store" "Store" NOT NULL,
    "store_event_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "subtype" TEXT,
    "app_user_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "JournalStatus" NOT NULL,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "store_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_project_id_idx" ON "customers"("project_id");

-- CreateIndex
CREATE INDEX "customers_apple_app_account_token_idx" ON "customers"("apple_app_account_token");

-- CreateIndex
CREATE INDEX "customers_google_obfuscated_account_id_idx" ON "customers"("google_obfuscated_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_project_id_app_user_id_key" ON "customers"("project_id", "app_user_id");

-- CreateIndex
CREATE INDEX "subscriptions_project_id_status_idx" ON "subscriptions"("project_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_customer_id_idx" ON "subscriptions"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_project_id_store_original_transaction_id_key" ON "subscriptions"("project_id", "store", "original_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_project_id_store_purchase_token_key" ON "subscriptions"("project_id", "store", "purchase_token");

-- CreateIndex
CREATE INDEX "transactions_project_id_idx" ON "transactions"("project_id");

-- CreateIndex
CREATE INDEX "transactions_original_transaction_id_idx" ON "transactions"("original_transaction_id");

-- CreateIndex
CREATE INDEX "transactions_subscription_id_idx" ON "transactions"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_project_id_store_store_transaction_id_key" ON "transactions"("project_id", "store", "store_transaction_id");

-- CreateIndex
CREATE INDEX "store_notifications_status_idx" ON "store_notifications"("status");

-- CreateIndex
CREATE INDEX "store_notifications_project_id_status_idx" ON "store_notifications"("project_id", "status");

-- CreateIndex
CREATE INDEX "store_notifications_project_id_app_user_id_status_idx" ON "store_notifications"("project_id", "app_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "store_notifications_store_store_event_id_key" ON "store_notifications"("store", "store_event_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

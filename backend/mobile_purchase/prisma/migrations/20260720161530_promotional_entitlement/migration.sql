-- CreateTable
CREATE TABLE "promotional_entitlements" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "entitlement_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "promotional_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotional_entitlements_project_id_customer_id_idx" ON "promotional_entitlements"("project_id", "customer_id");

-- CreateIndex
CREATE INDEX "promotional_entitlements_customer_id_idx" ON "promotional_entitlements"("customer_id");

-- AddForeignKey
ALTER TABLE "promotional_entitlements" ADD CONSTRAINT "promotional_entitlements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_entitlements" ADD CONSTRAINT "promotional_entitlements_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

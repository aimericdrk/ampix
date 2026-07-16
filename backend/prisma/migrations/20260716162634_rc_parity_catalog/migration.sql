-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('IOS', 'ANDROID', 'MACOS', 'AMAZON', 'WEB');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('AUTO_RENEWABLE_SUBSCRIPTION', 'NON_RENEWING_SUBSCRIPTION', 'CONSUMABLE', 'NON_CONSUMABLE');

-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('UNKNOWN', 'CUSTOM', 'LIFETIME', 'ANNUAL', 'SIX_MONTH', 'THREE_MONTH', 'TWO_MONTH', 'MONTHLY', 'WEEKLY');

-- CreateTable
CREATE TABLE "rc_apps" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "AppPlatform" NOT NULL,
    "bundle_id" TEXT,
    "package_name" TEXT,
    "public_sdk_key" TEXT NOT NULL,
    "store_credentials" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rc_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rc_products" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "store_product_id" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "price_cents" INTEGER,
    "currency" TEXT,
    "duration_iso8601" TEXT,
    "subscription_group_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rc_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rc_entitlements" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rc_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rc_product_entitlements" (
    "product_id" UUID NOT NULL,
    "entitlement_id" UUID NOT NULL,

    CONSTRAINT "rc_product_entitlements_pkey" PRIMARY KEY ("product_id","entitlement_id")
);

-- CreateTable
CREATE TABLE "rc_offerings" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rc_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rc_packages" (
    "id" UUID NOT NULL,
    "offering_id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "package_type" "PackageType" NOT NULL,
    "product_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rc_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rc_apps_public_sdk_key_key" ON "rc_apps"("public_sdk_key");

-- CreateIndex
CREATE INDEX "rc_apps_project_id_idx" ON "rc_apps"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "rc_apps_project_id_platform_bundle_id_key" ON "rc_apps"("project_id", "platform", "bundle_id");

-- CreateIndex
CREATE UNIQUE INDEX "rc_apps_project_id_platform_package_name_key" ON "rc_apps"("project_id", "platform", "package_name");

-- CreateIndex
CREATE INDEX "rc_products_project_id_idx" ON "rc_products"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "rc_products_app_id_store_product_id_key" ON "rc_products"("app_id", "store_product_id");

-- CreateIndex
CREATE INDEX "rc_entitlements_project_id_idx" ON "rc_entitlements"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "rc_entitlements_project_id_identifier_key" ON "rc_entitlements"("project_id", "identifier");

-- CreateIndex
CREATE INDEX "rc_product_entitlements_entitlement_id_idx" ON "rc_product_entitlements"("entitlement_id");

-- CreateIndex
CREATE INDEX "rc_offerings_project_id_idx" ON "rc_offerings"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "rc_offerings_project_id_identifier_key" ON "rc_offerings"("project_id", "identifier");

-- CreateIndex
CREATE INDEX "rc_packages_product_id_idx" ON "rc_packages"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "rc_packages_offering_id_identifier_key" ON "rc_packages"("offering_id", "identifier");

-- AddForeignKey
ALTER TABLE "rc_apps" ADD CONSTRAINT "rc_apps_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rc_products" ADD CONSTRAINT "rc_products_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rc_products" ADD CONSTRAINT "rc_products_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "rc_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rc_entitlements" ADD CONSTRAINT "rc_entitlements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rc_product_entitlements" ADD CONSTRAINT "rc_product_entitlements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "rc_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rc_product_entitlements" ADD CONSTRAINT "rc_product_entitlements_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "rc_entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rc_offerings" ADD CONSTRAINT "rc_offerings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rc_packages" ADD CONSTRAINT "rc_packages_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "rc_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rc_packages" ADD CONSTRAINT "rc_packages_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "rc_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Single current offering per project (Prisma can't express a partial unique index).
CREATE UNIQUE INDEX "rc_offerings_one_current_per_project"
  ON "rc_offerings" ("project_id") WHERE "is_current" = true;
